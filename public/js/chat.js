// Floating git assistant (Groq-backed). Answers questions in chat and can
// hand back a generated guided tour that runs on the learner's live repo.

import { escapeHtml } from './ansi.js';

export function initChat(root, { send, startTour }) {
  root.innerHTML = `
    <button id="chat-bubble" title="Ask the git assistant" aria-label="Open git assistant chat">
      <svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H12l-4.6 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-8z" fill="currentColor"/><circle cx="9" cy="9.6" r="1.15" fill="#1f1f1f"/><circle cx="12.2" cy="9.6" r="1.15" fill="#1f1f1f"/><circle cx="15.4" cy="9.6" r="1.15" fill="#1f1f1f"/></svg>
    </button>
    <div id="chat-panel" hidden>
      <div class="chat-head">
        <span class="chat-title">Git Assistant</span>
        <span class="chat-sub">knows your repo · can start guided tours</span>
        <button class="chat-close" title="Close" aria-label="Close chat">×</button>
      </div>
      <div class="chat-msgs"></div>
      <div class="chat-input-row">
        <textarea id="chat-input" rows="1" spellcheck="false"
          placeholder="Ask anything — “how do I undo my last commit?”"></textarea>
        <button id="chat-send" title="Send" aria-label="Send message">➤</button>
      </div>
    </div>`;

  const bubble = root.querySelector('#chat-bubble');
  const panel = root.querySelector('#chat-panel');
  const msgsEl = root.querySelector('.chat-msgs');
  const input = root.querySelector('#chat-input');
  const sendBtn = root.querySelector('#chat-send');

  const messages = [{
    role: 'assistant',
    content: 'Hey! I can see your playground repo and answer any git question.\n\nAsk me a concept ("what is rebase?") or a workflow ("walk me through a hotfix release") — for workflows I\'ll build a **guided tour** that runs right here on your repo.',
    tour: null,
  }];
  let busy = false;

  const mdLite = (text) => {
    const esc = String(text).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return window.marked ? window.marked.parse(esc, { gfm: true, breaks: true }) : `<pre>${esc}</pre>`;
  };

  function render() {
    msgsEl.innerHTML = '';
    for (const m of messages) {
      const div = document.createElement('div');
      div.className = 'chat-msg ' + m.role;
      div.innerHTML = m.role === 'user' ? escapeHtml(m.content) : mdLite(m.content);
      if (m.tour) {
        const btn = document.createElement('button');
        btn.className = 'chat-tour-btn';
        btn.innerHTML = `<span class="ctb-play">▶</span> Start guided tour — ${escapeHtml(m.tour.title || 'walkthrough')}`;
        btn.addEventListener('click', () => {
          hide();
          startTour(m.tour);
        });
        div.appendChild(btn);
      }
      msgsEl.appendChild(div);
    }
    if (busy) {
      msgsEl.insertAdjacentHTML('beforeend',
        '<div class="chat-msg assistant chat-typing"><span></span><span></span><span></span></div>');
    }
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 110) + 'px';
  }

  async function submit() {
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    autosize();
    messages.push({ role: 'user', content: text });
    busy = true;
    render();
    try {
      const res = await send(messages.map(({ role, content }) => ({ role, content })));
      messages.push({ role: 'assistant', content: res.reply || '…', tour: res.tour || null });
    } catch (err) {
      messages.push({ role: 'assistant', content: `⚠ ${err.message || 'the assistant is unreachable'}`, tour: null });
    }
    busy = false;
    render();
    input.focus();
  }

  function show() {
    panel.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('open')));
    render();
    input.focus();
  }
  function hide() {
    panel.classList.remove('open');
    setTimeout(() => { panel.hidden = true; }, 200);
  }

  bubble.addEventListener('click', () => (panel.hidden ? show() : hide()));
  root.querySelector('.chat-close').addEventListener('click', hide);
  sendBtn.addEventListener('click', submit);
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      hide();
    }
  });

  return { show, hide };
}
