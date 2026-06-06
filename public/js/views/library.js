// ─── Generic Library View — lists creations of one type ────────────────────
// Reused for stories, voice and music (images keep their own gallery.js).

import { api } from '../api.js';
import { navigate } from '../router.js';
import { showConfirmModal } from '../components/modal.js';
import { toastSuccess, toastError } from '../components/toast.js';
import { t, getCurrentLocale } from '../i18n.js';

// type → { studio route, i18n namespace, icon }
const CONFIG = {
  story: { route: 'story-studio', ns: 'storyStudio', icon: '✎', accent: 'var(--mod-stories)' },
  voice: { route: 'voice-studio', ns: 'voiceStudio', icon: '◌', accent: 'var(--mod-voice)' },
  music: { route: 'music-studio', ns: 'musicStudio', icon: '♪', accent: 'var(--mod-music)' },
};

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(getCurrentLocale(), { day: '2-digit', month: 'short', year: 'numeric' });
}

function previewHTML(c, cfg) {
  if (c.type === 'story') {
    const text = (c.parameters?.content || c.prompt || '').slice(0, 160);
    return `<div style="padding:16px;font-size:12px;line-height:1.6;color:var(--text-muted);overflow:hidden">${text ? escHtml(text) + '…' : `<span style="font-size:48px;opacity:.3">${cfg.icon}</span>`}</div>`;
  }
  // audio cover = play glyph
  return `<div class="presentation-card-preview-placeholder" style="color:${cfg.accent}">${c.asset_count > 0 ? '▶' : cfg.icon}</div>`;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function makeLibrary(type) {
  const cfg = CONFIG[type];
  return async function renderLibrary(container) {
    const items = await api.creations.list(type).catch(() => []);
    const count = items.length;
    const ns = cfg.ns;

    container.innerHTML = `
      <div class="view-header">
        <div>
          <h1 class="view-title">${t(ns + '.libTitle')}</h1>
          <p class="view-subtitle">${t(count === 1 ? ns + '.subtitle_one' : ns + '.subtitle_many', { count })}</p>
        </div>
        <button class="btn btn-primary" id="lib-new">${t(ns + '.newBtn')}</button>
      </div>
      <div class="presentations-grid" id="lib-grid">
        <div class="new-presentation-card" id="lib-new-card">
          <div class="new-card-icon">+</div>
          <div style="font-size:14px;font-weight:500">${t(ns + '.newCard')}</div>
          <div class="text-sm text-muted">${t(ns + '.newCardSub')}</div>
        </div>
        ${items.map(c => cardHTML(c, cfg)).join('')}
      </div>
    `;

    const createNew = async () => {
      try {
        const c = await api.creations.create(type);
        navigate(cfg.route, { id: c.id });
      } catch (err) {
        if (err.status === 402 || err.status === 403) { toastError(err.message); navigate('settings'); }
        else toastError(err.message);
      }
    };
    document.getElementById('lib-new')?.addEventListener('click', createNew);
    document.getElementById('lib-new-card')?.addEventListener('click', createNew);
    bindCards(cfg);
  };
}

function cardHTML(c, cfg) {
  return `
    <div class="presentation-card card-glow" data-id="${c.id}">
      <div class="presentation-card-preview" data-open="${c.id}" style="cursor:pointer">
        ${previewHTML(c, cfg)}
        ${c.asset_count > 0 ? `<div class="slide-count-badge">${c.asset_count}</div>` : ''}
        ${c.share_token ? `<div class="slide-count-badge" style="bottom:8px;left:8px;right:auto">${t('imageStudio.share')}</div>` : ''}
      </div>
      <div class="presentation-card-body">
        <div class="presentation-card-title" title="${escHtml(c.title)}">${escHtml(c.title)}</div>
        <div class="presentation-card-meta">${formatDate(c.updated_at)}</div>
        <div class="presentation-card-actions">
          <button class="btn btn-primary btn-sm" data-open="${c.id}">✦ ${t('hub.open')}</button>
          <button class="btn btn-ghost btn-sm" data-del="${c.id}" style="margin-left:auto">✕</button>
        </div>
      </div>
    </div>`;
}

function bindCards(cfg) {
  document.querySelectorAll('[data-open]').forEach(el =>
    el.addEventListener('click', () => navigate(cfg.route, { id: el.dataset.open })));
  document.querySelectorAll('[data-del]').forEach(el =>
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.del;
      showConfirmModal(t(cfg.ns + '.confirmDelete'), t(cfg.ns + '.confirmDeleteMsg'), {
        confirmLabel: t('common.delete', { defaultValue: 'Löschen' }), danger: true,
        onConfirm: async () => {
          try { await api.creations.delete(id); toastSuccess(t(cfg.ns + '.deleted')); makeLibrary(typeFromRoute(cfg.route))(document.getElementById('view-container')); }
          catch (err) { toastError(err.message); }
        },
      });
    }));
}

function typeFromRoute(route) {
  return route === 'story-studio' ? 'story' : route === 'voice-studio' ? 'voice' : 'music';
}
