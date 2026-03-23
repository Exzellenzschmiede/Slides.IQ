// ─── Nexus App Entry Point ────────────────────────────────────────────────

import { registerView, initRouter } from './router.js';
import { initModal } from './components/modal.js';
import { renderDashboard } from './views/dashboard.js';
import { renderStudio } from './views/studio.js';
import { renderTemplates } from './views/templates.js';
import { renderLibrary } from './views/library.js';
import { renderSettings } from './views/settings.js';
import { api } from './api.js';

// ─── Register views ───────────────────────────────────────────────────────

registerView('dashboard', renderDashboard);
registerView('studio', renderStudio);
registerView('templates', renderTemplates);
registerView('library', renderLibrary);
registerView('settings', renderSettings);

// ─── Initialize app ───────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initModal();
  initParticles();
  checkApiStatus();

  const container = document.getElementById('view-container');
  initRouter(container);

  // Navigation click handlers
  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.hash = '#' + item.dataset.view;
    });
  });
});

// ─── Particle Background ──────────────────────────────────────────────────

function initParticles() {
  const canvas = document.getElementById('particles-bg');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const particles = Array.from({ length: 60 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: Math.random() * 1.5 + 0.3,
    dx: (Math.random() - 0.5) * 0.15,
    dy: (Math.random() - 0.5) * 0.15,
    opacity: Math.random() * 0.5 + 0.1
  }));

  // Nebula blobs
  const blobs = [
    { x: 0.2, y: 0.3, r: 0.35, color: '124,58,237', opacity: 0.04 },
    { x: 0.8, y: 0.7, r: 0.3, color: '6,182,212', opacity: 0.03 },
    { x: 0.5, y: 0.1, r: 0.25, color: '124,58,237', opacity: 0.025 },
    { x: 0.1, y: 0.8, r: 0.2, color: '6,182,212', opacity: 0.02 }
  ];

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw nebula blobs
    blobs.forEach(b => {
      const grd = ctx.createRadialGradient(
        b.x * canvas.width, b.y * canvas.height, 0,
        b.x * canvas.width, b.y * canvas.height, b.r * Math.max(canvas.width, canvas.height)
      );
      grd.addColorStop(0, `rgba(${b.color},${b.opacity})`);
      grd.addColorStop(1, `rgba(${b.color},0)`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    });

    // Draw particles
    particles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${p.opacity})`;
      ctx.fill();

      p.x += p.dx;
      p.y += p.dy;

      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;
    });

    requestAnimationFrame(draw);
  }

  draw();
}

// ─── API Status Check ─────────────────────────────────────────────────────

async function checkApiStatus() {
  try {
    const status = await api.ai.status();
    const dot = document.querySelector('.status-dot');
    const label = document.querySelector('.api-status span');
    if (dot && status.hasApiKey) {
      dot.classList.add('online');
      if (label) label.textContent = 'Claude bereit';
    } else if (dot) {
      dot.classList.add('error');
      if (label) label.textContent = 'Kein API Key';
    }
  } catch {}
}
