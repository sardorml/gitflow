// Git School: the lesson catalog modal + the driver.js lesson runner.
// Lessons come from lessons.js; completion is tracked in localStorage.

import { LESSONS, LEVELS } from './lessons.js';
import { celebrate } from './confetti.js';
import { escapeHtml } from './ansi.js';

const DONE_KEY = 'gitflow:school-done';

function getDone() {
  try { return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || '[]')); }
  catch { return new Set(); }
}
function markDone(id) {
  const done = getDone();
  done.add(id);
  localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
}

export function initSchool({ runSetup }) {
  const root = document.querySelector('#catalog');
  let driverObj = null;
  let activeLesson = null;
  let lastIndex = -1;

  /* ——————————————————————————————————————————— catalog modal */

  function openCatalog() {
    if (driverObj) { driverObj.destroy(); driverObj = null; }
    renderCatalog();
    root.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('open')));
  }

  function closeCatalog() {
    root.classList.remove('open');
    setTimeout(() => { root.hidden = true; }, 260);
  }

  function renderCatalog() {
    const done = getDone();
    const total = LESSONS.length;
    root.innerHTML = `
      <div class="cat-backdrop"></div>
      <div class="cat-panel">
        <button class="cat-close" aria-label="Close" title="Close (Esc)">×</button>
        <div class="cat-head">
          <div class="cat-title">Git School</div>
          <div class="cat-sub">Pick a lesson — each one rebuilds the playground into its own scenario,
            then guides you command by command. <b>${done.size}/${total}</b> completed.</div>
        </div>
        ${LEVELS.map(([key, label]) => `
          <div class="cat-level"><span class="cat-level-chip lv-${key}"></span>${label}</div>
          <div class="cat-grid">
            ${LESSONS.filter((l) => l.level === key).map((l) => `
              <button class="cat-card${done.has(l.id) ? ' is-done' : ''}" data-id="${l.id}">
                <span class="cat-card-top">
                  <span class="cat-card-title">${escapeHtml(l.title)}</span>
                  ${done.has(l.id) ? '<span class="cat-done" title="Completed">✓</span>' : ''}
                </span>
                <span class="cat-card-desc">${escapeHtml(l.blurb)}</span>
                <span class="cat-card-meta">≈ ${l.minutes} min · ${l.steps.length} steps</span>
              </button>`).join('')}
          </div>`).join('')}
        <div class="cat-foot">…or close this and free-play — the terminal speaks full git.
          Reopen anytime with <b>🎓 Lessons</b>.</div>
      </div>`;
    root.querySelector('.cat-backdrop').addEventListener('click', closeCatalog);
    root.querySelector('.cat-close').addEventListener('click', closeCatalog);
    for (const card of root.querySelectorAll('.cat-card')) {
      card.addEventListener('click', () => startLesson(card.dataset.id));
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !root.hidden) closeCatalog();
  });

  /* ——————————————————————————————————————————— lesson runner */

  async function startLesson(id) {
    const lesson = LESSONS.find((l) => l.id === id);
    if (!lesson) return;
    closeCatalog();
    try {
      await runSetup(lesson);
    } catch {
      return; // server unreachable; terminal already reports it
    }
    drive(lesson);
  }

  function toDriverStep(step) {
    const popover = {
      title: step.title,
      description: step.desc + (step.hint ? `<div class="tour-wait">↳ ${step.hint}</div>` : ''),
    };
    if (step.side) popover.side = step.side;
    if (step.align) popover.align = step.align;
    return step.el ? { element: step.el, popover } : { popover };
  }

  function drive(lesson) {
    const driver = window.driver?.js?.driver;
    if (!driver) return;
    if (driverObj) driverObj.destroy();
    activeLesson = lesson;
    lastIndex = -1;
    driverObj = driver({
      showProgress: true,
      progressText: '{{current}} of {{total}}',
      overlayColor: '#2e3338',
      overlayOpacity: 0.55,
      stagePadding: 6,
      stageRadius: 14,
      allowKeyboardControl: false, // arrows belong to the terminal & editor
      popoverClass: 'gitflow-tour',
      nextBtnText: 'Next →',
      prevBtnText: '← Back',
      doneBtnText: 'Finish',
      steps: lesson.steps.map(toDriverStep),
      onHighlighted: (el) => {
        lastIndex = driverObj?.getActiveIndex() ?? lastIndex;
        if (el?.id === 'terminal-pane') document.querySelector('#term-input')?.focus();
        if (el?.id === 'editor-pane') document.querySelector('#editor')?.focus();
        if (el && (el.id === 'cell-working' || el.id === 'cell-staged')) {
          document.dispatchEvent(new CustomEvent('gitflow:show-scm'));
        }
      },
      onDestroyed: () => {
        const finished = activeLesson && lastIndex >= activeLesson.steps.length - 1;
        if (finished) {
          celebrate((activeLesson.title || '').replace(/^\d+\s·\s/, ''));
          if (activeLesson.id) { // AI tours have no id: no tracking, no catalog
            markDone(activeLesson.id);
            setTimeout(openCatalog, 2200); // let the confetti land first
          }
        }
        activeLesson = null;
        driverObj = null;
      },
    });
    driverObj.drive();
  }

  function currentStep() {
    if (!driverObj || !driverObj.isActive() || !activeLesson) return null;
    const idx = driverObj.getActiveIndex();
    return activeLesson.steps[idx] || null;
  }

  // fed from every state refresh — advances "do it" steps
  function onState(state) {
    const step = currentStep();
    if (step?.wait && step.wait(state)) driverObj.moveNext();
  }

  // fed after every successful terminal command — advances read-only steps
  function onCommand(command, code) {
    const step = currentStep();
    if (step?.waitCmd && code === 0 && step.waitCmd.test(command.trim())) driverObj.moveNext();
  }

  /* ————————————————————————————— AI-generated tours (from the chat) */

  const AI_EL = { terminal: '#terminal-pane', editor: '#editor-pane', graph: '#graph-pane', scm: '#cell-working' };
  const AI_SIDE = { terminal: 'top', editor: 'bottom', graph: 'bottom', scm: 'right' };

  // AI text may only carry harmless inline markup
  function sanitizeAi(text) {
    return escapeHtml(text)
      .replace(/&lt;(\/?)(b|i|code|br)&gt;/gi, '<$1$2>');
  }

  function fromAiStep(s) {
    if (!s || !s.title) return null;
    let desc = sanitizeAi(s.desc || '');
    if (s.cmd) desc += `<div class="tour-cmd">${escapeHtml(s.cmd)}</div>`;
    let waitCmd = null;
    if (s.advanceOn) {
      try { waitCmd = new RegExp(s.advanceOn, 'i'); } catch { /* bad regex from the model */ }
    }
    if (!waitCmd && s.cmd) {
      const toks = s.cmd.trim().split(/\s+/).slice(0, 2)
        .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      waitCmd = new RegExp('^' + toks.join('\\s+'), 'i');
    }
    return {
      el: AI_EL[s.el] || null,
      side: AI_SIDE[s.el],
      title: sanitizeAi(s.title),
      desc,
      hint: waitCmd ? 'continues when you run it' : undefined,
      waitCmd: waitCmd || undefined,
    };
  }

  function runTour(tour) {
    const steps = (tour?.steps || []).map(fromAiStep).filter(Boolean);
    if (!steps.length) return;
    closeCatalog();
    drive({ id: null, title: tour.title || 'Guided tour', steps });
  }

  return {
    openCatalog,
    onState,
    onCommand,
    runTour,
    autoOpen: () => setTimeout(openCatalog, 700),
  };
}
