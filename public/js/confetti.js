// Dependency-free canvas confetti + congrats toast for finished lessons.

import { escapeHtml } from './ansi.js';

const COLORS = ['#79c0f2', '#4ec9b0', '#b18aec', '#6fcf8f', '#f28b82', '#e0af68', '#0078d4', '#e2c08d'];

export function celebrate(title) {
  confettiBurst();
  toast(title);
}

function confettiBurst() {
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const parts = [];
  const spawn = (x, y, angle, spread, count, speed) => {
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const v = speed * (0.5 + Math.random() * 0.9);
      parts.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        w: 5 + Math.random() * 6,
        h: 8 + Math.random() * 6,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.3,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        life: 1,
        decay: 0.005 + Math.random() * 0.008,
        circle: Math.random() < 0.25,
      });
    }
  };
  spawn(-10, H * 0.8, -Math.PI / 3.4, 0.9, 75, 14);            // left cannon → up-right
  spawn(W + 10, H * 0.8, Math.PI + Math.PI / 3.4, 0.9, 75, 14); // right cannon → up-left
  spawn(W / 2, -10, Math.PI / 2, 1.7, 60, 4);                   // soft rain from the top

  let last = performance.now();
  function tick(now) {
    const dt = Math.min((now - last) / 16.7, 2);
    last = now;
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    for (const p of parts) {
      if (p.life <= 0) continue;
      p.vy += 0.22 * dt;
      p.vx *= 0.986;
      p.vy *= 0.992;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0 || p.y > H + 40) { p.life = 0; continue; }
      alive++;
      ctx.save();
      ctx.globalAlpha = Math.min(p.life * 1.6, 1);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.circle) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // squash height with rotation for a fluttering-paper feel
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.35 + Math.abs(Math.sin(p.rot)) * 0.65));
      }
      ctx.restore();
    }
    if (alive) requestAnimationFrame(tick);
    else canvas.remove();
  }
  requestAnimationFrame(tick);
}

function toast(title) {
  const el = document.createElement('div');
  el.className = 'lesson-toast';
  el.innerHTML =
    `<div class="lt-emoji">🎉</div>` +
    `<div class="lt-title">Congratulations!</div>` +
    `<div class="lt-sub">${title ? `<b>${escapeHtml(title)}</b> — ` : ''}completed</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('gone'), 2700);
  setTimeout(() => el.remove(), 3250);
}
