// Source Control sidebar (VS Code style). Every button runs a REAL git
// command through the terminal, so learners always see the CLI equivalent.

import { escapeHtml } from './ansi.js';

export function initSCM(
  { msg, commitBtn, stagedList, changesList, stagedCount, changesCount, badge },
  { runGit }
) {
  let lastStatus = { staged: [], unstaged: [], untracked: [], conflicted: [] };

  const q = (name) => `"${name.replace(/"/g, '\\"')}"`;

  function row({ name, letter, cls, actions }) {
    const el = document.createElement('div');
    el.className = 'scm-row';
    el.innerHTML =
      `<span class="ft-name st-${cls}-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>` +
      actions.map((a) => `<button class="scm-act" data-cmd="${escapeHtml(a.cmd)}" title="${escapeHtml(a.title)}"${a.confirm ? ` data-confirm="${escapeHtml(a.confirm)}"` : ''}>${a.glyph}</button>`).join('') +
      `<span class="ft-status st-${cls}">${escapeHtml(letter)}</span>`;
    el.querySelectorAll('.scm-act').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.confirm && !confirm(btn.dataset.confirm)) return;
        runGit(btn.dataset.cmd);
      });
    });
    return el;
  }

  function render(state) {
    const st = state.status || { staged: [], unstaged: [], untracked: [], conflicted: [] };
    lastStatus = st;

    stagedList.innerHTML = '';
    for (const f of st.staged) {
      stagedList.appendChild(row({
        name: f.name,
        letter: f.code,
        cls: f.code === 'A' ? 'add' : f.code === 'D' ? 'del' : 'mod',
        actions: [{ glyph: '−', title: `Unstage — git restore --staged ${f.name}`, cmd: `git restore --staged ${q(f.name)}` }],
      }));
    }
    if (!st.staged.length) stagedList.innerHTML = '<div class="scm-empty">nothing staged</div>';

    changesList.innerHTML = '';
    for (const f of st.conflicted) {
      changesList.appendChild(row({
        name: f.name, letter: '!', cls: 'conf',
        actions: [{ glyph: '+', title: `Mark resolved — git add ${f.name}`, cmd: `git add ${q(f.name)}` }],
      }));
    }
    for (const f of st.unstaged) {
      changesList.appendChild(row({
        name: f.name, letter: f.code, cls: f.code === 'D' ? 'del' : 'mod',
        actions: [
          { glyph: '↶', title: `Discard — git restore ${f.name}`, cmd: `git restore ${q(f.name)}`, confirm: `Discard changes to ${f.name}? This rewrites it from the last commit.` },
          { glyph: '+', title: `Stage — git add ${f.name}`, cmd: `git add ${q(f.name)}` },
        ],
      }));
    }
    for (const f of st.untracked) {
      changesList.appendChild(row({
        name: f.name, letter: 'U', cls: 'add',
        actions: [{ glyph: '+', title: `Stage — git add ${f.name}`, cmd: `git add ${q(f.name)}` }],
      }));
    }
    const workingTotal = st.unstaged.length + st.untracked.length + st.conflicted.length;
    if (!workingTotal) changesList.innerHTML = '<div class="scm-empty">clean working tree</div>';

    stagedCount.textContent = st.staged.length;
    changesCount.textContent = workingTotal;
    const total = workingTotal + st.staged.length;
    badge.hidden = !total || !state.repo;
    badge.textContent = total;
  }

  async function commit() {
    const message = msg.value.trim();
    if (!message) {
      msg.focus();
      msg.placeholder = 'a commit message is required!';
      return;
    }
    if (!lastStatus.staged.length) {
      const workingTotal = lastStatus.unstaged.length + lastStatus.untracked.length;
      if (!workingTotal) return;
      if (!confirm('Nothing is staged. Stage ALL changes and commit? (runs: git add -A)')) return;
      const add = await runGit('git add -A');
      if (add.code !== 0) return;
    }
    const res = await runGit(`git commit -m "${message.replace(/"/g, '\\"')}"`);
    if (res.code === 0) {
      msg.value = '';
      msg.placeholder = 'Message (⌘Enter to commit)';
    }
  }

  commitBtn.addEventListener('click', commit);
  msg.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  });

  return { render };
}
