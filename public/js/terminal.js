import { ansiToHtml, escapeHtml } from './ansi.js';

export function initTerminal({ out, input, prompt, pane }, { onExec }) {
  const history = [];
  let hIdx = 0;
  let stash = ''; // what was typed before browsing history

  const scroll = () => { out.scrollTop = out.scrollHeight; };

  function block(html, cls = '') {
    const div = document.createElement('div');
    div.className = ('t-block ' + cls).trim();
    div.innerHTML = html;
    out.appendChild(div);
    scroll();
    return div;
  }

  block(
    `<div class="t-welcome"><span class="tw-title">Gitflow Playground</span> — a real git terminal, sandboxed in ~/playground.<br>` +
    `Type <b>help</b> for a guided tour, or start with <b>git init</b>.</div>`
  );

  // Runs a command exactly as if the user typed it: echo, execute, print.
  // GUI actions (source control buttons, commit box) reuse this so the
  // CLI equivalent of every click is always visible.
  async function execute(cmd) {
    history.push(cmd);
    hIdx = history.length;
    stash = '';
    block(`<span class="t-caret">❯</span>${escapeHtml(cmd)}`, 't-echo');
    if (cmd === 'clear') { out.innerHTML = ''; return { code: 0, output: '' }; }
    input.disabled = true;
    let res = { code: 1, output: '' };
    try {
      res = await onExec(cmd) || res;
      if (res.output) block(`<pre class="t-out">${ansiToHtml(res.output)}</pre>`);
    } catch (err) {
      block(`<pre class="t-out a-fgr">could not reach the playground server — is it still running?\n${escapeHtml(String(err))}</pre>`);
    }
    input.disabled = false;
    input.focus();
    scroll();
    return res;
  }

  async function submit() {
    const cmd = input.value.trim();
    input.value = '';
    if (!cmd) return;
    await execute(cmd);
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!history.length || hIdx === 0) return;
      if (hIdx === history.length) stash = input.value;
      hIdx--;
      input.value = history[hIdx];
      requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hIdx >= history.length) return;
      hIdx++;
      input.value = hIdx === history.length ? stash : history[hIdx];
    } else if ((e.key === 'l' || e.key === 'L') && e.ctrlKey) {
      e.preventDefault();
      out.innerHTML = '';
    }
  });

  pane.addEventListener('click', () => {
    if (!window.getSelection()?.toString()) input.focus();
  });

  function setPrompt(state) {
    let ref;
    if (!state.repo) ref = `<span class="t-noref">(no repo)</span>`;
    else if (state.head.branch) ref = `<span class="t-branch">(${escapeHtml(state.head.branch)})</span>`;
    else if (state.head.commit) ref = `<span class="t-detached">(detached @ ${state.head.commit.slice(0, 7)})</span>`;
    else ref = `<span class="t-noref">(?)</span>`;
    prompt.innerHTML = `<span class="t-path">~/playground</span> ${ref} <span class="t-dollar">$</span>`;
  }

  function notice(text) {
    block(`<pre class="t-out a-fgy">${escapeHtml(text)}</pre>`);
  }

  return { setPrompt, notice, run: execute };
}
