// File explorer sidebar: playground tree with git status decorations,
// new file / new folder creation, and deletion.

import { escapeHtml } from './ansi.js';

const FILE_ICONS = [
  [/\.(md|markdown)$/i, '📝'],
  [/\.(js|mjs|ts)$/i, '𝙹𝚂'],
  [/\.(json|jsonc)$/i, '{}'],
  [/\.(html?|css)$/i, '<>'],
  [/./, '📄'],
];

export function initExplorer({ tree, newFileBtn, newFolderBtn, newRow, newInput }, { onOpen, fsOp }) {
  let pendingKind = null; // 'create' | 'mkdir'
  let activePath = null;
  let lastState = null;

  function statusFor(state) {
    const map = new Map(); // path -> {letter, cls}
    const st = state.status || {};
    for (const f of st.staged || []) map.set(f.name, { letter: f.code, cls: f.code === 'A' ? 'add' : f.code === 'D' ? 'del' : 'mod' });
    for (const f of st.unstaged || []) map.set(f.name, { letter: f.code, cls: f.code === 'D' ? 'del' : 'mod' });
    for (const f of st.untracked || []) map.set(f.name, { letter: 'U', cls: 'add' });
    for (const f of st.conflicted || []) map.set(f.name, { letter: '!', cls: 'conf' });
    return map;
  }

  function render(state) {
    lastState = state;
    const files = state.files || [];
    const status = statusFor(state);
    tree.innerHTML = '';
    if (!files.length) {
      tree.innerHTML = '<div class="ft-empty">empty — create a file with ✎ above</div>';
      return;
    }
    for (const f of files) {
      const depth = f.path.split('/').length - 1;
      const name = f.path.split('/').pop();
      const row = document.createElement('div');
      row.className = 'ft-row' + (f.dir ? ' ft-dir' : '') + (f.path === activePath ? ' active' : '');
      row.style.paddingLeft = 16 + depth * 14 + 'px';
      const st = !f.dir ? status.get(f.path) : null;
      const icon = f.dir ? '📁' : (FILE_ICONS.find(([re]) => re.test(name)) || FILE_ICONS.at(-1))[1];
      row.innerHTML =
        `<span class="ft-icon">${icon}</span>` +
        `<span class="ft-name${st ? ` st-${st.cls}-name` : ''}">${escapeHtml(name)}</span>` +
        (st ? `<span class="ft-status st-${st.cls}">${escapeHtml(st.letter)}</span>` : '') +
        `<button class="ft-del" title="Delete">×</button>`;
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('ft-del')) {
          if (confirm(`Delete ${f.path}${f.dir ? ' (and its contents)' : ''}?`)) fsOp('delete', f.path);
          return;
        }
        if (!f.dir) {
          activePath = f.path;
          onOpen(f.path);
          render(lastState);
        }
      });
      tree.appendChild(row);
    }
  }

  function beginNew(kind) {
    pendingKind = kind;
    newRow.hidden = false;
    newInput.value = '';
    newInput.placeholder = kind === 'mkdir' ? 'folder-name' : 'filename.md';
    newInput.focus();
  }

  newFileBtn.addEventListener('click', () => beginNew('create'));
  newFolderBtn.addEventListener('click', () => beginNew('mkdir'));

  newInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') {
      newRow.hidden = true;
      pendingKind = null;
    } else if (e.key === 'Enter') {
      const name = newInput.value.trim();
      newRow.hidden = true;
      if (!name || !pendingKind) return;
      const kind = pendingKind;
      pendingKind = null;
      await fsOp(kind, name);
      if (kind === 'create') {
        activePath = name;
        onOpen(name);
      }
    }
  });
  newInput.addEventListener('blur', () => { newRow.hidden = true; });

  function setActive(path) {
    activePath = path;
    if (lastState) render(lastState);
  }

  return { render, setActive };
}
