// ─── Image Studio View — flagship Creative Studio module ────────────────────
// Forks the studio.js mechanics: resizable split, chat-conversation metaphor,
// and the genManager job system (jobs survive navigation). Image generation is
// a single synchronous request wrapped as a one-shot job.

import { api } from '../api.js';
import { navigate } from '../router.js';
import { showModal, closeModal, showConfirmModal } from '../components/modal.js';
import { toastSuccess, toastError, toastInfo } from '../components/toast.js';
import { genManager } from '../generationManager.js';
import { t } from '../i18n.js';

let creation = null;
let isGenerating = false;
let controls = { style: '', aspect: '1:1', count: 1 };

let _watchingJobIds = [];
let _navAwayHandler = null;
let _doneListener = null;
let _errorListener = null;

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _watchJob(jobId) {
  genManager.setCardVisible(jobId, false);
  _watchingJobIds.push(jobId);
  if (_navAwayHandler) return;
  const handler = () => {
    _watchingJobIds.forEach(id => genManager.setCardVisible(id, true));
    _watchingJobIds = [];
    _navAwayHandler = null;
    window.removeEventListener('hashchange', handler);
  };
  _navAwayHandler = handler;
  window.addEventListener('hashchange', handler);
}

const STYLE_KEYS = ['photoreal', 'illustration', '3d', 'cinematic', 'flat'];
const ASPECTS = ['1:1', '16:9', '9:16', '4:3'];
const COUNTS = [1, 2, 4];

export async function renderImageStudio(container, { id }) {
  if (!id) { navigate('gallery'); return; }

  isGenerating = false;
  _watchingJobIds = [];
  if (_navAwayHandler) { window.removeEventListener('hashchange', _navAwayHandler); _navAwayHandler = null; }

  creation = await api.images.get(id);
  controls = {
    style: creation.parameters?.style || '',
    aspect: creation.parameters?.aspect || '1:1',
    count: creation.parameters?.count || 1,
  };

  container.classList.add('studio-mode');
  container.innerHTML = buildHTML();

  initResizer();
  bindEvents();
  bindGenEvents();
  renderChat();
  renderHistory();
  renderGrid();

  // Re-attach to any in-flight job for this creation.
  const active = genManager.getActiveForPresentation(creation.id);
  if (active.length) {
    isGenerating = true;
    setGenerating(true);
    showSkeletons(active[0].meta?.count || controls.count);
    active.forEach(j => _watchJob(j.id));
  }

  // Seed prompt handed over from the Hub quick-create.
  const seed = sessionStorage.getItem('imageStudioSeedPrompt');
  if (seed) {
    sessionStorage.removeItem('imageStudioSeedPrompt');
    const input = document.getElementById('img-input');
    if (input) input.value = seed;
  }
}

function buildHTML() {
  const styleChips = STYLE_KEYS.map(k =>
    `<button class="question-chip ${controls.style === k ? 'selected' : ''}" data-ctrl="style" data-val="${k}">${t('imageStudio.styles.' + k)}</button>`
  ).join('');
  const aspectChips = ASPECTS.map(a =>
    `<button class="question-chip ${controls.aspect === a ? 'selected' : ''}" data-ctrl="aspect" data-val="${a}">${a}</button>`
  ).join('');
  const countChips = COUNTS.map(c =>
    `<button class="question-chip ${controls.count === c ? 'selected' : ''}" data-ctrl="count" data-val="${c}">${c}</button>`
  ).join('');

  return `
  <div class="studio-wrapper">
    <div class="studio-header" style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <button class="studio-back-btn" onclick="window.history.back()" title="${t('imageStudio.back')}">←</button>
      <div style="flex:1;min-width:0">
        <div class="presentation-card-title" id="img-title" style="font-size:18px">${escHtml(creation.title)}</div>
        <div class="text-xs text-muted">${t('images.coverBadge', { count: creation.asset_count })}</div>
      </div>
      <div class="studio-dropdown">
        <button class="btn btn-ghost btn-sm studio-dropdown-trigger">⋯</button>
        <div class="studio-dropdown-menu">
          <button class="studio-dropdown-item" id="btn-share">${t('imageStudio.share')}</button>
          <button class="studio-dropdown-item" id="btn-delete">${t('imageStudio.delete')}</button>
        </div>
      </div>
    </div>

    <div class="studio-layout">
      <div class="studio-sidebar">
        <div class="card studio-chat-history">
          <span class="form-label" style="margin-bottom:0">${t('hub.tiles.images.title')}</span>
          <div class="chat-messages" id="img-chat"></div>
          <div id="img-generating" style="display:none">
            <div class="generating-indicator">
              <div class="gen-dots"><span></span><span></span><span></span></div>
              <span>${t('imageStudio.generating')}</span>
            </div>
          </div>
        </div>

        <div class="card studio-chat-input">
          <div class="image-controls">
            <div class="image-control-group">
              <span class="image-control-label">${t('imageStudio.style')}</span>
              <div class="image-control-chips">${styleChips}</div>
            </div>
            <div class="image-control-group">
              <span class="image-control-label">${t('imageStudio.aspect')}</span>
              <div class="image-control-chips">${aspectChips}</div>
            </div>
            <div class="image-control-group">
              <span class="image-control-label">${t('imageStudio.count')}</span>
              <div class="image-control-chips">${countChips}</div>
            </div>
          </div>
          <div class="chat-input-wrapper">
            <textarea class="chat-input" id="img-input" placeholder="${t('imageStudio.inputPlaceholder')}" rows="3"></textarea>
            <button class="send-btn" id="img-send" title="${t('imageStudio.send')}">→</button>
          </div>
        </div>
      </div>

      <div class="studio-divider" id="studio-divider" title="↔"></div>

      <div class="studio-preview">
        <div class="prompt-history" id="img-history"></div>
        <div id="img-grid" class="image-result-grid"></div>
      </div>
    </div>
  </div>`;
}

function renderChat() {
  const el = document.getElementById('img-chat');
  if (!el) return;
  const conv = creation.conversation || [];
  if (!conv.length) {
    const chips = (t('imageStudio.welcomeChips') || []).map(c =>
      `<button class="question-chip" data-seed="${escHtml(c)}">${escHtml(c)}</button>`
    ).join('');
    el.innerHTML = `<div class="chat-message assistant welcome-msg">
      <div style="margin-bottom:8px">${t('imageStudio.welcome')}</div>
      <div class="question-chips">${chips}</div>
    </div>`;
    el.querySelectorAll('[data-seed]').forEach(b =>
      b.addEventListener('click', () => { const i = document.getElementById('img-input'); i.value = b.dataset.seed; i.focus(); })
    );
    return;
  }
  el.innerHTML = conv.map(m => {
    if (m.role === 'user') return `<div class="chat-message user">${escHtml(m.content)}</div>`;
    return `<div class="chat-message assistant">${escHtml(m.content)}</div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

function renderHistory() {
  const el = document.getElementById('img-history');
  if (!el) return;
  const prompts = (creation.conversation || []).filter(m => m.role === 'user').map(m => m.content);
  const unique = [...new Set(prompts)].slice(-8).reverse();
  if (!unique.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<span class="image-control-label" style="align-self:center">${t('imageStudio.promptHistory')}:</span>` +
    unique.map(p => `<button class="question-chip" data-seed="${escHtml(p)}" title="${escHtml(p)}">${escHtml(p.length > 28 ? p.slice(0, 28) + '…' : p)}</button>`).join('');
  el.querySelectorAll('[data-seed]').forEach(b =>
    b.addEventListener('click', () => { const i = document.getElementById('img-input'); i.value = b.dataset.seed; i.focus(); })
  );
}

function renderGrid() {
  const grid = document.getElementById('img-grid');
  if (!grid) return;
  const assets = creation.assets || [];
  if (!assets.length) {
    grid.classList.remove('image-result-grid');
    grid.innerHTML = `<div class="image-empty-canvas"><div class="empty-state-icon">❖</div><div class="empty-state-desc">${t('imageStudio.emptyCanvas')}</div></div>`;
    return;
  }
  grid.classList.add('image-result-grid');
  grid.innerHTML = assets.map(a => tileHTML(a)).join('');
  bindTileActions();
}

function tileHTML(a) {
  const isCover = a.id === creation.cover_asset_id;
  return `
    <div class="image-result-tile" data-asset="${a.id}">
      <img src="${a.url}" loading="lazy" alt="">
      <span class="image-fav ${a.is_favorite ? 'active' : ''}" data-fav>★</span>
      <div class="image-result-actions">
        <button class="image-action-btn" data-act="fav" title="${t('imageStudio.favorite')}">★</button>
        <button class="image-action-btn" data-act="cover" title="${t('imageStudio.setCover')}">${isCover ? '◉' : '○'}</button>
        <button class="image-action-btn" data-act="dl" title="${t('imageStudio.download')}">↓</button>
        <button class="image-action-btn" data-act="del" title="${t('imageStudio.deleteAsset')}">✕</button>
      </div>
    </div>`;
}

function bindTileActions() {
  document.querySelectorAll('#img-grid .image-result-tile').forEach(tile => {
    const assetId = tile.dataset.asset;
    const asset = (creation.assets || []).find(a => a.id === assetId);
    tile.querySelector('img').addEventListener('click', () => openLightbox(asset));
    tile.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleAssetAction(btn.dataset.act, asset);
      });
    });
  });
}

function openLightbox(asset) {
  showModal('', `<img src="${asset.url}" style="width:100%;border-radius:var(--radius-lg);display:block">`);
}

async function handleAssetAction(act, asset) {
  try {
    if (act === 'fav') {
      const on = !asset.is_favorite;
      await api.images.favorite(creation.id, asset.id, on);
      asset.is_favorite = on;
      renderGrid();
    } else if (act === 'cover') {
      await api.images.setCover(creation.id, asset.id);
      creation.cover_asset_id = asset.id;
      renderGrid();
    } else if (act === 'dl') {
      const a = document.createElement('a');
      a.href = asset.url + '?download=1';
      a.download = `${creation.title}.png`;
      a.click();
    } else if (act === 'del') {
      await api.images.deleteAsset(creation.id, asset.id);
      creation.assets = (creation.assets || []).filter(x => x.id !== asset.id);
      renderGrid();
    }
  } catch (err) {
    toastError(err.message);
  }
}

function showSkeletons(n) {
  const grid = document.getElementById('img-grid');
  if (!grid) return;
  grid.classList.add('image-result-grid');
  const existing = (creation.assets || []).map(a => tileHTML(a)).join('');
  const skeletons = Array.from({ length: n }, () => '<div class="image-skeleton"></div>').join('');
  grid.innerHTML = skeletons + existing;
}

function setGenerating(active) {
  const ind = document.getElementById('img-generating');
  const input = document.getElementById('img-input');
  const send = document.getElementById('img-send');
  if (ind) ind.style.display = active ? 'block' : 'none';
  if (input) input.disabled = active;
  if (send) send.disabled = active;
}

function generate(prompt) {
  if (isGenerating) return;
  prompt = (prompt || '').trim();
  if (!prompt) return;

  isGenerating = true;
  setGenerating(true);
  showSkeletons(controls.count);

  // Optimistic chat echo (the canonical history is reloaded on done).
  const chat = document.getElementById('img-chat');
  if (chat) {
    if (chat.querySelector('.welcome-msg')) chat.innerHTML = '';
    chat.insertAdjacentHTML('beforeend', `<div class="chat-message user">${escHtml(prompt)}</div>`);
    chat.scrollTop = chat.scrollHeight;
  }

  const jobId = genManager.start({
    presentationId: creation.id,
    module: 'image',
    title: creation.title,
    label: t('imageStudio.generating'),
    type: 'image-generate',
    meta: { ...controls },
    apiCall: (signal) => api.images.generate(creation.id, prompt, {
      style: controls.style || undefined, aspect: controls.aspect, count: controls.count,
    }, signal),
  });
  _watchJob(jobId);

  const input = document.getElementById('img-input');
  if (input) input.value = '';
}

function bindGenEvents() {
  if (_doneListener) window.removeEventListener('genmanager:done', _doneListener);
  if (_errorListener) window.removeEventListener('genmanager:error', _errorListener);

  _doneListener = async (e) => {
    if (e.detail.presentationId !== creation?.id) return;
    isGenerating = false;
    setGenerating(false);
    try {
      creation = await api.images.get(creation.id); // reload canonical state
      renderChat(); renderHistory(); renderGrid();
      // refresh header count
      const meta = document.querySelector('.studio-header .text-xs.text-muted');
      if (meta) meta.textContent = t('images.coverBadge', { count: creation.asset_count });
    } catch (_) {}
  };
  _errorListener = (e) => {
    if (e.detail.presentationId !== creation?.id) return;
    isGenerating = false;
    setGenerating(false);
    renderGrid(); // drop skeletons
    const info = e.detail.limitInfo;
    if (info && (info.code === 'image_quota_exceeded' || info.code === 'feature_locked')) {
      toastError(e.detail.error || t('imageStudio.noKey'));
      navigate('settings');
    } else {
      toastError(t('imageStudio.errorGenerate', { msg: e.detail.error || '?' }));
    }
  };
  window.addEventListener('genmanager:done', _doneListener);
  window.addEventListener('genmanager:error', _errorListener);
}

function bindEvents() {
  const input = document.getElementById('img-input');
  const send = document.getElementById('img-send');
  send?.addEventListener('click', () => generate(input.value));
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(input.value); }
  });

  // Control chips
  document.querySelectorAll('[data-ctrl]').forEach(chip => {
    chip.addEventListener('click', () => {
      const ctrl = chip.dataset.ctrl;
      let val = chip.dataset.val;
      if (ctrl === 'count') val = parseInt(val, 10);
      // Toggle style off if re-clicked; aspect/count always select.
      if (ctrl === 'style' && controls.style === val) controls.style = '';
      else controls[ctrl] = val;
      document.querySelectorAll(`[data-ctrl="${ctrl}"]`).forEach(c => {
        const cv = ctrl === 'count' ? parseInt(c.dataset.val, 10) : c.dataset.val;
        c.classList.toggle('selected', cv === controls[ctrl]);
      });
    });
  });

  // Dropdown toggle
  document.querySelectorAll('.studio-dropdown-trigger').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const d = trigger.closest('.studio-dropdown');
      document.querySelectorAll('.studio-dropdown.open').forEach(x => { if (x !== d) x.classList.remove('open'); });
      d.classList.toggle('open');
    });
  });
  document.addEventListener('click', () => document.querySelectorAll('.studio-dropdown.open').forEach(d => d.classList.remove('open')));

  document.getElementById('btn-share')?.addEventListener('click', async () => {
    try {
      const { shareUrl } = await api.images.share(creation.id);
      await navigator.clipboard.writeText(shareUrl).catch(() => {});
      toastSuccess(t('imageStudio.shareCopied'));
    } catch (err) { toastError(err.message); }
  });

  document.getElementById('btn-delete')?.addEventListener('click', () => {
    showConfirmModal(t('images.confirmDelete'), t('images.confirmDeleteMsg'), {
      confirmLabel: t('common.delete', { defaultValue: 'Löschen' }),
      danger: true,
      onConfirm: async () => {
        try { await api.images.delete(creation.id); toastSuccess(t('images.deleted')); navigate('gallery'); }
        catch (err) { toastError(err.message); }
      },
    });
  });
}

function initResizer() {
  const layout = document.querySelector('.studio-layout');
  const divider = document.getElementById('studio-divider');
  if (!layout || !divider) return;
  const MIN = 0.25, MAX = 0.7;
  const apply = (r) => {
    const ratio = Math.min(MAX, Math.max(MIN, r));
    layout.style.setProperty('--studio-chat-fr', `${ratio}fr`);
    layout.style.setProperty('--studio-preview-fr', `${1 - ratio}fr`);
    return ratio;
  };
  const stored = parseFloat(localStorage.getItem('imageStudioSplitRatio'));
  let current = apply(Number.isFinite(stored) ? stored : 0.4);
  const onMove = (e) => {
    const rect = layout.getBoundingClientRect();
    if (rect.width <= 0) return;
    current = apply((e.clientX - rect.left) / rect.width);
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.classList.remove('studio-resizing');
    divider.classList.remove('dragging');
    localStorage.setItem('imageStudioSplitRatio', String(current));
  };
  divider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.body.classList.add('studio-resizing');
    divider.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
