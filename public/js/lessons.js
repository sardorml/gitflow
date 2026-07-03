// The Git School curriculum.
//
// Each lesson: { id, level, title, blurb, minutes, setup, steps }
//   setup — scripted server-side scenario ({cmd}, {write}, {teammate})
//   steps — tour steps: { el?, side?, title, desc, hint?, wait?, waitCmd? }
//     wait(state)  → auto-advance when the repo state proves the action
//     waitCmd      → auto-advance when a matching command succeeds

const T = '#terminal-pane';
const E = '#editor-pane';
const G = '#graph-pane';
const WORK = '#cell-working';
const STAGE = '#cell-staged';

const cmd = (c) => `<div class="tour-cmd">${c}</div>`;
const branch = (s, n) => (s.branches || []).find((b) => b.name === n);
const remote = (s, n) => (s.remotes || []).find((r) => r.name === n);
const headCommit = (s) => (s.commits || []).find((c) => c.hash === s.head.commit);

export const LEVELS = [
  ['beginner', 'Beginner'],
  ['intermediate', 'Intermediate'],
  ['advanced', 'Advanced'],
];

export const LESSONS = [

  /* ————————————————————————————————————————————————— beginner */
  {
    id: 'first-repo',
    level: 'beginner',
    title: '1 · Your first repository',
    blurb: 'init → edit → stage → commit → push. The whole basic loop, from nothing.',
    minutes: 5,
    setup: [],
    steps: [
      {
        title: 'Your first repository 🌱',
        desc:
          `<p>The playground is a plain folder with one empty file. By the end of this lesson ` +
          `you'll have turned it into a repository with published history.</p>` +
          `<p>The loop you're about to learn — <b>init → edit → stage → commit → push</b> — ` +
          `is 90% of daily git.</p>`,
      },
      {
        el: G, side: 'bottom',
        title: 'The commit graph',
        desc: `This canvas draws your repository in real time — each branch a lane, each commit a node. It's blank: <b>there is no repository yet</b>.`,
      },
      {
        el: T, side: 'left',
        title: 'Create a repository',
        desc: `A repository is a hidden <code>.git</code> folder where git records history. Type:` + cmd('git init'),
        hint: 'continues once the repository exists',
        wait: (s) => s.repo,
      },
      {
        el: E, side: 'top',
        title: 'Write something',
        desc:
          `The editor holds <code>README.md</code> — empty. Type <b>Hello World</b>, then press <b>⌘S</b> (or Save). ` +
          `Saving only touches the <i>working directory</i> — git notices, but records nothing yet.`,
        hint: 'continues when you save some content',
        wait: (s) => s.repo && s.file.exists && s.file.content.trim().length > 0,
      },
      {
        el: WORK, side: 'right',
        title: 'The working directory',
        desc: `<code>README.md</code> shows in <b>Changes</b> as <b>U</b> (untracked): git sees the file but isn't guarding it. Changes live only on disk until you stage and commit them.`,
      },
      {
        el: T, side: 'left',
        title: 'Stage it',
        desc: `Staging chooses exactly what goes into the next commit:` + cmd('git add README.md'),
        hint: 'continues when the file is staged',
        wait: (s) => s.status.staged.some((f) => f.name === 'README.md'),
      },
      {
        el: STAGE, side: 'right',
        title: 'The staging area',
        desc: `The file moved to the <b>staging area</b> (the “index”) — a loading dock where you gather related changes, then ship them as one commit.`,
      },
      {
        el: T, side: 'left',
        title: 'Commit — write it into history',
        desc: `A commit is a permanent snapshot of everything staged, plus a message saying why:` + cmd('git commit -m "hello world"'),
        hint: 'continues when the commit lands',
        wait: (s) => s.commits.length >= 1,
      },
      {
        el: G, side: 'bottom',
        title: 'Your first commit 🎉',
        desc: `A node appeared on the <b>main</b> lane. The <b>main</b> chip is the branch pointer, <b>HEAD</b> marks where you are — both follow every new commit. Hover the node for details.`,
      },
      {
        el: T, side: 'left',
        title: 'Add a remote',
        desc: `Remotes are copies of your repo elsewhere — usually a server like GitHub. A local practice “server” is ready:` + cmd('git remote add origin ../remote.git'),
        hint: 'continues when origin is configured',
        wait: (s) => (s.configuredRemotes || []).includes('origin'),
      },
      {
        el: T, side: 'left',
        title: 'Push — publish your history',
        desc: cmd('git push -u origin main') + `This sends main's commits to origin and starts tracking it.`,
        hint: 'continues when origin has your commits',
        wait: (s) => !!remote(s, 'origin/main'),
      },
      {
        title: 'Lesson complete ✦',
        desc: `<p><b>edit → save → add → commit → push</b> — that's the loop.</p><p>Next lesson: how git shows you <i>what</i> changed before you commit it.</p>`,
      },
    ],
  },

  {
    id: 'recording-changes',
    level: 'beginner',
    title: '2 · Seeing what changed',
    blurb: 'status, diff and log — how git shows you your own work before and after committing.',
    minutes: 4,
    setup: [
      { cmd: 'git init' },
      { write: { path: 'README.md', content: '# My project\n\nHello World\n' } },
      { cmd: 'git add .' },
      { cmd: 'git commit -m "start: readme"' },
    ],
    steps: [
      {
        title: 'Seeing what changed 🔍',
        desc: `<p>Scenario: a repo with one commit. Before committing more, a good git user always checks <i>what</i> they're about to record.</p><p>Meet the three inspection commands: <b>status</b>, <b>diff</b>, <b>log</b>.</p>`,
      },
      {
        el: E, side: 'top',
        title: 'Change something',
        desc: `Add a new line to the file — anything — and press <b>⌘S</b>.`,
        hint: 'continues when a modification is saved',
        wait: (s) => s.status.unstaged.some((f) => f.name === 'README.md'),
      },
      {
        el: T, side: 'left',
        title: 'status — the overview',
        desc: cmd('git status') + `The first command to reach for, always. It lists what's modified, staged, and untracked — matching the Source Control panel in the sidebar.`,
        hint: 'continues after you run it',
        waitCmd: /^git\s+status/,
      },
      {
        el: T, side: 'left',
        title: 'diff — the exact lines',
        desc: cmd('git diff') + `Shows every changed line: <span style="color:#3d8a55">+ added</span> and <span style="color:#b8503a">− removed</span>. This is what you review before staging.`,
        hint: 'continues after you run it',
        waitCmd: /^git\s+diff/,
      },
      {
        el: T, side: 'left',
        title: 'Stage and inspect again',
        desc: `Stage the change:` + cmd('git add README.md') + `Plain <code>git diff</code> now shows nothing — the change moved to the index. <code>git diff --staged</code> shows what's queued for commit.`,
        hint: 'continues when the file is staged',
        wait: (s) => s.status.staged.some((f) => f.name === 'README.md'),
      },
      {
        el: T, side: 'left',
        title: 'Commit it',
        desc: cmd('git commit -m "update readme"'),
        hint: 'continues when the commit lands',
        wait: (s) => s.commits.length >= 2,
      },
      {
        el: T, side: 'left',
        title: 'log — the history',
        desc: cmd('git log --oneline') + `Every commit, newest first — the same story the graph above tells visually. Try <code>git log -p</code> later to see each commit's diff.`,
        hint: 'continues after you run it',
        waitCmd: /^git\s+log/,
      },
      {
        title: 'Lesson complete ✦',
        desc: `<p><b>status</b> = what's going on · <b>diff</b> = exact lines · <b>log</b> = what happened.</p><p>Next: undoing mistakes — git's safety nets.</p>`,
      },
    ],
  },

  {
    id: 'undo-basics',
    level: 'beginner',
    title: '3 · Undoing mistakes',
    blurb: 'restore a wrecked file, unstage, and amend a bad commit message — the everyday safety nets.',
    minutes: 5,
    setup: [
      { cmd: 'git init' },
      { write: { path: 'README.md', content: '# Recipe\n\n- flour\n- water\n- salt\n' } },
      { cmd: 'git add .' },
      { cmd: 'git commit -m "recipe: v1"' },
    ],
    steps: [
      {
        title: 'Undoing mistakes 🧯',
        desc: `<p>Scenario: a healthy repo with a committed recipe. You're about to break things on purpose — then learn the three everyday undo tools.</p>`,
      },
      {
        el: E, side: 'top',
        title: 'Wreck the file',
        desc: `Delete the whole recipe, type some nonsense, and <b>⌘S</b>. Don't worry — the last commit still holds the good version.`,
        hint: 'continues when the damage is saved',
        wait: (s) => s.status.unstaged.some((f) => f.name === 'README.md'),
      },
      {
        el: T, side: 'left',
        title: 'restore — undo working changes',
        desc: cmd('git restore README.md') + `This throws away <i>uncommitted</i> changes and rewrites the file from the last commit. Watch the editor snap back.`,
        hint: 'continues when the working directory is clean',
        wait: (s) => s.status.unstaged.length === 0 && s.status.untracked.length === 0,
      },
      {
        el: E, side: 'top',
        title: 'Now a good change — staged too early',
        desc: `Add a real ingredient line, <b>⌘S</b>, then stage it:` + cmd('git add README.md'),
        hint: 'continues when the change is staged',
        wait: (s) => s.status.staged.some((f) => f.name === 'README.md'),
      },
      {
        el: T, side: 'left',
        title: 'restore --staged — unstage',
        desc: cmd('git restore --staged README.md') + `Pulls the change back out of the staging area — the edit stays safe in your working directory. (Stage it again after.)`,
        hint: 'continues when it moves back to the working directory',
        wait: (s) => s.status.staged.length === 0 && s.status.unstaged.some((f) => f.name === 'README.md'),
      },
      {
        el: T, side: 'left',
        title: 'Commit with a typo',
        desc: `Commit it — with this exact clumsy message:` + cmd('git commit -am "add ingrediant"'),
        hint: 'continues when the commit lands',
        wait: (s) => s.commits.length >= 2,
      },
      {
        el: T, side: 'left',
        title: 'amend — fix the last commit',
        desc: cmd('git commit --amend -m "add ingredient"') + `Amend <i>replaces</i> the last commit — watch the graph: the node is swapped for a new one (its hash changed).`,
        hint: 'continues when the message is fixed',
        wait: (s) => headCommit(s)?.subject === 'add ingredient',
      },
      {
        title: 'Lesson complete ✦',
        desc: `<p><b>restore</b> = undo working changes · <b>restore --staged</b> = unstage · <b>amend</b> = fix the last commit.</p><p>Rule of thumb: amend is safe <i>until you push</i>. Next up: branching.</p>`,
      },
    ],
  },

  /* ————————————————————————————————————————————— intermediate */
  {
    id: 'branching',
    level: 'intermediate',
    title: '4 · Branching',
    blurb: 'Branches are cheap movable pointers. Create one, commit on it, and hop between worlds.',
    minutes: 4,
    setup: [
      { cmd: 'git init' },
      { write: { path: 'README.md', content: '# Shop\n\nOpen 9–17.\n' } },
      { cmd: 'git add .' },
      { cmd: 'git commit -m "shop: open"' },
      { write: { path: 'README.md', content: '# Shop\n\nOpen 9–17.\nCard payments accepted.\n' } },
      { cmd: 'git commit -am "shop: card payments"' },
    ],
    steps: [
      {
        title: 'Branching 🌿',
        desc: `<p>Scenario: a shop site with two commits on <b>main</b>. You want to experiment without touching the stable line.</p><p>A branch is just a <b>movable pointer to a commit</b> — creating one costs nothing.</p>`,
      },
      {
        el: T, side: 'left',
        title: 'Create and switch',
        desc: cmd('git switch -c feature/cart') + `<code>-c</code> creates the branch and moves HEAD onto it in one step. (Old-style: <code>git checkout -b</code>.)`,
        hint: 'continues when HEAD is on feature/cart',
        wait: (s) => s.head.branch === 'feature/cart',
      },
      {
        el: G, side: 'bottom',
        title: 'Two chips, one commit',
        desc: `Look at the tip: <b>main</b> and <b>feature/cart</b> point at the <i>same commit</i> — the HEAD tag moved to the new branch. No files were copied; nothing was duplicated.`,
      },
      {
        el: E, side: 'top',
        title: 'Commit on the branch',
        desc: `Add a line about the shopping cart, <b>⌘S</b>, then:` + cmd('git commit -am "cart: first draft"'),
        hint: 'continues when the branch moves ahead',
        wait: (s) => s.head.branch === 'feature/cart' && s.head.commit !== branch(s, 'main')?.tip,
      },
      {
        el: G, side: 'bottom',
        title: 'The lanes diverge',
        desc: `feature/cart got its own lane and moved ahead; <b>main</b> stayed put. That's the whole point — parallel worlds, one repo.`,
      },
      {
        el: T, side: 'left',
        title: 'Hop back',
        desc: cmd('git switch main') + `Watch the editor: your cart line vanishes — main never had it. Switching branches rewrites the working directory to that branch's snapshot.`,
        hint: 'continues when HEAD is back on main',
        wait: (s) => s.head.branch === 'main',
      },
      {
        title: 'Lesson complete ✦',
        desc: `<p>Branches: cheap, instant, disposable. Make one per idea.</p><p>Your cart work is safe on its branch — the next lesson brings it home with <b>merge</b>.</p>`,
      },
    ],
  },

  {
    id: 'merging',
    level: 'intermediate',
    title: '5 · Merging',
    blurb: 'Fast-forward vs real merge commits — bring two finished branches back into main.',
    minutes: 4,
    setup: [
      { cmd: 'git init' },
      { write: { path: 'README.md', content: '# Menu\n\n- soup\n' } },
      { cmd: 'git add .' },
      { cmd: 'git commit -m "menu: start"' },
      { cmd: 'git switch -c feature/salad' },
      { write: { path: 'README.md', content: '# Menu\n\n- soup\n- salad\n' } },
      { cmd: 'git commit -am "menu: add salad"' },
      { cmd: 'git switch main' },
      { cmd: 'git switch -c feature/notes' },
      { write: { path: 'notes.md', content: 'remember: order napkins\n' } },
      { cmd: 'git add notes.md' },
      { cmd: 'git commit -m "notes: napkins"' },
      { cmd: 'git switch main' },
    ],
    steps: [
      {
        title: 'Merging 🔀',
        desc: `<p>Scenario: two finished feature branches — <b>feature/salad</b> and <b>feature/notes</b> — both branched from main. Time to bring them home.</p><p>You'll see git's two merge behaviours: <b>fast-forward</b> and a <b>real merge commit</b>.</p>`,
      },
      {
        el: T, side: 'left',
        title: 'Merge #1: fast-forward',
        desc: cmd('git merge feature/salad') + `main hasn't moved since salad branched off, so git just <i>slides the main pointer forward</i>. No new commit — watch the chips reunite.`,
        hint: 'continues when main catches up to feature/salad',
        wait: (s) => branch(s, 'main')?.tip === branch(s, 'feature/salad')?.tip,
      },
      {
        el: T, side: 'left',
        title: 'Merge #2: a real merge',
        desc: cmd('git merge feature/notes') + `Now main and feature/notes have <i>diverged</i> — git must weave two histories together, which creates a <b>merge commit</b> with two parents.`,
        hint: 'continues when the merge commit lands',
        wait: (s) => s.head.branch === 'main' && (headCommit(s)?.parents.length || 0) === 2,
      },
      {
        el: G, side: 'bottom',
        title: 'Read the shape',
        desc: `The merge commit is where two edges flow in — one from each parent. Fast-forwards leave a straight line; real merges leave this braid. Both histories survive intact.`,
      },
      {
        el: T, side: 'left',
        title: 'Clean up the labels',
        desc: `Merged branches are done — delete the pointers:` + cmd('git branch -d feature/salad') + cmd('git branch -d feature/notes') + `The commits stay; only the labels go. Watch their lanes turn muted.`,
        hint: 'continues when only main remains',
        wait: (s) => s.branches.length === 1,
      },
      {
        title: 'Lesson complete ✦',
        desc: `<p>Fast-forward = pointer slide · diverged = merge commit with two parents.</p><p>But what if both branches touched the <i>same line</i>? Next lesson: conflicts — without fear.</p>`,
      },
    ],
  },

  {
    id: 'conflicts',
    level: 'intermediate',
    title: '6 · Merge conflicts',
    blurb: 'Cause a conflict on purpose, read the markers, fix the file, and finish the merge.',
    minutes: 5,
    setup: [
      { cmd: 'git init' },
      { write: { path: 'README.md', content: 'greeting: hello\n' } },
      { cmd: 'git add .' },
      { cmd: 'git commit -m "greeting: start"' },
      { cmd: 'git switch -c feature/french' },
      { write: { path: 'README.md', content: 'greeting: bonjour\n' } },
      { cmd: 'git commit -am "greeting: french"' },
      { cmd: 'git switch main' },
      { write: { path: 'README.md', content: 'greeting: hola\n' } },
      { cmd: 'git commit -am "greeting: spanish"' },
    ],
    steps: [
      {
        title: 'Merge conflicts 💥',
        desc: `<p>Scenario: <b>main</b> says <code>hola</code>, <b>feature/french</b> says <code>bonjour</code> — the <i>same line</i>, changed both ways. Git can't pick for you.</p><p>Conflicts feel scary exactly once. Let's defuse that.</p>`,
      },
      {
        el: T, side: 'left',
        title: 'Trigger it',
        desc: cmd('git merge feature/french') + `Git will stop mid-merge and ask you to decide. Nothing is broken — the merge is just <i>paused</i>.`,
        hint: 'continues when the conflict appears',
        wait: (s) => s.inProgress === 'merge' && s.status.conflicted.length > 0,
      },
      {
        el: WORK, side: 'bottom',
        title: 'The conflict is visible everywhere',
        desc: `README.md pulses red here, and the header shows <i>merge in progress</i>. Git also wrote both versions into the file, fenced by markers: <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> yours · <code>=======</code> divider · <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code> theirs.`,
      },
      {
        el: E, side: 'top',
        title: 'You are the merge tool',
        desc: `Edit the file into the version you actually want — delete the three marker lines and keep (or combine!) a greeting. Then <b>⌘S</b>.`,
        hint: 'continues when the saved file has no markers left',
        wait: (s) => s.inProgress === 'merge' && s.file.content.trim().length > 0 && !s.file.content.includes('<<<<<<<'),
      },
      {
        el: T, side: 'left',
        title: 'Mark it resolved',
        desc: cmd('git add README.md') + `Staging a conflicted file tells git: <i>this one's settled</i>.`,
        hint: 'continues when the conflict list is empty',
        wait: (s) => s.status.conflicted.length === 0 && s.status.staged.length > 0,
      },
      {
        el: T, side: 'left',
        title: 'Finish the merge',
        desc: cmd('git commit -m "merge: settle the greeting"') + `The paused merge completes as a normal merge commit with two parents.`,
        hint: 'continues when the merge commit lands',
        wait: (s) => s.inProgress === null && (headCommit(s)?.parents.length || 0) === 2,
      },
      {
        title: 'Lesson complete ✦',
        desc: `<p>Conflict = git pausing to ask. Fix the file → <b>add</b> → <b>commit</b>. Escape hatch if you panic: <code>git merge --abort</code> rewinds everything.</p>`,
      },
    ],
  },

  /* ———————————————————————————————————————————————— advanced */
  {
    id: 'team-sync',
    level: 'advanced',
    title: '7 · Syncing with a team',
    blurb: 'A (simulated) teammate pushed while you weren’t looking. fetch, pull, and push through it.',
    minutes: 5,
    setup: [
      { cmd: 'git init' },
      { write: { path: 'README.md', content: '# Team log\n\n- day 1: project setup\n' } },
      { cmd: 'git add .' },
      { cmd: 'git commit -m "log: day 1"' },
      { cmd: 'git remote add origin ../remote.git' },
      { cmd: 'git push -u origin main' },
      { teammate: {
          path: 'README.md',
          content: '# Team log\n\n- day 1: project setup\n- day 2: teammate shipped the login page\n',
          message: 'log: day 2 (teammate)',
        } },
    ],
    steps: [
      {
        title: 'Syncing with a team 🛰',
        desc: `<p>Scenario: your repo is connected to <b>origin</b> and you pushed yesterday. Overnight, a teammate pushed a new commit — <i>and your repo has no idea yet</i>.</p>`,
      },
      {
        el: G, side: 'bottom',
        title: 'Your stale view',
        desc: `The dashed <b>origin/main</b> chip sits on your commit — that's where origin was <i>last time you looked</i>. The remote has since moved on. Remote-tracking refs never update by themselves.`,
      },
      {
        el: T, side: 'left',
        title: 'fetch — look, don’t touch',
        desc: cmd('git fetch') + `Downloads what's new from origin and updates <b>origin/main</b> — but your <b>main</b> and your files stay exactly as they were. Watch a new node appear.`,
        hint: 'continues when origin/main moves ahead',
        wait: (s) => {
          const m = branch(s, 'main');
          const o = remote(s, 'origin/main');
          return m && o && m.tip !== o.tip;
        },
      },
      {
        el: G, side: 'bottom',
        title: 'Fetched, not merged',
        desc: `The teammate's commit is now in your repo, ahead of main. Safe to inspect: <code>git log origin/main</code>, <code>git diff main origin/main</code>. Your working directory hasn't changed a byte.`,
      },
      {
        el: T, side: 'left',
        title: 'pull — bring it in',
        desc: cmd('git pull') + `pull = fetch + merge into your branch. Since you have nothing new locally, main simply fast-forwards onto the teammate's commit — and the file updates in the editor.`,
        hint: 'continues when main catches up',
        wait: (s) => {
          const m = branch(s, 'main');
          const o = remote(s, 'origin/main');
          return m && o && m.tip === o.tip && s.commits.length >= 2;
        },
      },
      {
        el: E, side: 'top',
        title: 'Your turn to ship',
        desc: `Add a “day 3” line, <b>⌘S</b>, then:` + cmd('git commit -am "log: day 3"') + `Now <i>you're</i> ahead of origin — the chips split again, the other way around.`,
        hint: 'continues when your commit lands',
        wait: (s) => {
          const m = branch(s, 'main');
          const o = remote(s, 'origin/main');
          return s.commits.length >= 3 && m && o && m.tip !== o.tip;
        },
      },
      {
        el: T, side: 'left',
        title: 'push — publish',
        desc: cmd('git push') + `Your commit travels to origin; origin/main catches up to main.`,
        hint: 'continues when origin is up to date',
        wait: (s) => {
          const m = branch(s, 'main');
          const o = remote(s, 'origin/main');
          return s.commits.length >= 3 && m && o && m.tip === o.tip;
        },
      },
      {
        title: 'Lesson complete ✦',
        desc: `<p><b>fetch</b> = look · <b>pull</b> = fetch + merge · <b>push</b> = publish.</p><p>Real teams differ only in scale: pull before you start, push when you're green.</p>`,
      },
    ],
  },

  {
    id: 'rewriting-history',
    level: 'advanced',
    title: '8 · Rewriting history',
    blurb: 'reset --hard to drop a bad commit, rebase to replay a branch — and the golden rule.',
    minutes: 5,
    setup: [
      { cmd: 'git init' },
      { write: { path: 'README.md', content: '# Lab notebook\n\nstep 1: setup\n' } },
      { cmd: 'git add .' },
      { cmd: 'git commit -m "c1: setup"' },
      { cmd: 'git branch feature/ideas' },
      { write: { path: 'README.md', content: '# Lab notebook\n\nstep 1: setup\nstep 2: solid progress\n' } },
      { cmd: 'git commit -am "c2: solid progress"' },
      { write: { path: 'README.md', content: '# Lab notebook\n\nstep 1: setup\nstep 2: solid progress\nstep 3: experimental mess, do not keep\n' } },
      { cmd: 'git commit -am "c3: experimental mess"' },
      { cmd: 'git switch feature/ideas' },
      { write: { path: 'ideas.md', content: '- idea: measure twice\n' } },
      { cmd: 'git add ideas.md' },
      { cmd: 'git commit -m "f1: idea notes"' },
      { cmd: 'git switch main' },
    ],
    steps: [
      {
        title: 'Rewriting history ⚠️',
        desc: `<p>Scenario: main has three commits — and <b>c3 is a mess</b> you never want to see again. There's also <b>feature/ideas</b>, branched long ago from c1.</p><p>History in git is editable. Powerful, sharp, occasionally dangerous.</p>`,
      },
      {
        el: T, side: 'left',
        title: 'reset --hard — drop the last commit',
        desc: cmd('git reset --hard HEAD~1') + `Moves main back one commit and resets your files to match. Watch <b>c3 vanish from the graph</b> — nothing points to it anymore.`,
        hint: 'continues when c3 is gone',
        wait: (s) => s.commits.length === 3 && headCommit(s)?.subject === 'c2: solid progress',
      },
      {
        el: G, side: 'bottom',
        title: 'Where did it go?',
        desc: `Not deleted — <i>orphaned</i>. No branch reaches it, so the graph (and git log) hide it. For ~30 days <code>git reflog</code> can still rescue it. But treat <code>reset --hard</code> as destructive.`,
      },
      {
        el: T, side: 'left',
        title: 'Over to the stale branch',
        desc: cmd('git switch feature/ideas') + `This branch grew from <b>c1</b> — it doesn't know about your c2 work. You could merge main in… or replay the branch on top of it.`,
        hint: 'continues when HEAD is on feature/ideas',
        wait: (s) => s.head.branch === 'feature/ideas',
      },
      {
        el: T, side: 'left',
        title: 'rebase — replay onto main',
        desc: cmd('git rebase main') + `Git lifts f1 off c1 and replays it on top of c2. Watch closely: the old node disappears and a <b>new</b> one appears — same change, <i>different commit</i> (new hash, new parent).`,
        hint: 'continues when the branch sits on top of main',
        wait: (s) => s.head.branch === 'feature/ideas' && headCommit(s)?.parents[0] === branch(s, 'main')?.tip,
      },
      {
        el: G, side: 'bottom',
        title: 'A straight line',
        desc: `Rebase trades the braid of a merge for linear history — tidier to read, at the cost of rewriting commits. Finish it off with a fast-forward: <code>git switch main</code> then <code>git merge feature/ideas</code>, if you like.`,
      },
      {
        title: 'Lesson complete ✦',
        desc: `<p><b>reset --hard</b> moves a branch and discards · <b>rebase</b> replays commits as new ones.</p><p>🥇 The golden rule: <b>never rewrite history you've already pushed</b> — others may have built on it.</p>`,
      },
    ],
  },

  {
    id: 'gitflow-capstone',
    level: 'advanced',
    title: '9 · The Gitflow ritual',
    blurb: 'Capstone: develop, a feature, a release, a tag and a back-merge — draw the classic diagram yourself.',
    minutes: 8,
    setup: [
      { cmd: 'git init' },
      { write: { path: 'README.md', content: '# Product\n\nversion: 0.x (unreleased)\n' } },
      { cmd: 'git add .' },
      { cmd: 'git commit -m "root: project start"' },
    ],
    steps: [
      {
        title: 'The Gitflow ritual 🏁',
        desc: `<p>Capstone time. <b>Gitflow</b> is the classic branching model: <b>main</b> holds releases, <b>develop</b> holds ongoing work, features and releases get their own short-lived branches.</p><p>You'll draw the famous diagram with your own commands.</p>`,
      },
      {
        el: T, side: 'left',
        title: 'The develop line',
        desc: cmd('git switch -c develop') + `All day-to-day work integrates here — main stays pristine for releases.`,
        hint: 'continues when HEAD is on develop',
        wait: (s) => s.head.branch === 'develop',
      },
      {
        el: T, side: 'left',
        title: 'Branch a feature',
        desc: cmd('git switch -c feature/login') + `Features never grow on develop directly — each gets its own branch off develop.`,
        hint: 'continues when HEAD is on feature/login',
        wait: (s) => s.head.branch === 'feature/login',
      },
      {
        el: E, side: 'top',
        title: 'Build the feature',
        desc: `Add a line like <code>login: implemented</code>, <b>⌘S</b>, then:` + cmd('git commit -am "login: implement"'),
        hint: 'continues when the feature has a commit',
        wait: (s) => s.head.branch === 'feature/login' && s.head.commit !== branch(s, 'develop')?.tip,
      },
      {
        el: T, side: 'left',
        title: 'Integrate the feature',
        desc: cmd('git switch develop') + cmd('git merge --no-ff feature/login') + `<code>--no-ff</code> forces a merge commit even though a fast-forward is possible — gitflow wants every feature visible as a bump in history.`,
        hint: 'continues when develop has the merge commit',
        wait: (s) => s.head.branch === 'develop' && (headCommit(s)?.parents.length || 0) === 2,
      },
      {
        el: T, side: 'left',
        title: 'Cut a release branch',
        desc: cmd('git switch -c release/1.0') + `Then update the version line in the editor (e.g. <code>version: 1.0</code>), <b>⌘S</b>, and:` + cmd('git commit -am "release: 1.0"') + `Release branches hold only stabilising work — version bumps, fixes, no new features.`,
        hint: 'continues when release/1.0 has its commit',
        wait: (s) => s.head.branch === 'release/1.0' && s.head.commit !== branch(s, 'develop')?.tip,
      },
      {
        el: T, side: 'left',
        title: 'Ship it to main',
        desc: cmd('git switch main') + cmd('git merge --no-ff release/1.0') + `Main only ever receives release (or hotfix) merges — every commit on main is shippable.`,
        hint: 'continues when main has the release merge',
        wait: (s) => s.head.branch === 'main' && (headCommit(s)?.parents.length || 0) === 2,
      },
      {
        el: T, side: 'left',
        title: 'Tag the release',
        desc: cmd('git tag v1.0') + `Tags are permanent bookmarks — this exact commit is version 1.0, forever.`,
        hint: 'continues when the tag exists',
        wait: (s) => (s.tags || []).some((t) => t.name === 'v1.0'),
      },
      {
        el: T, side: 'left',
        title: 'Back-merge into develop',
        desc: cmd('git switch develop') + cmd('git merge main') + `The release work (version bump) flows back so develop isn't missing anything main has.`,
        hint: 'continues when develop contains main',
        wait: (s) => {
          const m = branch(s, 'main');
          return s.head.branch === 'develop' && m &&
            (s.head.commit === m.tip || (headCommit(s)?.parents || []).includes(m.tip));
        },
      },
      {
        el: G, side: 'bottom',
        title: 'Look at what you drew 🖼',
        desc: `Main on top with a tagged release, develop carrying the work, a feature braided in below — <b>this is the diagram that inspired this app</b>, drawn by your own commands.`,
      },
      {
        title: 'Git School complete 🎓',
        desc: `<p>You've covered the daily loop, inspection, undo, branching, merging, conflicts, team sync, history surgery and gitflow.</p><p>The playground is yours — free-play, break things, <code>reset</code> when needed. That's how it sticks.</p>`,
      },
    ],
  },
];
