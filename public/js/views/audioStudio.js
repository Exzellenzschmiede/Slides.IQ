// ─── Audio Studio — shared by Voice (TTS) and Music & Sound ─────────────────

import { api } from '../api.js';
import { navigate } from '../router.js';
import { showConfirmModal } from '../components/modal.js';
import { toastSuccess, toastError } from '../components/toast.js';
import { genManager } from '../generationManager.js';
import { t } from '../i18n.js';

let creation = null;
let isGenerating = false;
let kind = 'voice';           // 'voice' | 'music'
let controls = { mode: 'music', durationSeconds: 10 };
let _watchingJobIds = [];
let _navAwayHandler = null;
let _doneListener = null;
let _errorListener = null;

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const NS = () => (kind === 'voice' ? 'voiceStudio' : 'musicStudio');
const STUDIO_ROUTE = () => (kind === 'voice' ? 'voice-studio' : 'music-studio');
const LIB_ROUTE = () => (kind === 'voice' ? 'voices' : 'sounds');

function _watchJob(jobId) {
  genManager.setCardVisible(jobId, false);
  _watchingJobIds.push(jobId);
  if (_navAwayHandler) return;
  const handler = () => { _watchingJobIds.forEach(id => genManager.setCardVisible(id, true)); _watchingJobIds = []; _navAwayHandler = null; window.removeEventListener('hashchange', handler); };
  _navAwayHandler = handler;
  window.addEventListener('hashchange', handler);
}

const MODES = ['music', 'sound'];
const DURATIONS = [5, 10, 20];

export function makeAudioStudio(forKind) {
  return async function renderAudioStudio(container, { id }) {
    kind = forKind;
    if (!id) { navigate(LIB_ROUTE()); return; }
    isGenerating = false;
    _watchingJobIds = [];
    if (_navAwayHandler) { window.removeEventListener('hashchange', _navAwayHandler); _navAwayHandler = null; }

    creation = await api.creations.get(id);
    controls = {
      mode: creation.parameters?.mode || 'music',
      durationSeconds: creation.parameters?.durationSeconds || 10,
    };

    container.classList.add('studio-mode');
    container.innerHTML = buildHTML();
    initResizer();
    bindEvents();
    bindGenEvents();
    renderChat();
    renderAssets();

    const active = genManager.getActiveForPresentation(creation.id);
    if (active.length) { isGenerating = true; setGenerating(true); active.forEach(j => _watchJob(j.id)); }

    const seed = sessionStorage.getItem(kind + 'StudioSeedPrompt');
    if (seed) { sessionStorage.removeItem(kind + 'StudioSeedPrompt'); const i = document.getElementById('audio-input'); if (i) i.value = seed; }
  };
}

function buildHTML() {
  const ns = NS();
  // Music studio gets mode + duration controls; voice studio is plain text→speech.
  const musicControls = kind === 'music' ? `
    <div class="image-controls">
      <div class="image-control-group"><span class="image-control-label">${t('musicStudio.mode')}</span>
        <div class="image-control-chips">${MODES.map(m => `<button class="question-chip ${controls.mode === m ? 'selected' : ''}" data-ctrl="mode" data-val="${m}">${t('musicStudio.modes.' + m)}</button>`).join('')}</div></div>
      <div class="image-control-group"><span class="image-control-label">${t('musicStudio.duration')}</span>
        <div class="image-control-chips">${DURATIONS.map(d => `<button class="question-chip ${controls.durationSeconds === d ? 'selected' : ''}" data-ctrl="durationSeconds" data-val="${d}">${d}s</button>`).join('')}</div></div>
    </div>` : '';

  return `
  <div class="studio-wrapper">
    <div class="studio-header" style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <button class="studio-back-btn" onclick="window.history.back()" title="${t('imageStudio.back')}">←</button>
      <div style="flex:1;min-width:0">
        <div class="presentation-card-title" style="font-size:18px">${escHtml(creation.title)}</div>
        <div class="text-xs text-muted">${t(ns + '.libTitle')}</div>
      </div>
      <div class="studio-dropdown">
        <button class="btn btn-ghost btn-sm studio-dropdown-trigger">⋯</button>
        <div class="studio-dropdown-menu">
          <button class="studio-dropdown-item" id="btn-delete">${t('imageStudio.delete')}</button>
        </div>
      </div>
    </div>
    <div class="studio-layout">
      <div class="studio-sidebar">
        <div class="card studio-chat-history">
          <span class="form-label" style="margin-bottom:0">${t(ns + '.libTitle')}</span>
          <div class="chat-messages" id="audio-chat"></div>
          <div id="audio-generating" style="display:none">
            <div class="generating-indicator"><div class="gen-dots"><span></span><span></span><span></span></div><span>${t(ns + '.generating')}</span></div>
          </div>
        </div>
        <div class="card studio-chat-input">
          ${musicControls}
          <div class="chat-input-wrapper">
            <textarea class="chat-input" id="audio-input" placeholder="${t(ns + '.inputPlaceholder')}" rows="3"></textarea>
            <button class="send-btn" id="audio-send" title="${t('imageStudio.send')}">→</button>
          </div>
        </div>
      </div>
      <div class="studio-divider" id="studio-divider" title="↔"></div>
      <div class="studio-preview">
        <div class="audio-list" id="audio-list"></div>
      </div>
    </div>
  </div>`;
}

function renderChat() {
  const el = document.getElementById('audio-chat');
  if (!el) return;
  const ns = NS();
  const conv = creation.conversation || [];
  if (!conv.length) {
    const chips = (t(ns + '.welcomeChips') || []).map(c => `<button class="question-chip" data-seed="${escHtml(c)}">${escHtml(c)}</button>`).join('');
    el.innerHTML = `<div class="chat-message assistant welcome-msg"><div style="margin-bottom:8px">${t(ns + '.welcome')}</div><div class="question-chips">${chips}</div></div>`;
    el.querySelectorAll('[data-seed]').forEach(b => b.addEventListener('click', () => { const i = document.getElementById('audio-input'); i.value = b.dataset.seed; i.focus(); }));
    return;
  }
  el.innerHTML = conv.map(m => m.role === 'user' ? `<div class="chat-message user">${escHtml(m.content)}</div>` : `<div class="chat-message assistant">✓ ${t(NS() + '.doneLabel')}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}

function renderAssets() {
  const list = document.getElementById('audio-list');
  if (!list) return;
  const assets = (creation.assets || []).slice().reverse();
  if (!assets.length) {
    list.innerHTML = `<div class="image-empty-canvas"><div class="empty-state-icon">${kind === 'voice' ? '◌' : '♪'}</div><div class="empty-state-desc">${t(NS() + '.emptyCanvas')}</div></div>`;
    return;
  }
  list.innerHTML = assets.map(a => `
    <div class="audio-card" data-asset="${a.id}">
      <div class="audio-card-prompt">${escHtml(a.prompt || '')}</div>
      <audio controls preload="none" src="${a.url}"></audio>
      <div class="audio-card-actions">
        <a class="btn btn-ghost btn-sm" href="${a.url}?download=1" download="${escHtml(creation.title)}.mp3">↓ ${t('imageStudio.download')}</a>
        <button class="btn btn-ghost btn-sm" data-del="${a.id}" style="margin-left:auto">✕</button>
      </div>
    </div>`).join('');
  list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    try { await api.creations.deleteAsset(creation.id, b.dataset.del); creation.assets = creation.assets.filter(x => x.id !== b.dataset.del); renderAssets(); }
    catch (err) { toastError(err.message); }
  }));
}

function setGenerating(active) {
  const ind = document.getElementById('audio-generating');
  const input = document.getElementById('audio-input');
  const send = document.getElementById('audio-send');
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
  const chat = document.getElementById('audio-chat');
  if (chat) { if (chat.querySelector('.welcome-msg')) chat.innerHTML = ''; chat.insertAdjacentHTML('beforeend', `<div class="chat-message user">${escHtml(prompt)}</div>`); chat.scrollTop = chat.scrollHeight; }

  const body = { prompt };
  if (kind === 'music') { body.mode = controls.mode; body.durationSeconds = controls.durationSeconds; }

  const jobId = genManager.start({
    presentationId: creation.id, module: 'audio', title: creation.title,
    label: t(NS() + '.generating'), type: 'audio-generate',
    openHref: `#${STUDIO_ROUTE()}/${creation.id}`, doneLabel: t(NS() + '.doneLabel'),
    apiCall: (signal) => api.creations.generate(creation.id, body, signal),
  });
  _watchJob(jobId);
  const input = document.getElementById('audio-input'); if (input) input.value = '';
}

function bindGenEvents() {
  if (_doneListener) window.removeEventListener('genmanager:done', _doneListener);
  if (_errorListener) window.removeEventListener('genmanager:error', _errorListener);
  _doneListener = async (e) => {
    if (e.detail.presentationId !== creation?.id) return;
    isGenerating = false; setGenerating(false);
    try { creation = await api.creations.get(creation.id); renderChat(); renderAssets(); } catch (_) {}
  };
  _errorListener = (e) => {
    if (e.detail.presentationId !== creation?.id) return;
    isGenerating = false; setGenerating(false);
    const info = e.detail.limitInfo;
    if (info && (info.code === 'feature_locked' || String(info.code || '').includes('quota'))) { toastError(e.detail.error || '?'); navigate('settings'); }
    else toastError(t(NS() + '.errorGenerate', { msg: e.detail.error || '?' }));
  };
  window.addEventListener('genmanager:done', _doneListener);
  window.addEventListener('genmanager:error', _errorListener);
}

function bindEvents() {
  const input = document.getElementById('audio-input');
  document.getElementById('audio-send')?.addEventListener('click', () => generate(input.value));
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(input.value); } });

  document.querySelectorAll('[data-ctrl]').forEach(chip => chip.addEventListener('click', () => {
    const ctrl = chip.dataset.ctrl;
    controls[ctrl] = ctrl === 'durationSeconds' ? parseInt(chip.dataset.val, 10) : chip.dataset.val;
    document.querySelectorAll(`[data-ctrl="${ctrl}"]`).forEach(c => {
      const cv = ctrl === 'durationSeconds' ? parseInt(c.dataset.val, 10) : c.dataset.val;
      c.classList.toggle('selected', cv === controls[ctrl]);
    });
  }));

  document.querySelectorAll('.studio-dropdown-trigger').forEach(tr => tr.addEventListener('click', (e) => {
    e.stopPropagation(); const d = tr.closest('.studio-dropdown');
    document.querySelectorAll('.studio-dropdown.open').forEach(x => { if (x !== d) x.classList.remove('open'); });
    d.classList.toggle('open');
  }));
  document.addEventListener('click', () => document.querySelectorAll('.studio-dropdown.open').forEach(d => d.classList.remove('open')));

  document.getElementById('btn-delete')?.addEventListener('click', () => {
    showConfirmModal(t(NS() + '.confirmDelete'), t(NS() + '.confirmDeleteMsg'), {
      confirmLabel: t('common.delete', { defaultValue: 'Löschen' }), danger: true,
      onConfirm: async () => { try { await api.creations.delete(creation.id); toastSuccess(t(NS() + '.deleted')); navigate(LIB_ROUTE()); } catch (err) { toastError(err.message); } },
    });
  });
}

function initResizer() {
  const layout = document.querySelector('.studio-layout');
  const divider = document.getElementById('studio-divider');
  if (!layout || !divider) return;
  const MIN = 0.25, MAX = 0.7;
  const apply = (r) => { const ratio = Math.min(MAX, Math.max(MIN, r)); layout.style.setProperty('--studio-chat-fr', `${ratio}fr`); layout.style.setProperty('--studio-preview-fr', `${1 - ratio}fr`); return ratio; };
  const stored = parseFloat(localStorage.getItem('audioStudioSplitRatio'));
  let current = apply(Number.isFinite(stored) ? stored : 0.45);
  const onMove = (e) => { const rect = layout.getBoundingClientRect(); if (rect.width <= 0) return; current = apply((e.clientX - rect.left) / rect.width); };
  const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.classList.remove('studio-resizing'); divider.classList.remove('dragging'); localStorage.setItem('audioStudioSplitRatio', String(current)); };
  divider.addEventListener('mousedown', (e) => { e.preventDefault(); document.body.classList.add('studio-resizing'); divider.classList.add('dragging'); document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); });
}
