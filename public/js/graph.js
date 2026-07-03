// Commit-graph layout + animation.
// computeLayout() is pure (testable in Node); initGraph() owns the SVG/DOM.

import { escapeHtml } from './ansi.js';

const X0 = 90;      // x of the first commit
const XSTEP = 64;   // gap between commits
const Y0 = 128;     // y of the first lane (leaves room for chip stacks)
const YSTEP = 64;   // gap between lanes
const R = 9;        // node radius

export function branchType(name) {
  if (name === 'main' || name === 'master' || name === 'trunk') return 'main';
  if (/^hotfix([/-]|$)/.test(name)) return 'hotfix';
  if (/^release([/-]|$)/.test(name)) return 'release';
  if (name === 'develop' || name === 'dev' || name === 'development') return 'develop';
  return 'feature';
}
// Claim order decides which branch "owns" shared history (long-lived branches
// first); row order is the visual gitflow stack from top to bottom.
const CLAIM_RANK = { main: 0, develop: 1, release: 2, hotfix: 3, feature: 4 };
const ROW_RANK = { main: 0, hotfix: 1, release: 2, develop: 3, feature: 4, anon: 9 };
const CHIP_ORDER = { head: 0, branch: 1, tag: 2, remote: 3 };

export function computeLayout(state) {
  const commits = state.commits || [];
  const head = state.head || {};
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const idx = new Map(commits.map((c, i) => [c.hash, i]));

  // ——— lanes: each branch claims its first-parent chain, gitflow-ranked
  const laneOf = new Map();
  const lanes = [];
  const claim = (tip, type) => {
    const chain = [];
    let h = tip;
    while (h && byHash.has(h) && !laneOf.has(h)) {
      chain.push(h);
      h = byHash.get(h).parents[0];
    }
    if (!chain.length) return null;
    const lane = lanes.length;
    lanes.push({ type });
    for (const c of chain) laneOf.set(c, lane);
    return lane;
  };

  const sortedBranches = [...(state.branches || [])].sort((a, b) => {
    const r = CLAIM_RANK[branchType(a.name)] - CLAIM_RANK[branchType(b.name)];
    if (r) return r;
    const ia = idx.get(a.tip) ?? 0;
    const ib = idx.get(b.tip) ?? 0;
    return ia - ib || (a.name < b.name ? -1 : 1);
  });
  for (const b of sortedBranches) claim(b.tip, branchType(b.name));
  // leftovers: merged-and-deleted branches, detached islands — newest first
  for (let i = commits.length - 1; i >= 0; i--) {
    if (!laneOf.has(commits[i].hash)) claim(commits[i].hash, 'anon');
  }

  // reorder lanes into the visual gitflow stack (stable within equal rank)
  const rowOrder = lanes.map((_, i) => i)
    .sort((a, b) => (ROW_RANK[lanes[a].type] - ROW_RANK[lanes[b].type]) || (a - b));
  const laneRow = new Map(rowOrder.map((oldIdx, newIdx) => [oldIdx, newIdx]));
  const rows = rowOrder.map((i) => lanes[i]);
  const rowOf = (hash) => laneRow.get(laneOf.get(hash));

  // ——— refs per commit (for hover details)
  const refsByHash = new Map();
  const addRef = (hash, ref) => {
    if (!byHash.has(hash)) return;
    if (!refsByHash.has(hash)) refsByHash.set(hash, []);
    refsByHash.get(hash).push(ref);
  };
  for (const b of state.branches || []) addRef(b.tip, { kind: 'branch', type: branchType(b.name), text: b.name });
  for (const t of state.tags || []) addRef(t.tip, { kind: 'tag', text: t.name });
  for (const r of state.remotes || []) addRef(r.tip, { kind: 'remote', text: r.name });

  // ——— nodes
  const nodes = commits.map((c, i) => ({
    hash: c.hash,
    short: c.short,
    subject: c.subject,
    author: c.author,
    time: c.time,
    parents: c.parents,
    refs: refsByHash.get(c.hash) || [],
    x: X0 + i * XSTEP,
    y: Y0 + rowOf(c.hash) * YSTEP,
    type: lanes[laneOf.get(c.hash)].type,
    isHead: head.commit === c.hash,
  }));

  // ——— edges (child ← parent); bend near parent when branching out,
  //     near child when merging in
  const edges = [];
  for (const c of commits) {
    c.parents.forEach((p, k) => {
      if (!byHash.has(p)) return;
      const sameLane = laneOf.get(p) === laneOf.get(c.hash);
      edges.push({
        key: `${p.slice(0, 10)}>${c.hash.slice(0, 10)}`,
        parent: p,
        child: c.hash,
        bend: sameLane ? 'none' : k === 0 ? 'start' : 'end',
      });
    });
  }

  // ——— ref chips, stacked above their commit
  const chipsByHash = new Map();
  const addChip = (hash, chip) => {
    if (!byHash.has(hash)) return;
    if (!chipsByHash.has(hash)) chipsByHash.set(hash, []);
    chipsByHash.get(hash).push(chip);
  };
  for (const b of sortedBranches) {
    addChip(b.tip, { key: 'b:' + b.name, kind: 'branch', text: b.name, type: branchType(b.name), head: head.branch === b.name });
  }
  if (head.detached && head.commit) addChip(head.commit, { key: 'HEAD', kind: 'head', text: 'HEAD' });
  for (const t of state.tags || []) addChip(t.tip, { key: 't:' + t.name, kind: 'tag', text: t.name });
  for (const r of state.remotes || []) addChip(r.tip, { key: 'r:' + r.name, kind: 'remote', text: r.name });

  const chips = [];
  for (const [hash, list] of chipsByHash) {
    const x = X0 + idx.get(hash) * XSTEP;
    const y = Y0 + rowOf(hash) * YSTEP;
    list.sort((a, b) => CHIP_ORDER[a.kind] - CHIP_ORDER[b.kind]);
    list.forEach((c, k) => chips.push({ ...c, x, y: y - 36 - k * 27 }));
  }

  // ——— ghost node: uncommitted changes hovering ahead of HEAD
  const st = state.status || {};
  const changeCount =
    (st.staged?.length || 0) + (st.unstaged?.length || 0) +
    (st.untracked?.length || 0) + (st.conflicted?.length || 0);
  let ghost = null;
  if (changeCount > 0 && head.commit && idx.has(head.commit)) {
    const row = rowOf(head.commit);
    let maxRowX = X0;
    for (const n of nodes) if (rowOf(n.hash) === row) maxRowX = Math.max(maxRowX, n.x);
    ghost = { x: maxRowX + XSTEP, y: Y0 + row * YSTEP, count: changeCount, from: head.commit };
    chips.push({
      key: 'ghost-label', kind: 'ghost',
      text: `+${changeCount} change${changeCount === 1 ? '' : 's'}`,
      x: ghost.x, y: ghost.y - 36,
    });
  }

  const maxX = Math.max(X0, ...nodes.map((n) => n.x), ghost ? ghost.x : 0);
  return {
    lanes: rows, nodes, edges, chips, ghost,
    width: maxX + 150,
    height: Math.max(Y0 + Math.max(rows.length, 1) * YSTEP + 24, 220),
  };
}

/* ————————————————————————————————————————————— rendering + animation */

const NS = 'http://www.w3.org/2000/svg';
const DUR = 550;

function edgePath(x1, y1, x2, y2, bend) {
  if (Math.abs(y1 - y2) < 0.5) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const span = Math.max(x2 - x1, 12);
  const w = Math.min(46, span);
  if (bend === 'end') {
    const xa = x2 - w;
    return `M ${x1} ${y1} L ${xa} ${y1} C ${xa + w / 2} ${y1} ${xa + w / 2} ${y2} ${x2} ${y2}`;
  }
  const xa = x1 + w;
  return `M ${x1} ${y1} C ${x1 + w / 2} ${y1} ${x1 + w / 2} ${y2} ${xa} ${y2} L ${x2} ${y2}`;
}

export function initGraph({ svg, chipLayer, content, scroll, empty }) {
  const gGuides = document.createElementNS(NS, 'g');
  const gEdges = document.createElementNS(NS, 'g');
  const gNodes = document.createElementNS(NS, 'g');
  svg.append(gGuides, gEdges, gNodes);

  const els = new Map();   // key -> {kind, el, meta?}
  const cur = new Map();   // key -> live animated values {x,y,s,o}
  const from = new Map();  // key -> values at animation start
  const goal = new Map();  // key -> target values (+remove flag)
  const chipEls = new Map();
  let rafId = null;
  let t0 = 0;
  let lastWidth = 0;

  const circle = (r, cls) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', r);
    c.setAttribute('class', cls);
    return c;
  };

  function mkNode() {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'node');
    g.append(circle(R + 5.5, 'ring'), circle(R, 'core'));
    return g;
  }
  function updateNode(rec, n) {
    rec.el.classList.toggle('is-head', !!n.isHead);
    rec.el.querySelector('.core').setAttribute('class', 'core fill-' + n.type);
    rec.data = n;
  }

  /* ————————————————————— hover tooltip */

  const tip = document.createElement('div');
  tip.id = 'graph-tip';
  tip.hidden = true;
  document.body.appendChild(tip);

  function fmtTime(sec) {
    if (!sec) return '';
    const diff = Date.now() / 1000 - sec;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(sec * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function tipHtml(d) {
    if (d.ghost) {
      return `<div class="gt-subject">Uncommitted changes</div>` +
        `<div class="gt-meta">${d.count} file${d.count === 1 ? '' : 's'} in flight — ` +
        `<b>git add</b> + <b>git commit</b> turns them into a real node</div>`;
    }
    const refs = (d.refs || []).map((r) =>
      `<span class="gt-ref gt-ref-${r.kind}${r.type ? ' type-' + r.type : ''}">${escapeHtml(r.text)}</span>`
    ).join('');
    const head = d.isHead ? `<span class="gt-headpill">HEAD</span>` : '';
    const merge = d.parents.length > 1 ? ` · merge commit (${d.parents.length} parents)` : '';
    return `<div class="gt-row"><span class="gt-hash" title="${escapeHtml(d.hash)}">${escapeHtml(d.short)}</span>${head}${refs}</div>` +
      `<div class="gt-subject">${escapeHtml(d.subject)}</div>` +
      `<div class="gt-meta">${escapeHtml(d.author)} · ${fmtTime(d.time)}${merge}</div>`;
  }

  function showTip(rec) {
    if (!rec.data) return;
    tip.innerHTML = tipHtml(rec.data);
    tip.hidden = false;
    const r = rec.el.querySelector('.core').getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - tw - 8));
    let y = r.top - th - 10;
    if (y < 8) y = r.bottom + 10;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    requestAnimationFrame(() => tip.classList.add('show'));
  }
  function hideTip() {
    tip.hidden = true;
    tip.classList.remove('show');
  }
  function bindHover(rec) {
    rec.el.addEventListener('mouseenter', () => showTip(rec));
    rec.el.addEventListener('mouseleave', hideTip);
  }
  scroll.addEventListener('scroll', hideTip, { passive: true });
  function mkGhost() {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'node node-ghost');
    const mark = document.createElementNS(NS, 'text');
    mark.setAttribute('class', 'ghost-mark');
    mark.textContent = '±';
    g.append(circle(R + 1, 'core'), mark);
    return g;
  }
  function mkEdge(ghost) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('class', 'edge' + (ghost ? ' edge-ghost' : ''));
    return p;
  }
  function mkGuide() {
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('class', 'guide');
    return l;
  }

  function showEmpty(state) {
    if (!state.repo) {
      empty.hidden = false;
      empty.innerHTML = `<div class="ge-card">
        <svg class="ge-art" width="170" height="46" viewBox="0 0 170 46">
          <path d="M14 23 H156"/>
          <circle cx="34" cy="23" r="9"/><circle cx="85" cy="23" r="9"/><circle cx="136" cy="23" r="9"/>
        </svg>
        <div class="ge-title">No repository yet</div>
        <div class="ge-text">A <b>README.md</b> is waiting in the playground folder, but nothing is tracked. Create the repository in the terminal:</div>
        <div class="ge-cmd">git init</div>`;
      return true;
    }
    if (!state.commits.length) {
      const staged = state.status.staged.length > 0;
      empty.hidden = false;
      empty.innerHTML = `<div class="ge-card">
        <svg class="ge-art" width="170" height="46" viewBox="0 0 170 46">
          <path d="M14 23 H156"/>
          <circle cx="34" cy="23" r="9"/>
        </svg>
        <div class="ge-title">Repository created — history is empty</div>
        <div class="ge-text">Branch <b>${escapeHtml(state.head.branch || 'main')}</b> exists but is <i>unborn</i> until the first commit.
          ${staged ? 'Your changes are staged — write them into history:' : 'Stage the file, then commit:'}</div>
        <div class="ge-cmd">${staged ? 'git commit -m "first commit"' : 'git add README.md'}</div>`;
      return true;
    }
    empty.hidden = true;
    empty.innerHTML = '';
    return false;
  }

  function draw() {
    for (const [k, rec] of els) {
      const c = cur.get(k);
      if (!c) continue;
      if (rec.kind === 'guide') {
        rec.el.setAttribute('x1', 26);
        rec.el.setAttribute('x2', Math.max(lastWidth - 20, 26));
        rec.el.setAttribute('y1', c.y);
        rec.el.setAttribute('y2', c.y);
        rec.el.setAttribute('opacity', c.o);
      } else if (rec.kind === 'node') {
        rec.el.setAttribute('transform', `translate(${c.x} ${c.y}) scale(${Math.max(c.s, 0.0001)})`);
        rec.el.setAttribute('opacity', c.o);
      } else {
        const a = cur.get('n:' + rec.meta.parent);
        const b = cur.get('n:' + rec.meta.child);
        if (!a || !b) { rec.el.setAttribute('opacity', 0); continue; }
        rec.el.setAttribute('d', edgePath(a.x, a.y, b.x, b.y, rec.meta.bend));
        rec.el.setAttribute('opacity', c.o * Math.min(a.o, b.o));
      }
    }
  }

  function tick(now) {
    const t = Math.min(1, (now - t0) / DUR);
    const e = 1 - Math.pow(1 - t, 3);
    for (const [k, g] of goal) {
      const f = from.get(k) || g;
      const c = cur.get(k) || {};
      for (const p of ['x', 'y', 's', 'o']) {
        if (g[p] === undefined) continue;
        const fp = f[p] !== undefined ? f[p] : g[p];
        c[p] = fp + (g[p] - fp) * e;
      }
      cur.set(k, c);
    }
    draw();
    if (t < 1) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = null;
      for (const [k, g] of [...goal]) {
        if (!g.remove) continue;
        els.get(k)?.el.remove();
        els.delete(k);
        cur.delete(k);
        from.delete(k);
        goal.delete(k);
      }
    }
  }

  function render(state) {
    hideTip();
    const L = computeLayout(state);
    svg.setAttribute('width', L.width);
    svg.setAttribute('height', L.height);
    content.style.width = L.width + 'px';
    content.style.height = L.height + 'px';

    const isEmpty = showEmpty(state);

    // ——— build wanted set
    const want = new Map();
    if (!isEmpty) {
      L.lanes.forEach((_, i) => {
        want.set('guide:' + i, { kind: 'guide', y: Y0 + i * YSTEP, o: 1, mk: mkGuide });
      });
      for (const n of L.nodes) {
        want.set('n:' + n.hash, {
          kind: 'node', x: n.x, y: n.y, s: 1, o: 1,
          mk: mkNode, update: (rec) => updateNode(rec, n),
          enterFrom: n.parents.length ? 'n:' + n.parents[0] : null,
        });
      }
      for (const e of L.edges) {
        want.set('e:' + e.key, { kind: 'edge', o: 1, meta: e, mk: () => mkEdge(false) });
      }
      if (L.ghost) {
        want.set('n:@ghost', {
          kind: 'node', x: L.ghost.x, y: L.ghost.y, s: 1, o: 1, mk: mkGhost, enterFrom: 'n:' + L.ghost.from,
          update: (rec) => { rec.data = { ghost: true, count: L.ghost.count }; },
        });
        want.set('e:@ghost', {
          kind: 'edge', o: 1, mk: () => mkEdge(true),
          meta: { parent: L.ghost.from, child: '@ghost', bend: 'none' },
        });
      }
    }

    // ——— reconcile SVG elements
    for (const [k, v] of cur) from.set(k, { ...v });
    goal.clear();

    for (const [k, w] of want) {
      if (!els.has(k)) {
        const rec = { kind: w.kind, el: w.mk(), meta: w.meta };
        els.set(k, rec);
        (w.kind === 'edge' ? gEdges : w.kind === 'guide' ? gGuides : gNodes).appendChild(rec.el);
        if (w.kind === 'node') bindHover(rec);
        let init;
        if (w.kind === 'edge') init = { o: 0 };
        else if (w.kind === 'guide') init = { y: w.y, o: 0 };
        else {
          const src = w.enterFrom && cur.get(w.enterFrom);
          init = { x: src ? src.x : w.x, y: src ? src.y : w.y, s: 0, o: 0 };
        }
        cur.set(k, init);
        from.set(k, { ...init });
      }
      const rec = els.get(k);
      if (w.meta) rec.meta = w.meta;
      if (w.update) w.update(rec);
      const g = { ...w };
      delete g.mk; delete g.update; delete g.enterFrom; delete g.kind; delete g.meta;
      goal.set(k, g);
    }

    for (const [k, rec] of els) {
      if (want.has(k)) continue;
      const c = cur.get(k) || {};
      goal.set(k, rec.kind === 'edge' ? { o: 0, remove: true } : { ...c, s: 0, o: 0, remove: true });
    }

    // ——— reconcile chips (HTML overlay, CSS-transitioned)
    const seen = new Set();
    for (const c of L.chips) {
      seen.add(c.key);
      let el = chipEls.get(c.key);
      const entering = !el;
      if (!el) {
        el = document.createElement('div');
        chipEls.set(c.key, el);
        chipLayer.appendChild(el);
      }
      el.className = [
        'chip', 'chip-' + c.kind,
        c.type ? 'type-' + c.type : '',
        entering ? 'entering' : '',
      ].filter(Boolean).join(' ');
      el.innerHTML = escapeHtml(c.text) + (c.head ? '<span class="head-seg">HEAD</span>' : '');
      el.style.left = c.x + 'px';
      el.style.top = c.y + 'px';
      if (entering) {
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('entering')));
      }
    }
    for (const [k, el] of chipEls) {
      if (seen.has(k)) continue;
      chipEls.delete(k);
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 400);
    }

    // ——— go
    const grew = L.width > lastWidth;
    lastWidth = L.width;
    t0 = performance.now();
    if (!rafId) rafId = requestAnimationFrame(tick);
    if (grew) scroll.scrollTo({ left: L.width, behavior: 'smooth' });
  }

  return { render };
}
