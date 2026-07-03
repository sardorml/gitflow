import { initGraph } from './graph.js';
import { initTerminal } from './terminal.js';
import { initEditor } from './editor.js';
import { initExplorer } from './explorer.js';
import { initSCM } from './sourcecontrol.js';
import { initSchool } from './school.js';
import { escapeHtml } from './ansi.js';

const $ = (sel) => document.querySelector(sel);

async function api(pathname, body) {
  const res = await fetch(pathname, body !== undefined ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } : undefined);
  if (!res.ok && res.headers.get('content-type')?.includes('json')) {
    const data = await res.json();
    const err = new Error(data.error || `server responded ${res.status}`);
    err.state = data.state;
    throw err;
  }
  if (!res.ok) throw new Error(`server responded ${res.status}`);
  return res.json();
}

let school = null;

/* ————————————————————————————————————————————————— modules */

const graph = initGraph({
  svg: $('#graph-svg'),
  chipLayer: $('#chips'),
  content: $('#graph-content'),
  scroll: $('#graph-scroll'),
  empty: $('#graph-empty'),
});

const term = initTerminal(
  { out: $('#term-out'), input: $('#term-input'), prompt: $('#term-prompt'), pane: $('#terminal-pane') },
  {
    onExec: async (command) => {
      const res = await api('/api/exec', { command });
      applyState(res.state);
      school.onCommand(command, res.code);
      return res;
    },
  }
);

const editor = initEditor(
  {
    tabstrip: $('#tabstrip'),
    textarea: $('#editor'),
    preview: $('#preview'),
    saveBtn: $('#save-btn'),
    previewToggle: $('#preview-toggle'),
    emptyEl: $('#editor-empty'),
  },
  {
    readFile: (path) => api('/api/file?path=' + encodeURIComponent(path)),
    writeFile: async (path, content) => {
      const res = await api('/api/file', { path, content });
      applyState(res.state);
    },
  }
);

const explorer = initExplorer(
  {
    tree: $('#file-tree'),
    newFileBtn: $('#new-file-btn'),
    newFolderBtn: $('#new-folder-btn'),
    newRow: $('#new-entry-row'),
    newInput: $('#new-entry-input'),
  },
  {
    onOpen: (path) => editor.open(path),
    fsOp: async (op, path) => {
      try {
        const res = await api('/api/fs', { op, path });
        applyState(res.state);
      } catch (err) {
        term.notice(`explorer: ${err.message}`);
        if (err.state) applyState(err.state);
      }
    },
  }
);

const scm = initSCM(
  {
    msg: $('#scm-msg'),
    commitBtn: $('#scm-commit-btn'),
    stagedList: $('#scm-staged'),
    changesList: $('#scm-changes'),
    stagedCount: $('#scm-staged-count'),
    changesCount: $('#scm-changes-count'),
    badge: $('#ab-scm-badge'),
  },
  { runGit: (cmd) => term.run(cmd) }
);

/* ————————————————————————————————————————————————— sidebar views */

function showView(name) {
  for (const btn of document.querySelectorAll('.ab-btn[data-view]')) {
    btn.classList.toggle('active', btn.dataset.view === name);
  }
  $('#view-explorer').hidden = name !== 'explorer';
  $('#view-scm').hidden = name !== 'scm';
}
for (const btn of document.querySelectorAll('.ab-btn[data-view]')) {
  btn.addEventListener('click', () => showView(btn.dataset.view));
}
// lessons highlighting the SCM groups need that view visible
document.addEventListener('gitflow:show-scm', () => showView('scm'));

/* ————————————————————————————————————————————————— status bar + banners */

const PROGRESS_TEXT = {
  merge: 'merge in progress — resolve conflicts, git add, then git commit',
  rebase: 'rebase in progress — resolve, git add, then git rebase --continue',
  'cherry-pick': 'cherry-pick in progress — resolve, then git cherry-pick --continue',
  revert: 'revert in progress — resolve, then git revert --continue',
};

function statusBar(s) {
  const branch = $('#sb-branch');
  if (!s.repo) {
    branch.textContent = '⎇ no repository';
    branch.className = '';
  } else if (s.head.branch) {
    branch.textContent = `⎇ ${s.head.branch}${s.head.unborn ? ' (no commits)' : ' @ ' + (s.head.commit || '').slice(0, 7)}`;
    branch.className = '';
  } else {
    branch.textContent = `⎇ detached @ ${(s.head.commit || '').slice(0, 7)}`;
    branch.className = 'detached';
  }

  const st = s.status;
  const total = st.staged.length + st.unstaged.length + st.untracked.length + st.conflicted.length;
  const changes = $('#sb-changes');
  changes.hidden = !total || !s.repo;
  changes.textContent = `● ${total} change${total === 1 ? '' : 's'}`;

  const stateEl = $('#sb-state');
  stateEl.hidden = !s.inProgress;
  stateEl.textContent = s.inProgress ? `${s.inProgress} in progress` : '';

  const banner = $('#progress-banner');
  banner.hidden = !s.inProgress;
  banner.textContent = s.inProgress ? PROGRESS_TEXT[s.inProgress] || s.inProgress : '';

  const stashEl = $('#stash-badge');
  stashEl.hidden = !s.stash;
  stashEl.textContent = s.stash ? `≡ ${s.stash} stash${s.stash === 1 ? '' : 'es'}` : '';
}

/* ————————————————————————————————————————————————— state pump */

function applyState(s) {
  graph.render(s);
  term.setPrompt(s);
  editor.applyState(s);
  explorer.render(s);
  scm.render(s);
  statusBar(s);
  if (school) school.onState(s);
}

school = initSchool({
  runSetup: async (lesson) => {
    const res = await api('/api/setup', { steps: lesson.setup || [] });
    applyState(res.state);
    await editor.resetTo(res.state.files?.some((f) => f.path === 'README.md') ? 'README.md' : null);
    showView('explorer');
    term.notice(`lesson started: ${lesson.title.replace(/^\d+\s·\s/, '')} — scenario prepared.`);
    return res.state;
  },
});

$('#lessons-btn').addEventListener('click', () => school.openCatalog());

$('#reset-btn').addEventListener('click', async () => {
  if (!confirm('Wipe the playground repo and the local remote, and start fresh?')) return;
  const res = await api('/api/reset', {});
  applyState(res.state);
  await editor.resetTo('README.md');
  term.notice('playground reset — fresh empty README.md, no repository. start with git init.');
});

let lastRefresh = 0;
window.addEventListener('focus', async () => {
  if (Date.now() - lastRefresh < 1000) return;
  lastRefresh = Date.now();
  try {
    applyState(await api('/api/state'));
  } catch { /* server gone; terminal reports it on the next command */ }
});

api('/api/state')
  .then(async (s) => {
    applyState(s);
    if (s.files?.some((f) => f.path === 'README.md')) await editor.open('README.md');
    school.autoOpen();
  })
  .catch(() => {
    term.notice('could not reach the playground server — run `npm start` and reload.');
  });

$('#term-input').focus();
