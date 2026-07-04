import express from 'express';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PLAY = path.join(ROOT, 'playground');
const REMOTE = path.join(ROOT, 'remote.git');
const DOC = 'README.md';

/* --------------------------------------------------------------- sessions
   Locally there is one shared playground (as always). With MULTI_SESSION=1
   (set on cloud deploys, e.g. Render) every browser gets its own sandbox:
   a gfp_sid cookie maps to sessions/<sid>/{playground,remote.git}, carried
   through all the existing code via AsyncLocalStorage — no shared state. */

const MULTI_SESSION = process.env.MULTI_SESSION === '1';
const SESSIONS_DIR = path.join(ROOT, 'sessions');
const SESSION_TTL = 60 * 60 * 1000; // idle sessions are wiped after 1h
const SESSION_MAX = 200;            // hard cap; oldest evicted beyond this

const als = new AsyncLocalStorage();
const DEFAULT_SESSION = { play: PLAY, remote: REMOTE, workRoot: ROOT, identityChecked: false, lastSeen: 0 };
const sessions = new Map();
const session = () => als.getStore() || DEFAULT_SESSION;

function getSession(sid) {
  let s = sessions.get(sid);
  if (!s) {
    const dir = path.join(SESSIONS_DIR, sid);
    s = { dir, workRoot: dir, play: path.join(dir, 'playground'), remote: path.join(dir, 'remote.git'), identityChecked: false, lastSeen: 0 };
    sessions.set(sid, s);
  }
  s.lastSeen = Date.now();
  return s;
}

function dropSession(sid, s) {
  sessions.delete(sid);
  if (s.dir) fs.rm(s.dir, { recursive: true, force: true }, () => {});
}

function sweepSessions() {
  const now = Date.now();
  for (const [sid, s] of sessions) {
    if (now - s.lastSeen > SESSION_TTL) dropSession(sid, s);
  }
  if (sessions.size > SESSION_MAX) {
    [...sessions.entries()]
      .sort((a, b) => a[1].lastSeen - b[1].lastSeen)
      .slice(0, sessions.size - SESSION_MAX)
      .forEach(([sid, s]) => dropSession(sid, s));
  }
}

try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env — fine */ }
const PORT = process.env.PORT || 3333;
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_FALLBACK_MODEL = 'llama-3.3-70b-versatile';

// The playground starts with an empty README — the tour and the empty-state
// hints guide the user to write their own first content.
const SEED = '';

const HELP = `\x1b[1mGitflow Playground — terminal\x1b[0m

Everything runs inside a sandboxed repo at ~/playground.

  \x1b[1mgit <anything>\x1b[0m      real git — log, branch, merge, rebase, stash, push…
  \x1b[1mls\x1b[0m [-a]             list files          \x1b[1mcat\x1b[0m <file>   print a file
  \x1b[1mtouch\x1b[0m <file>         create a file       \x1b[1mrm\x1b[0m <file>    delete a file
  \x1b[1mecho\x1b[0m "hi" >> <file>  append text to a file (\x1b[1mprintf\x1b[0m works too, with \\n)
  \x1b[1mpwd\x1b[0m  ·  \x1b[1mclear\x1b[0m  ·  \x1b[1mreset\x1b[0m (wipe playground + remote, start over)
  chain commands with \x1b[1m&&\x1b[0m — e.g. git add . && git commit -m "msg"

\x1b[1mA guided tour\x1b[0m
  1. git init                          create the repository
  2. git status                        see what git sees
  3. git add ${DOC}                 stage your file
  4. git commit -m "first commit"      write it into history
  5. git switch -c develop             branch off
  6. edit the file in the editor, save (⌘S), commit again
  7. git switch -c feature/hello       a feature branch
  8. …edit, commit…
  9. git switch develop
 10. git merge --no-ff feature/hello   merge it back
 11. git tag v0.1                      mark a release

\x1b[1mRemotes, locally\x1b[0m
  git remote add origin ../remote.git
  git push -u origin main
`;

/* ---------------------------------------------------------------- process */

function run(cmd, args, cwd, { env = {}, timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ code: 127, out: String(err.message), timedOut });
    }
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: 127, out: out + String(err.message), timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out, timedOut }); });
  });
}

const USER_GIT_ENV = {
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  MANPAGER: 'cat',
  GIT_EDITOR: 'true',
  GIT_SEQUENCE_EDITOR: 'true',
  GIT_MERGE_AUTOEDIT: 'no',
  GIT_TERMINAL_PROMPT: '0',
};

const gitUser = (args) => run('git', ['-c', 'color.ui=always', '-c', 'init.defaultBranch=main', ...args], session().play, { env: USER_GIT_ENV });
const gitQ = (args) => run('git', ['-c', 'color.ui=never', ...args], session().play, { env: USER_GIT_ENV, timeout: 8000 });

/* ------------------------------------------------------------- playground */

function ensurePlayground() {
  fs.mkdirSync(session().play, { recursive: true });
  const doc = path.join(session().play, DOC);
  if (!fs.existsSync(doc)) fs.writeFileSync(doc, SEED);
}

async function ensureRemote() {
  if (!fs.existsSync(session().remote)) {
    await run('git', ['init', '--bare', '--initial-branch=main', session().remote], ROOT);
  }
}

// Always pin a neutral repo-local identity so playground commits look the
// same on every machine and the host's global config never leaks into
// lessons. Learners can still override it with `git config user.name …`.
async function ensureIdentityIfRepo() {
  const s = session();
  if (s.identityChecked || !fs.existsSync(path.join(s.play, '.git'))) return;
  await gitQ(['config', 'user.name', 'Git Learner']);
  await gitQ(['config', 'user.email', 'learner@gitflow.local']);
  s.identityChecked = true;
}

async function resetPlayground() {
  const s = session();
  fs.rmSync(s.play, { recursive: true, force: true });
  fs.rmSync(s.remote, { recursive: true, force: true });
  s.identityChecked = false;
  ensurePlayground();
  await ensureRemote();
}

/* ------------------------------------------------------------------ state */

function readDoc() {
  const p = path.join(session().play, DOC);
  if (!fs.existsSync(p)) return { name: DOC, exists: false, content: '' };
  try {
    return { name: DOC, exists: true, content: fs.readFileSync(p, 'utf8') };
  } catch {
    return { name: DOC, exists: false, content: '' };
  }
}

// Recursive playground file listing (excluding .git) for the explorer.
function listFiles(dir = session().play, base = '') {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name === '.git') continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push({ path: rel, dir: true });
      out.push(...listFiles(path.join(dir, e.name), rel));
    } else {
      let st = null;
      try { st = fs.statSync(path.join(dir, e.name)); } catch { /* raced */ }
      out.push({ path: rel, dir: false, size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0 });
    }
  }
  return out;
}

const US = '\x1f';
const RS = '\x1e';

async function collectState() {
  const repo = fs.existsSync(path.join(session().play, '.git'));
  const state = {
    repo,
    commits: [],
    branches: [],
    remotes: [],
    tags: [],
    head: { branch: null, commit: null, detached: false, unborn: true },
    status: { staged: [], unstaged: [], untracked: [], conflicted: [] },
    inProgress: null,
    stash: 0,
    configuredRemotes: [],
    file: readDoc(),
    files: listFiles(),
  };
  if (!repo) return state;

  const FMT = `--format=%H${US}%h${US}%P${US}%an${US}%at${US}%s${RS}`;
  let log = await gitQ(['log', '--branches', '--tags', '--remotes', 'HEAD', '--topo-order', '--reverse', FMT]);
  if (log.code !== 0) log = await gitQ(['log', '--branches', '--tags', '--remotes', '--topo-order', '--reverse', FMT]);
  if (log.code === 0) {
    state.commits = log.out
      .split(RS)
      .map((s) => s.replace(/^\s+/, ''))
      .filter((s) => s.includes(US))
      .map((s) => {
        const [hash, short, parents, author, time, subject] = s.split(US);
        return { hash, short, parents: parents ? parents.split(' ').filter(Boolean) : [], author, time: Number(time), subject };
      });
  }

  const heads = await gitQ(['for-each-ref', 'refs/heads', `--format=%(refname:short)${US}%(objectname)`]);
  if (heads.code === 0) {
    state.branches = heads.out.split('\n').filter((l) => l.includes(US)).map((l) => {
      const [name, tip] = l.split(US);
      return { name, tip };
    });
  }
  const remotes = await gitQ(['for-each-ref', 'refs/remotes', `--format=%(refname:short)${US}%(objectname)`]);
  if (remotes.code === 0) {
    state.remotes = remotes.out.split('\n').filter((l) => l.includes(US)).map((l) => {
      const [name, tip] = l.split(US);
      return { name, tip };
    }).filter((r) => !r.name.endsWith('/HEAD'));
  }
  const tags = await gitQ(['for-each-ref', 'refs/tags', `--format=%(refname:short)${US}%(objectname)${US}%(*objectname)`]);
  if (tags.code === 0) {
    state.tags = tags.out.split('\n').filter((l) => l.includes(US)).map((l) => {
      const [name, obj, peeled] = l.split(US);
      return { name, tip: peeled || obj };
    });
  }

  const sym = await gitQ(['symbolic-ref', '-q', '--short', 'HEAD']);
  const rev = await gitQ(['rev-parse', '-q', '--verify', 'HEAD']);
  state.head = {
    branch: sym.code === 0 ? sym.out.trim() : null,
    commit: rev.code === 0 ? rev.out.trim() : null,
    detached: sym.code !== 0 && rev.code === 0,
    unborn: rev.code !== 0,
  };

  const st = await gitQ(['status', '--porcelain', '-z']);
  if (st.code === 0) {
    const parts = st.out.split('\0').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const e = parts[i];
      if (e.length < 4) continue;
      const X = e[0];
      const Y = e[1];
      const name = e.slice(3);
      if (X === 'R' || X === 'C' || Y === 'R' || Y === 'C') i++; // skip rename/copy source path
      if (X === '?' && Y === '?') {
        state.status.untracked.push({ name, code: '??' });
      } else if (X === 'U' || Y === 'U' || (X === 'D' && Y === 'D') || (X === 'A' && Y === 'A')) {
        state.status.conflicted.push({ name, code: X + Y });
      } else {
        if (X !== ' ') state.status.staged.push({ name, code: X });
        if (Y !== ' ') state.status.unstaged.push({ name, code: Y });
      }
    }
  }

  const gitDir = path.join(session().play, '.git');
  if (fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))) state.inProgress = 'merge';
  else if (fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))) state.inProgress = 'rebase';
  else if (fs.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'))) state.inProgress = 'cherry-pick';
  else if (fs.existsSync(path.join(gitDir, 'REVERT_HEAD'))) state.inProgress = 'revert';

  const stash = await gitQ(['stash', 'list', '--format=%gs']);
  if (stash.code === 0) state.stash = stash.out.split('\n').filter(Boolean).length;

  const remoteNames = await gitQ(['remote']);
  if (remoteNames.code === 0) state.configuredRemotes = remoteNames.out.split('\n').filter(Boolean);

  return state;
}

/* --------------------------------------------------------------- commands */

function tokenize(input) {
  const argv = [];
  let cur = '';
  let quote = null;
  let hasToken = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < input.length && '"\\$`'.includes(input[i + 1])) cur += input[++i];
      else cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      hasToken = true;
    } else if (c === '\\' && i + 1 < input.length) {
      cur += input[++i];
    } else if (/\s/.test(c)) {
      if (cur || hasToken) argv.push(cur);
      cur = '';
      hasToken = false;
    } else {
      cur += c;
    }
  }
  if (quote) return { error: `unclosed ${quote} quote` };
  if (cur || hasToken) argv.push(cur);
  return { argv };
}

function safePath(name) {
  if (!name || name.startsWith('-')) return null;
  const play = session().play;
  const p = path.resolve(play, name);
  if (p !== play && !p.startsWith(play + path.sep)) return null;
  return p;
}

function lsCmd(rest) {
  const all = rest.includes('-a') || rest.includes('-la') || rest.includes('-al');
  let entries;
  try {
    entries = fs.readdirSync(session().play, { withFileTypes: true });
  } catch {
    return { output: 'ls: playground missing (try `reset`)\n', code: 1 };
  }
  const names = entries
    .filter((e) => all || !e.name.startsWith('.'))
    .map((e) => (e.isDirectory() ? `\x1b[1;34m${e.name}/\x1b[0m` : e.name))
    .sort();
  return { output: names.length ? names.join('\n') + '\n' : '', code: 0 };
}

function catCmd(rest) {
  const target = rest.find((a) => !a.startsWith('-'));
  const p = target && safePath(target);
  if (!p) return { output: `cat: give me a file inside the playground, e.g. cat ${DOC}\n`, code: 1 };
  try {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) return { output: `cat: ${target}: is a directory\n`, code: 1 };
    if (stat.size > 200 * 1024) return { output: `cat: ${target}: too large for this terminal\n`, code: 1 };
    return { output: fs.readFileSync(p, 'utf8'), code: 0 };
  } catch {
    return { output: `cat: ${target}: no such file\n`, code: 1 };
  }
}

function touchCmd(rest) {
  const target = rest.find((a) => !a.startsWith('-'));
  const p = target && safePath(target);
  if (!p) return { output: 'touch: give me a file name inside the playground\n', code: 1 };
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.closeSync(fs.openSync(p, 'a'));
    return { output: '', code: 0 };
  } catch (err) {
    return { output: `touch: ${err.message}\n`, code: 1 };
  }
}

function rmCmd(rest) {
  const target = rest.find((a) => !a.startsWith('-'));
  const p = target && safePath(target);
  if (!p) return { output: 'rm: give me a file name inside the playground\n', code: 1 };
  try {
    if (fs.statSync(p).isDirectory()) return { output: `rm: ${target}: is a directory (this rm only removes files)\n`, code: 1 };
    fs.rmSync(p);
    return { output: '', code: 0 };
  } catch {
    return { output: `rm: ${target}: no such file\n`, code: 1 };
  }
}

function echoCmd(rest, { escapes = false, newline = true } = {}) {
  // supports: echo text, echo text > file, echo text >> file
  // printf reuses this with escape interpretation and no trailing newline
  let redirect = null;
  let target = null;
  const words = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '>' || a === '>>') {
      redirect = a;
      target = rest[i + 1];
      break;
    }
    const m = a.match(/^(>>?)(.+)$/); // attached form like >>file
    if (m) {
      redirect = m[1];
      target = m[2];
      break;
    }
    words.push(a);
  }
  let text = words.join(' ');
  if (escapes) text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
  if (newline) text += '\n';
  if (!redirect) return { output: text, code: 0 };
  const p = target && safePath(target);
  if (!p) return { output: 'echo: redirect target must be a file inside the playground\n', code: 1 };
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (redirect === '>') fs.writeFileSync(p, text);
    else fs.appendFileSync(p, text);
    return { output: '', code: 0 };
  } catch (err) {
    return { output: `echo: ${err.message}\n`, code: 1 };
  }
}

async function execGit(rest) {
  for (const a of rest) {
    if (a === '-C' || a.startsWith('--git-dir') || a.startsWith('--work-tree') || a.startsWith('--exec-path')) {
      return { output: `this playground keeps git pinned to ~/playground — ${a} is disabled here.\n`, code: 2 };
    }
  }
  const sub = rest.find((a) => !a.startsWith('-'));
  if (sub === 'config' && rest.some((a) => a === '--global' || a === '--system')) {
    return { output: 'config --global / --system would touch your real machine.\nuse plain `git config` — it stays local to the playground repo.\n', code: 2 };
  }
  if (sub === 'commit') {
    const hasMsg = rest.some((a) =>
      /^-[a-zA-Z]*m$/.test(a) || a.startsWith('--message') ||
      a === '-F' || a.startsWith('--file') ||
      a === '--amend' || a === '--no-edit' || a === '--allow-empty-message' ||
      /^-[a-zA-Z]*C$/.test(a) || a.startsWith('--reuse-message') || a.startsWith('--reedit-message') || a === '-c');
    if (!hasMsg) {
      return { output: 'this terminal has no interactive editor, so git can’t open one for the message.\ntry:  \x1b[1mgit commit -m "describe your change"\x1b[0m\n', code: 2 };
    }
  }
  if (sub === 'rebase' && rest.some((a) => a === '-i' || a === '--interactive')) {
    return { output: 'interactive rebase needs a live editor — not available in this demo terminal.\ntry a plain rebase instead:  \x1b[1mgit rebase <branch>\x1b[0m\n', code: 2 };
  }
  if (sub === 'tag' && rest.some((a) => /^-[a-zA-Z]*[as]$/.test(a)) &&
      !rest.some((a) => /^-[a-zA-Z]*m$/.test(a) || a.startsWith('--message') || a === '-F')) {
    return { output: 'annotated tags need a message here:  \x1b[1mgit tag -a v1.0 -m "release v1.0"\x1b[0m\n', code: 2 };
  }
  await ensureIdentityIfRepo();
  const { out, code, timedOut } = await gitUser(rest);
  let output = out;
  if (timedOut) output += '\n[command ran too long and was stopped — interactive commands are not supported here]\n';
  return { output, code };
}

async function dispatch(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'git': return execGit(rest);
    case 'help': return { output: HELP, code: 0 };
    case 'pwd': return { output: '~/playground\n', code: 0 };
    case 'ls': return lsCmd(rest);
    case 'cat': return catCmd(rest);
    case 'touch': return touchCmd(rest);
    case 'rm': return rmCmd(rest);
    case 'echo': return echoCmd(rest);
    case 'printf': return echoCmd(rest, { escapes: true, newline: false });
    case 'reset':
      await resetPlayground();
      return { output: 'Playground reset — fresh README.md, no repository.\nStart again with \x1b[1mgit init\x1b[0m.\n', code: 0 };
    default:
      return { output: `${cmd}: command not found\nthis terminal speaks \x1b[1mgit\x1b[0m (plus: ls, cat, touch, rm, echo, printf, pwd, clear, reset, help)\n`, code: 127 };
  }
}

// Shell-style chaining: `a && b` short-circuits, `a ; b` always continues.
async function runLine(argv) {
  const segments = [];
  const seps = [];
  let cur = [];
  for (const tok of argv) {
    if (tok === '&&' || tok === ';') {
      segments.push(cur);
      seps.push(tok);
      cur = [];
    } else {
      cur.push(tok);
    }
  }
  segments.push(cur);
  let output = '';
  let code = 0;
  for (let i = 0; i < segments.length; i++) {
    if (!segments[i].length) continue;
    const r = await dispatch(segments[i]);
    output += r.output;
    code = r.code;
    if (code !== 0 && seps[i] === '&&') break;
  }
  return { output, code };
}

/* ----------------------------------------------------------------- server */

const app = express();
app.use(express.json({ limit: '2mb' }));

// Cheap liveness probe — never touches sessions (Render pings it constantly).
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Per-browser sandbox routing: resolve (or mint) the session cookie, prepare
// its directories, and run the rest of the request inside its ALS context.
app.use('/api', (req, res, next) => {
  if (!MULTI_SESSION) return next();
  let sid = (/(?:^|;\s*)gfp_sid=([a-f0-9]{32})(?:;|$)/.exec(req.headers.cookie || '') || [])[1];
  if (!sid) {
    sid = randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', `gfp_sid=${sid}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`);
  }
  if (!sessions.has(sid) && sessions.size >= SESSION_MAX) sweepSessions();
  const sess = getSession(sid);
  als.run(sess, () => {
    (async () => {
      if (!fs.existsSync(sess.play)) {
        ensurePlayground();
        await ensureRemote();
      }
    })().then(() => next(), next);
  });
});

app.get('/api/state', async (_req, res) => {
  res.json(await collectState());
});

app.post('/api/exec', async (req, res) => {
  const command = String(req.body?.command ?? '').slice(0, 4000);
  const t = tokenize(command);
  let result = { output: '', code: 0 };
  if (t.error) result = { output: `parse error: ${t.error}\n`, code: 2 };
  else if (t.argv.length) result = await runLine(t.argv);
  res.json({ ...result, state: await collectState() });
});

app.get('/api/file', (req, res) => {
  const rel = String(req.query.path || DOC);
  const p = safePath(rel);
  if (!p) return res.status(400).json({ error: 'path escapes the playground' });
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) return res.json({ path: rel, exists: false, content: '' });
    if (st.size > 500 * 1024) return res.json({ path: rel, exists: true, binary: true, content: '' });
    const buf = fs.readFileSync(p);
    const binary = buf.includes(0);
    res.json({ path: rel, exists: true, binary, content: binary ? '' : buf.toString('utf8') });
  } catch {
    res.json({ path: rel, exists: false, content: '' });
  }
});

app.post('/api/file', async (req, res) => {
  const rel = String(req.body?.path ?? DOC);
  const content = String(req.body?.content ?? '');
  const p = safePath(rel);
  if (!p) return res.status(400).json({ error: 'path escapes the playground' });
  ensurePlayground();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  res.json({ ok: true, state: await collectState() });
});

// Explorer operations: create files/folders, delete entries.
app.post('/api/fs', async (req, res) => {
  const op = String(req.body?.op ?? '');
  const rel = String(req.body?.path ?? '');
  const p = safePath(rel);
  if (!p || !rel) return res.status(400).json({ error: 'path escapes the playground' });
  try {
    if (op === 'create') {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.closeSync(fs.openSync(p, 'ax')); // fails if it already exists
    } else if (op === 'mkdir') {
      fs.mkdirSync(p, { recursive: true });
    } else if (op === 'delete') {
      fs.rmSync(p, { recursive: true, force: true });
    } else {
      return res.status(400).json({ error: 'unknown op' });
    }
    res.json({ ok: true, state: await collectState() });
  } catch (err) {
    res.status(400).json({ error: err.code === 'EEXIST' ? 'already exists' : String(err.message), state: await collectState() });
  }
});

app.post('/api/reset', async (_req, res) => {
  await resetPlayground();
  res.json({ ok: true, state: await collectState() });
});

// Simulates a colleague: clone the local remote, commit, push, clean up.
// Lets lessons teach fetch/pull against a remote that really moved.
// The clone lives inside ROOT (not os.tmpdir()) so it works regardless of
// what TMPDIR the server process inherited.
async function teammateCommit({ path: file = DOC, content = '', message = 'teammate: update' }) {
  const tmp = path.join(session().workRoot, '.teammate-' + Math.random().toString(36).slice(2, 10));
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const clone = await run('git', ['clone', session().remote, tmp], ROOT);
    if (clone.code !== 0) return { ...clone, out: '[clone] ' + clone.out };
    const target = path.resolve(tmp, String(file));
    if (target !== tmp && !target.startsWith(tmp + path.sep)) return { code: 1, out: 'bad teammate path' };
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, String(content));
    const add = await run('git', ['add', '-A'], tmp);
    if (add.code !== 0) return { ...add, out: '[add] ' + add.out };
    const commit = await run('git', [
      '-c', 'user.name=Teammate', '-c', 'user.email=teammate@gitflow.local',
      'commit', '-m', String(message),
    ], tmp);
    if (commit.code !== 0) return { ...commit, out: '[commit] ' + commit.out };
    const push = await run('git', ['push', 'origin', 'HEAD'], tmp);
    if (push.code !== 0) return { ...push, out: '[push] ' + push.out };
    return push;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Lesson setup: reset, then run a scripted sequence to build the scenario.
app.post('/api/setup', async (req, res) => {
  const steps = Array.isArray(req.body?.steps) ? req.body.steps.slice(0, 60) : [];
  await resetPlayground();
  const log = [];
  for (const s of steps) {
    if (s && typeof s.cmd === 'string') {
      const t = tokenize(s.cmd.slice(0, 2000));
      if (t.error || !t.argv.length) { log.push({ cmd: s.cmd, code: 2 }); continue; }
      const r = await runLine(t.argv);
      log.push({ cmd: s.cmd, code: r.code });
    } else if (s && s.write && typeof s.write.content === 'string') {
      const p = safePath(String(s.write.path || DOC));
      if (!p) { log.push({ write: s.write.path, code: 1 }); continue; }
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, s.write.content);
      log.push({ write: s.write.path || DOC, code: 0 });
    } else if (s && s.teammate) {
      const r = await teammateCommit(s.teammate);
      log.push({ teammate: true, code: r.code, ...(r.code !== 0 ? { error: r.out.slice(0, 500) } : {}) });
    }
  }
  res.json({ ok: log.every((l) => l.code === 0), log, state: await collectState() });
});

/* ------------------------------------------------------------- assistant */

function stateSummary(s) {
  const files = s.files.filter((f) => !f.dir).map((f) => f.path).join(', ') || '(none)';
  if (!s.repo) return `No repository yet — git init has not been run.\nFiles in the playground: ${files}`;
  const head = s.head.branch
    ? `${s.head.branch}${s.head.unborn ? ' (unborn — no commits yet)' : ' @ ' + (s.head.commit || '').slice(0, 7)}`
    : `DETACHED @ ${(s.head.commit || '').slice(0, 7)}`;
  const st = s.status;
  const names = (arr) => arr.map((f) => f.name).join(', ');
  const status = [
    st.staged.length ? `staged: ${names(st.staged)}` : '',
    st.unstaged.length ? `modified (unstaged): ${names(st.unstaged)}` : '',
    st.untracked.length ? `untracked: ${names(st.untracked)}` : '',
    st.conflicted.length ? `CONFLICTED: ${names(st.conflicted)}` : '',
  ].filter(Boolean).join('; ') || 'clean';
  return [
    `HEAD: ${head}`,
    `Local branches: ${s.branches.map((b) => b.name).join(', ') || '(none)'}`,
    `Recent commits (newest first): ${s.commits.slice(-6).reverse().map((c) => `${c.short} "${c.subject}"${c.parents.length > 1 ? ' [merge]' : ''}`).join(' | ') || '(none)'}`,
    `Working tree: ${status}`,
    `Tags: ${s.tags.map((t) => t.name).join(', ') || '(none)'}`,
    `Remotes configured: ${s.configuredRemotes.join(', ') || '(none)'} — a local bare repo is available at ../remote.git`,
    `Remote-tracking refs: ${s.remotes.map((r) => r.name).join(', ') || '(none)'}`,
    s.inProgress ? `OPERATION IN PROGRESS: ${s.inProgress}` : '',
    s.stash ? `Stash entries: ${s.stash}` : '',
    `Files: ${files}`,
  ].filter(Boolean).join('\n');
}

const CHAT_SYSTEM = (summary) => `You are the friendly git mentor built into "Gitflow Playground", a learning app where the user has a REAL sandboxed git repository. The app shows: a terminal (runs real git), a tabbed file editor with markdown preview, an animated commit graph, a Source Control sidebar, and a file explorer.

CURRENT REPOSITORY STATE (live, trust this over the conversation):
${summary}

Environment constraints: no interactive editors (git commit needs -m; no rebase -i), config --global is blocked, a local practice remote exists at ../remote.git.
THE TERMINAL IS NOT BASH. The ONLY commands that exist are: git, ls, cat, touch, rm, echo, printf, pwd, clear, reset, help. echo/printf support > and >> redirection to a file. There are NO pipes (|), NO subshells $(), NO variables, NO sed/awk/grep/mkdir/mv/cp — any other command fails with "command not found".

You MUST respond with a single JSON object, nothing else:
{
  "reply": "concise markdown answer (use \`code\` for commands; friendly, max ~180 words)",
  "tour": null OR a hands-on guided tour when the user asks how to DO something or would clearly benefit from a walkthrough:
  {
    "title": "3-6 word title",
    "steps": [
      {
        "el": "terminal" | "editor" | "graph" | "scm" | null,
        "title": "short step title",
        "desc": "1-3 sentences explaining WHY (plain text, <b>/<code> allowed)",
        "cmd": "exact single command for the user to run (only for terminal action steps)",
        "advanceOn": "optional regex matching the command that completes the step (defaults to the first two words of cmd)"
      }
    ]
  }
}

Tour rules:
- The tour runs on the CURRENT repository state shown above — NO reset happens. Every cmd must be valid for that exact state (mind the current branch, staged files, in-progress operations).
- 3-10 steps. Start with an el:null intro step (what we'll do), end with an el:null wrap-up.
- EXACTLY ONE command per step in "cmd" — never chain with && or ; (make separate steps instead), and only use commands from the allowed list above.
- To change a file's CONTENT (e.g. resolving a merge conflict), use an "editor" step that tells the user exactly what the file should look like — do NOT overwrite files with echo. Use echo only for creating small demo files.
- Steps with cmd auto-advance when the user runs it; editor steps ("el":"editor") tell the user what to change and they click Next.
- Use "graph" steps to point out what just changed visually, "scm" for staging-area concepts.
- Prefer modern commands (git switch, git restore).
Include a tour whenever the question is a how-to; for pure concept questions answer in reply and set tour to null.`;

function parseAssistantJson(text) {
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  return { reply: String(text), tour: null };
}

function validateTour(tour) {
  if (!tour || typeof tour !== 'object' || !Array.isArray(tour.steps)) return null;
  const steps = tour.steps.slice(0, 12).map((s) => {
    if (!s || typeof s !== 'object' || !s.title) return null;
    return {
      el: ['terminal', 'editor', 'graph', 'scm'].includes(s.el) ? s.el : null,
      title: String(s.title).slice(0, 120),
      desc: String(s.desc || '').slice(0, 600),
      cmd: s.cmd ? String(s.cmd).slice(0, 200) : undefined,
      advanceOn: s.advanceOn ? String(s.advanceOn).slice(0, 200) : undefined,
    };
  }).filter(Boolean);
  if (!steps.length) return null;
  return { title: String(tour.title || 'Guided tour').slice(0, 80), steps };
}

async function groqChat(messages, model = GROQ_MODEL, retried = false) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.4,
      max_tokens: 2200,
      response_format: { type: 'json_object' },
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    if (!retried && (r.status === 404 || /model.*(not|decommission|deprecat)/i.test(body))) {
      return groqChat(messages, GROQ_FALLBACK_MODEL, true);
    }
    throw new Error(`Groq API ${r.status}: ${body.slice(0, 300)}`);
  }
  const data = await r.json();
  return data.choices?.[0]?.message?.content ?? '';
}

app.post('/api/chat', async (req, res) => {
  if (!GROQ_KEY) {
    return res.json({
      reply: 'The assistant is not configured — add `GROQ_API_KEY=…` to a `.env` file next to server.js (get a free key at console.groq.com) and restart the server.',
      tour: null,
    });
  }
  const history = (Array.isArray(req.body?.messages) ? req.body.messages : [])
    .slice(-16)
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.content || '').slice(0, 4000) }));
  if (!history.length) return res.status(400).json({ error: 'no messages' });
  try {
    const state = await collectState();
    const raw = await groqChat([{ role: 'system', content: CHAT_SYSTEM(stateSummary(state)) }, ...history]);
    const parsed = parseAssistantJson(raw);
    res.json({ reply: String(parsed.reply || '').trim() || '…', tour: validateTour(parsed.tour) });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.use('/vendor/marked', express.static(path.join(ROOT, 'node_modules', 'marked')));
app.use('/vendor/driver', express.static(path.join(ROOT, 'node_modules', 'driver.js', 'dist')));
app.use(express.static(path.join(ROOT, 'public')));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: String(err.message || err) });
});

if (MULTI_SESSION) {
  // Ephemeral by design: session repos don't survive a redeploy/restart.
  fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  setInterval(sweepSessions, 10 * 60 * 1000).unref();
} else {
  ensurePlayground();
  await ensureRemote();
}

app.listen(PORT, () => {
  console.log('');
  console.log('  🌱 Gitflow Playground');
  console.log(`     http://localhost:${PORT}`);
  console.log('');
  if (MULTI_SESSION) {
    console.log(`     multi-session mode — sandboxes under ${SESSIONS_DIR}`);
  } else {
    console.log(`     sandbox repo:  ${PLAY}`);
    console.log(`     local remote:  ${REMOTE}`);
  }
  console.log('');
});
