// ─── glowwee — Marketing landing logic ──────────────────────────────────

import { t, setLanguage, getCurrentLocale } from './i18n.js';

const SUPPORTED = ['de', 'en', 'it', 'nl', 'pl'];

function escAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}

// Apply translations to all [data-i18n*] elements + render dynamic sections.
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });

  document.documentElement.lang = getCurrentLocale();
  const title = t('landing.heroTitleHtml').replace(/<[^>]+>/g, '');
  document.title = `glowwee — ${title}`;

  renderFeatures();
  renderPricing();
  renderFaq();
}

function renderFeatures() {
  const grid = document.getElementById('features-grid');
  if (!grid) return;
  const features = t('landing.features') || [];
  grid.innerHTML = features.map((f) => `
    <div class="feature">
      <div class="feature-icon">${f.icon}</div>
      <h3>${escAttr(f.title)}</h3>
      <p>${escAttr(f.desc)}</p>
    </div>`).join('');
}

function renderPricing() {
  const grid = document.getElementById('pricing-grid');
  if (!grid) return;
  const plans = t('landing.plans') || [];
  const popularLabel = t('landing.popular');
  grid.innerHTML = plans.map((p) => {
    const popular = p.id === 'pro';
    const feats = (p.features || []).map((f) =>
      `<li class="${f.on ? '' : 'off'}">${escAttr(f.t)}</li>`).join('');
    return `
      <div class="price-card${popular ? ' popular' : ''}">
        ${popular ? `<span class="price-badge">${escAttr(popularLabel)}</span>` : ''}
        <div class="price-name">${escAttr(p.name)}</div>
        <div class="price-amount">${escAttr(p.price)}${p.per ? ` <small>${escAttr(p.per)}</small>` : ''}</div>
        <div class="price-period">${escAttr(p.period)}</div>
        <ul class="price-features">${feats}</ul>
        <a class="btn ${popular ? 'btn-primary' : 'btn-ghost'}" href="/app?mode=register&plan=${p.id}">${escAttr(p.cta)}</a>
      </div>`;
  }).join('');
}

function renderFaq() {
  const list = document.getElementById('faq-list');
  if (!list) return;
  const faq = t('landing.faq') || [];
  list.innerHTML = faq.map((item) => `
    <div class="faq-item">
      <button class="faq-q">${escAttr(item.q)}</button>
      <div class="faq-a"><p>${escAttr(item.a)}</p></div>
    </div>`).join('');
  list.querySelectorAll('.faq-q').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.faq-item')?.classList.toggle('open'));
  });
}

// ─── Init ──────────────────────────────────────────────────────────────────

// Resolve initial language: stored choice → browser → de.
const stored = localStorage.getItem('landingLang');
const browser = (navigator.language || 'de').slice(0, 2);
const initial = SUPPORTED.includes(stored) ? stored : (SUPPORTED.includes(browser) ? browser : 'de');
setLanguage(initial);

const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

const langSelect = document.getElementById('lang-select');
if (langSelect) {
  langSelect.value = initial;
  langSelect.addEventListener('change', () => {
    const lang = langSelect.value;
    localStorage.setItem('landingLang', lang);
    setLanguage(lang);
    applyTranslations();
  });
}

applyTranslations();

// If already logged in, swap Login/Register for a single "Go to app" action.
(async () => {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) return;
    document.getElementById('nav-login')?.remove();
    const register = document.getElementById('nav-register');
    if (register) {
      register.textContent = t('landing.nav.toApp');
      register.href = '/app';
      register.removeAttribute('data-i18n');
    }
  } catch { /* not logged in */ }
})();
