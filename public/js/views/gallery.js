// ─── Gallery View — image creations library ─────────────────────────────────

import { api } from '../api.js';
import { navigate } from '../router.js';
import { showConfirmModal } from '../components/modal.js';
import { toastSuccess, toastError } from '../components/toast.js';
import { t, getCurrentLocale } from '../i18n.js';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(getCurrentLocale(), { day: '2-digit', month: 'short', year: 'numeric' });
}

function renderCard(c) {
  const preview = c.cover_url
    ? `<img src="${c.cover_url}" loading="lazy" style="width:100%;height:100%;object-fit:cover">`
    : `<div class="presentation-card-preview-placeholder">❖</div>`;
  return `
    <div class="presentation-card card-glow" data-id="${c.id}">
      <div class="presentation-card-preview" onclick="window.glowweeOpenImage('${c.id}')">
        ${preview}
        ${c.asset_count > 0 ? `<div class="slide-count-badge">${t('images.coverBadge', { count: c.asset_count })}</div>` : ''}
        ${c.share_token ? `<div class="slide-count-badge" style="bottom:8px;left:8px;right:auto">${t('imageStudio.share')}</div>` : ''}
      </div>
      <div class="presentation-card-body">
        <div class="presentation-card-title" title="${c.title}">${c.title}</div>
        <div class="presentation-card-meta">${formatDate(c.updated_at)}</div>
        <div class="presentation-card-actions">
          <button class="btn btn-primary btn-sm" onclick="window.glowweeOpenImage('${c.id}')">✦ ${t('hub.open')}</button>
          <button class="btn btn-ghost btn-sm" onclick="window.glowweeDeleteImage('${c.id}')" style="margin-left:auto">✕</button>
        </div>
      </div>
    </div>`;
}

export async function renderGallery(container) {
  const creations = await api.images.list().catch(() => []);
  const count = creations.length;
  const subtitleKey = count === 1 ? 'images.subtitle_one' : 'images.subtitle_many';

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">${t('images.title')}</h1>
        <p class="view-subtitle">${t(subtitleKey, { count })}</p>
      </div>
      <div class="flex gap-8">
        <input type="search" id="search-input" class="form-input" placeholder="${t('images.searchPlaceholder')}" style="width:220px">
        <button class="btn btn-primary" id="new-img-btn">${t('images.newBtn')}</button>
      </div>
    </div>

    <div class="presentations-grid" id="gallery-grid">
      <div class="new-presentation-card" id="new-img-card">
        <div class="new-card-icon">+</div>
        <div style="font-size:14px;font-weight:500">${t('images.newCard')}</div>
        <div class="text-sm text-muted">${t('images.newCardSub')}</div>
      </div>
      ${creations.map(renderCard).join('')}
    </div>
  `;

  const createNew = async () => {
    try {
      const c = await api.images.create();
      navigate('image-studio', { id: c.id });
    } catch (err) {
      if (err.status === 402) { toastError(err.message); navigate('settings'); }
      else toastError(t('images.errorCreate', { msg: err.message }));
    }
  };
  document.getElementById('new-img-btn')?.addEventListener('click', createNew);
  document.getElementById('new-img-card')?.addEventListener('click', createNew);

  document.getElementById('search-input')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = creations.filter(c => c.title.toLowerCase().includes(q));
    const grid = document.getElementById('gallery-grid');
    const newCard = document.getElementById('new-img-card')?.outerHTML || '';
    grid.innerHTML = newCard + filtered.map(renderCard).join('');
    document.getElementById('new-img-card')?.addEventListener('click', createNew);
  });
}

window.glowweeOpenImage = (id) => navigate('image-studio', { id });

window.glowweeDeleteImage = (id) => {
  showConfirmModal(t('images.confirmDelete'), t('images.confirmDeleteMsg'), {
    confirmLabel: t('common.delete', { defaultValue: 'Löschen' }),
    danger: true,
    onConfirm: async () => {
      try {
        await api.images.delete(id);
        toastSuccess(t('images.deleted'));
        renderGallery(document.getElementById('view-container'));
      } catch (err) {
        toastError(t('common.error') + ': ' + err.message);
      }
    },
  });
};
