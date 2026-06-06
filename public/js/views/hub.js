// ─── Hub View — Creative Studio landing ────────────────────────────────────

import { api } from '../api.js';
import { navigate } from '../router.js';
import { toastInfo, toastError } from '../components/toast.js';
import { t, getCurrentLocale } from '../i18n.js';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(getCurrentLocale(), { day: '2-digit', month: 'short' });
}

const MODALITIES = [
  { key: 'presentations', icon: '◈', accent: 'var(--mod-presentations)', href: '#dashboard', active: true },
  { key: 'images',        icon: '❖', accent: 'var(--mod-images)',        href: '#gallery',   active: true },
  { key: 'music',         icon: '♪', accent: 'var(--mod-music)',         soon: true },
  { key: 'voice',         icon: '◌', accent: 'var(--mod-voice)',         soon: true },
  { key: 'stories',       icon: '✎', accent: 'var(--mod-stories)',       soon: true },
];

function tileHTML(m, i) {
  const title = t(`hub.tiles.${m.key}.title`);
  const desc = t(`hub.tiles.${m.key}.desc`);
  const inner = `
    <div class="hub-tile-glow"></div>
    ${m.soon ? `<span class="hub-tile-ribbon">${t('nav.soon')}</span>` : ''}
    <div class="hub-tile-icon">${m.icon}</div>
    <div class="hub-tile-title">${title}</div>
    <div class="hub-tile-desc">${desc}</div>
    ${m.active ? `<div class="hub-tile-cta">${t('hub.open')} →</div>` : ''}
  `;
  const style = `--mod-accent:${m.accent};animation-delay:${i * 60}ms`;
  if (m.active) {
    return `<a class="hub-tile card-glow" style="${style}" href="${m.href}">${inner}</a>`;
  }
  return `<div class="hub-tile hub-tile-soon" data-soon="1" style="${style}">${inner}</div>`;
}

function recentCardHTML(item) {
  const thumb = item.thumb
    ? `<img src="${item.thumb}" loading="lazy" style="width:100%;height:100%;object-fit:cover">`
    : `<div class="presentation-card-preview-placeholder">${item.icon}</div>`;
  return `
    <a class="presentation-card card-glow" href="${item.route}" style="text-decoration:none;color:inherit">
      <div class="presentation-card-preview">
        ${thumb}
        <div class="creation-type-badge">${item.badge}</div>
      </div>
      <div class="presentation-card-body">
        <div class="presentation-card-title" title="${item.title}">${item.title}</div>
        <div class="presentation-card-meta">${formatDate(item.updated_at)}</div>
      </div>
    </a>`;
}

export async function renderHub(container) {
  const name = (window.__currentUser?.name || '').split(' ')[0] || '';

  const [presentations, images] = await Promise.all([
    api.presentations.list().catch(() => []),
    api.images.list().catch(() => []),
  ]);

  const recent = [
    ...presentations.map(p => ({
      type: 'presentation', id: p.id, title: p.title, updated_at: p.updated_at,
      route: `#studio/${p.id}`, icon: '◈', badge: t('hub.tiles.presentations.title'), thumb: null,
    })),
    ...images.map(c => ({
      type: 'image', id: c.id, title: c.title, updated_at: c.updated_at,
      route: `#image-studio/${c.id}`, icon: '❖', badge: t('hub.tiles.images.title'), thumb: c.cover_url,
    })),
  ].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 8);

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="hub-hero-title">${t('hub.title')}</h1>
        <p class="view-subtitle">${t('hub.subtitle', { name })}</p>
      </div>
    </div>

    <div class="hub-quick">
      <input type="text" id="hub-quick-input" class="form-input" placeholder="${t('hub.quickCreatePlaceholder')}">
      <button class="question-chip" data-quick="image">❖ ${t('nav.images')}</button>
      <button class="question-chip" data-quick="presentation">◈ ${t('nav.dashboard')}</button>
    </div>

    <div class="hub-modality-grid">
      ${MODALITIES.map(tileHTML).join('')}
    </div>

    <div class="hub-recent-title">${t('hub.recentTitle')}</div>
    ${recent.length
      ? `<div class="presentations-grid">${recent.map(recentCardHTML).join('')}</div>`
      : `<div class="empty-state"><div class="empty-state-icon">✦</div><div class="empty-state-desc">${t('hub.recentEmpty')}</div></div>`
    }
  `;

  // Coming-soon tiles
  container.querySelectorAll('[data-soon]').forEach(el => {
    el.addEventListener('click', () => toastInfo(t('hub.comingSoon')));
  });

  // Quick create
  const input = container.querySelector('#hub-quick-input');
  const quickCreate = async (kind) => {
    const prompt = input.value.trim();
    try {
      if (kind === 'image') {
        const c = await api.images.create({ title: prompt ? prompt.slice(0, 60) : undefined });
        if (prompt) sessionStorage.setItem('imageStudioSeedPrompt', prompt);
        navigate('image-studio', { id: c.id });
      } else {
        const p = await api.presentations.create({ title: prompt ? prompt.slice(0, 60) : 'Neue Präsentation' });
        if (prompt) sessionStorage.setItem('studioSeedPrompt', prompt);
        navigate('studio', { id: p.id });
      }
    } catch (err) {
      if (err.status === 402) { toastError(err.message); navigate('settings'); }
      else toastError(err.message);
    }
  };
  container.querySelectorAll('[data-quick]').forEach(btn => {
    btn.addEventListener('click', () => quickCreate(btn.dataset.quick));
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') quickCreate('image'); });
}
