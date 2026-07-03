// Minimal ANSI SGR → HTML converter, tuned for git's colored output.

const FG = {
  30: 'k', 31: 'r', 32: 'g', 33: 'y', 34: 'b', 35: 'm', 36: 'c', 37: 'w',
  90: 'bk', 91: 'br', 92: 'bg', 93: 'by', 94: 'bb', 95: 'bm', 96: 'bc', 97: 'bw',
};

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function ansiToHtml(text) {
  let out = '';
  const cls = new Set();
  const flush = (chunk) => {
    if (!chunk) return;
    const c = [...cls].map((x) => 'a-' + x).join(' ');
    out += c ? `<span class="${c}">${escapeHtml(chunk)}</span>` : escapeHtml(chunk);
  };
  const dropFg = () => { for (const c of [...cls]) if (c.startsWith('fg')) cls.delete(c); };

  // SGR sequences we interpret; every other escape sequence gets stripped.
  const re = /\x1b\[([0-9;]*)m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[\[()][0-9;?]*[A-Za-z]|\x1b./g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    flush(text.slice(last, m.index));
    last = re.lastIndex;
    if (m[1] === undefined) continue;
    const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
    for (const code of codes) {
      if (code === 0) cls.clear();
      else if (code === 1) cls.add('bold');
      else if (code === 2) cls.add('dim');
      else if (code === 4) cls.add('ul');
      else if (code === 7) cls.add('inv');
      else if (code === 22) { cls.delete('bold'); cls.delete('dim'); }
      else if (code === 24) cls.delete('ul');
      else if (code === 27) cls.delete('inv');
      else if (code === 39) dropFg();
      else if (FG[code]) { dropFg(); cls.add('fg' + FG[code]); }
      // background colors (40–47, 100–107) and the rest: ignored
    }
  }
  flush(text.slice(last));
  return out;
}
