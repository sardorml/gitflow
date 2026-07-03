// Tabbed editor: open any playground file, edit, ⌘S to save.
// Markdown files get a toggleable side-by-side live preview.

import { escapeHtml } from './ansi.js';

const isMd = (p) => /\.(md|markdown)$/i.test(p);

export function initEditor({ tabstrip, textarea, preview, saveBtn, previewToggle, emptyEl }, { readFile, writeFile }) {
  const tabs = new Map(); // path -> { content, disk, dirty, deleted, binary }
  let active = null;
  let previewOn = true;
  let previewTimer = null;
  let manifest = new Map();  // path -> {mtime, size} from the last state
  let statusMap = new Map(); // path -> css status suffix ('mod'|'add'|'conf')

  /* ————————————————————————————— rendering */

  function renderTabs() {
    tabstrip.innerHTML = '';
    for (const [path, tab] of tabs) {
      const el = document.createElement('div');
      const st = statusMap.get(path);
      el.className = [
        'tab',
        path === active ? 'active' : '',
        tab.dirty ? 'dirty' : '',
        st ? `st-${st}-tab` : '',
      ].filter(Boolean).join(' ');
      el.innerHTML =
        `<span class="tab-name">${escapeHtml(path.split('/').pop())}${tab.deleted ? ' (deleted)' : ''}</span>` +
        `<span class="tab-dirty">●</span>` +
        `<span class="tab-close" title="Close">×</span>`;
      el.title = path;
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-close')) close(path);
        else activate(path);
      });
      tabstrip.appendChild(el);
    }
  }

  function renderPreview() {
    if (!active || !isMd(active)) return;
    const v = tabs.get(active)?.content ?? '';
    if (window.marked) preview.innerHTML = window.marked.parse(v, { gfm: true, breaks: true });
    else preview.innerHTML = `<pre>${escapeHtml(v)}</pre>`;
  }

  function show() {
    const tab = active ? tabs.get(active) : null;
    if (!tab) {
      textarea.hidden = true;
      preview.hidden = true;
      emptyEl.style.display = 'flex';
      saveBtn.style.visibility = 'hidden';
      previewToggle.hidden = true;
      return;
    }
    emptyEl.style.display = 'none';
    saveBtn.style.visibility = 'visible';
    textarea.hidden = false;
    if (textarea.value !== tab.content) textarea.value = tab.content;
    const md = isMd(active);
    previewToggle.hidden = !md;
    previewToggle.classList.toggle('on', md && previewOn);
    preview.hidden = !(md && previewOn);
    if (md && previewOn) renderPreview();
  }

  /* ————————————————————————————— tab lifecycle */

  async function open(path, { activate: focus = true } = {}) {
    if (!tabs.has(path)) {
      let f;
      try { f = await readFile(path); } catch { f = { exists: false, content: '' }; }
      const content = f.exists && !f.binary ? f.content : '';
      tabs.set(path, { content, disk: content, dirty: false, deleted: !f.exists, binary: !!f.binary });
    }
    if (focus) active = path;
    renderTabs();
    show();
  }

  function activate(path) {
    if (!tabs.has(path)) return;
    active = path;
    renderTabs();
    show();
  }

  function close(path) {
    const tab = tabs.get(path);
    if (!tab) return;
    if (tab.dirty && !confirm(`${path} has unsaved changes — close anyway?`)) return;
    tabs.delete(path);
    if (active === path) active = [...tabs.keys()].pop() ?? null;
    renderTabs();
    show();
  }

  async function save() {
    const tab = active && tabs.get(active);
    if (!tab) return;
    await writeFile(active, tab.content);
    tab.disk = tab.content;
    tab.dirty = false;
    tab.deleted = false;
    renderTabs();
  }

  async function resetTo(path) {
    tabs.clear();
    active = null;
    if (path) await open(path);
    else { renderTabs(); show(); }
  }

  /* ————————————————————————————— events */

  textarea.addEventListener('input', () => {
    const tab = active && tabs.get(active);
    if (!tab) return;
    tab.content = textarea.value;
    const wasDirty = tab.dirty;
    tab.dirty = tab.content !== tab.disk;
    if (tab.dirty !== wasDirty) renderTabs();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 120);
  });

  textarea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      textarea.setRangeText('  ', textarea.selectionStart, textarea.selectionEnd, 'end');
      textarea.dispatchEvent(new Event('input'));
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && e.target !== textarea) {
      e.preventDefault();
      save();
    }
  });

  saveBtn.addEventListener('click', save);
  previewToggle.addEventListener('click', () => {
    previewOn = !previewOn;
    show();
  });

  /* ————————————————————————————— state sync */

  function applyState(state) {
    statusMap = new Map();
    const st = state.status || {};
    for (const f of st.unstaged || []) statusMap.set(f.name, f.code === 'D' ? 'del' : 'mod');
    for (const f of st.staged || []) if (!statusMap.has(f.name)) statusMap.set(f.name, f.code === 'A' ? 'add' : 'mod');
    for (const f of st.untracked || []) statusMap.set(f.name, 'add');
    for (const f of st.conflicted || []) statusMap.set(f.name, 'conf');

    const files = new Map((state.files || []).filter((f) => !f.dir).map((f) => [f.path, f]));
    for (const [path, tab] of tabs) {
      const f = files.get(path);
      if (!f) {
        tab.deleted = true;
        continue;
      }
      const known = manifest.get(path);
      const changed = known && (known.mtime !== f.mtime || known.size !== f.size);
      tab.deleted = false;
      if (changed && !tab.dirty) {
        readFile(path).then((r) => {
          const t = tabs.get(path);
          if (!t || t.dirty) return;
          t.content = t.disk = r.exists && !r.binary ? r.content : '';
          t.deleted = !r.exists;
          if (active === path) {
            textarea.value = t.content;
            renderPreview();
          }
        }).catch(() => {});
      }
    }
    manifest = files;
    renderTabs();
  }

  const activePath = () => active;

  show();
  return { open, save, applyState, resetTo, activePath };
}
