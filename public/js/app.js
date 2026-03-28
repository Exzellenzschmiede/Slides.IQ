// ─── Nexus App Entry Point ────────────────────────────────────────────────

import { registerView, initRouter } from './router.js';
import { initModal } from './components/modal.js';
import { renderDashboard } from './views/dashboard.js';
import { renderStudio } from './views/studio.js';
import { renderTemplates } from './views/templates.js';
import { renderSettings } from './views/settings.js';
import { renderAdmin } from './views/admin.js';
import { api } from './api.js';
import { initPasswordToggles } from './utils/passwordToggle.js';
import { setLanguage, getCurrentLocale } from './i18n.js';

// ─── Register views ───────────────────────────────────────────────────────

registerView('dashboard', renderDashboard);
registerView('studio', renderStudio);
registerView('templates', renderTemplates);
registerView('settings', renderSettings);
registerView('admin', renderAdmin);

// ─── Initialize app ───────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  initModal();
  initParticles();
  initSidebarToggle();
  initPasswordToggles(document);

  await initAuth();

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

// ─── Auth Bootstrap ───────────────────────────────────────────────────────

async function initAuth() {
  const overlay = document.getElementById('auth-overlay');
  const loginForm = document.getElementById('auth-login-form');
  const setupForm = document.getElementById('auth-setup-form');

  // Check if first-run setup is needed
  let setupNeeded = false;
  try {
    const res = await api.auth.setupNeeded();
    setupNeeded = res.setupNeeded;
  } catch {}

  if (setupNeeded) {
    loginForm.style.display = 'none';
    setupForm.style.display = '';
    overlay.classList.remove('hidden');
    await waitForSetup();
    overlay.classList.add('hidden');
    return;
  }

  // Check if already logged in
  try {
    const user = await api.auth.me();
    await setCurrentUser(user);
    overlay.classList.add('hidden');
    checkApiStatus();
    return;
  } catch {}

  // Show login
  overlay.classList.remove('hidden');
  await waitForLogin();
  overlay.classList.add('hidden');
  checkApiStatus();
}

function waitForLogin() {
  return new Promise((resolve) => {
    const btn = document.getElementById('auth-login-btn');
    const emailEl = document.getElementById('auth-email');
    const passEl = document.getElementById('auth-password');
    const errEl = document.getElementById('auth-error');

    async function tryLogin() {
      errEl.style.display = 'none';
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      try {
        const user = await api.auth.login({ email: emailEl.value.trim(), password: passEl.value });
        await setCurrentUser(user);
        btn.disabled = false;
        btn.textContent = 'Sign in';
        resolve();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = '';
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    }

    btn.addEventListener('click', tryLogin);
    [emailEl, passEl].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); }));
  });
}

function waitForSetup() {
  return new Promise((resolve) => {
    const btn = document.getElementById('auth-setup-btn');
    const nameEl = document.getElementById('setup-name');
    const emailEl = document.getElementById('setup-email');
    const passEl = document.getElementById('setup-password');
    const errEl = document.getElementById('setup-error');

    async function trySetup() {
      errEl.style.display = 'none';
      btn.disabled = true;
      btn.textContent = 'Creating…';
      try {
        const user = await api.auth.setup({
          name: nameEl.value.trim(),
          email: emailEl.value.trim(),
          password: passEl.value
        });
        await setCurrentUser(user);
        btn.disabled = false;
        btn.textContent = 'Create admin account';
        resolve();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = '';
        btn.disabled = false;
        btn.textContent = 'Create admin account';
      }
    }

    btn.addEventListener('click', trySetup);
  });
}

async function setCurrentUser(user) {
  const nameEl = document.getElementById('sidebar-user-name');
  if (nameEl) nameEl.textContent = user.name || user.email;

  // Store role for views
  window.__currentUser = user;

  // Load and apply user's language preference before any view renders
  try {
    const settings = await api.settings.get();
    const lang = settings?.preferences?.language || 'en';
    setLanguage(lang);
  } catch {
    setLanguage('en');
  }

  // Show admin nav item for admins
  if (user.role === 'admin') {
    document.getElementById('nav-admin')?.classList.remove('hidden');
  }

  // Logout button
  const logoutBtn = document.getElementById('sidebar-logout-btn');
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      await api.auth.logout().catch(() => {});
      window.location.reload();
    };
  }
}

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

// ─── Sidebar Toggle ───────────────────────────────────────────────────────

function initSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('sidebar-toggle');
  if (!sidebar || !btn) return;

  if (localStorage.getItem('sidebarCollapsed') === '1') {
    sidebar.classList.add('collapsed');
  }

  btn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed') ? '1' : '0');
  });
}

// ─── API Status Check ─────────────────────────────────────────────────────

async function checkApiStatus() {
  try {
    const status = await api.ai.status();
    const dot = document.querySelector('.status-dot');
    const label = document.querySelector('.api-status span');
    if (dot && status.hasApiKey) {
      dot.classList.add('online');
      if (label) label.textContent = 'Claude ready';
    } else if (dot) {
      dot.classList.add('error');
      if (label) label.textContent = 'No API Key';
    }
  } catch {}
}
