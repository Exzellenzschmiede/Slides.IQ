// ─── Story Studio — AI text / narrative / script studio ────────────────────

import { api } from '../api.js';
import { navigate } from '../router.js';
import { showConfirmModal } from '../components/modal.js';
import { toastSuccess, toastError } from '../components/toast.js';
import { genManager } from '../generationManager.js';
import { t } from '../i18n.js';

let creation = null;
let isGenerating = false;
let controls = { format: '', tone: '', length: '' };
let _watchingJobIds = [];
let _navAwayHandler = null;
let _doneListener = null;
let _errorListener = null;

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Minimal, safe markdown → HTML (escape first, then headings / bold / paragraphs).
function renderMarkdown(text) {
  const esc = escHtml(text);
  return esc.split(/\n{2,}/).map(block => {
    const b = block.trim();
    if (!b) return '';
    if (/^#{1,3}\s/.test(b)) {
      const level = b.match(/^#+/)[0].length;
      return `<h${level + 1}>${b.replace(/^#+\s/, '')}</h${level + 1}>`;
    }
    const inline = b.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>');
    return `<p>${inline}</p>`;
  }).join('');
}

function _watchJob(jobId) {
  genManager.setCardVisible(jobId, false);
  _watchingJobIds.push(jobId);
  if (_navAwayHandler) return;
  const handler = () => {
    _watchingJobIds.forEach(id => genManager.setCardVisible(id, true));
    _watchingJobIds = []; _navAwayHandler = null;
    window.removeEventListener('hashchange', handler);
  };
  _navAwayHandler = handler;
  window.addEventListener('hashchange', handler);
}

const FORMATS = ['story', 'script', 'blog', 'ad', 'poem', 'email'];
const TONES = ['neutral', 'inspiring', 'funny', 'dramatic', 'professional'];
const LENGTHS = ['short', 'medium', 'long'];

export async function renderStoryStudio(container, { id }) {
  if (!id) { navigate('stories'); return; }
  isGenerating = false;
  _watchingJobIds = [];
  if (_navAwayHandler) { window.removeEventListener('hashchange', _navAwayHandler); _navAwayHandler = null; }

  creation = await api.creations.get(id);
  controls = {
    format: creation.parameters?.format || '',
    tone: creation.parameters?.tone || '',
    length: creation.parameters?.length || '',
  };

  container.classList.add('studio-mode');
  container.innerHTML = buildHTML();
  initResizer();
  bindEvents();
  bindGenEvents();
  renderChat();
  renderDocument();

  const active = genManager.getActiveForPresentation(creation.id);
  if (active.length) { isGenerating = true; setGenerating(true); active.forEach(j => _watchJob(j.id)); }

  const seed = sessionStorage.getItem('storyStudioSeedPrompt');
  if (seed) { sessionStorage.removeItem('storyStudioSeedPrompt'); const i = document.getElementById('story-input'); if (i) i.value = seed; }
}

function chipRow(ctrl, vals) {
  return vals.map(v =>
    `<button class="question-chip ${controls[ctrl] === v ? 'selected' : ''}" data-ctrl="${ctrl}" data-val="${v}">${t('storyStudio.' + ctrl + 's.' + v)}</button>`
  ).join('');
}

function buildHTML() {
  return `
  <div class="studio-wrapper">
    <div class="studio-header" style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <button class="studio-back-btn" onclick="window.history.back()" title="${t('imageStudio.back')}">←</button>
      <div style="flex:1;min-width:0">
        <div class="presentation-card-title" style="font-size:18px">${escHtml(creation.title)}</div>
        <div class="text-xs text-muted">${t('storyStudio.libTitle')}</div>
      </div>
      <div class="studio-dropdown">
        <button class="btn btn-ghost btn-sm studio-dropdown-trigger">⋯</button>
        <div class="studio-dropdown-menu">
          <button class="studio-dropdown-item" id="btn-copy">${t('storyStudio.copy')}</button>
          <button class="studio-dropdown-item" id="btn-download">${t('storyStudio.download')}</button>
          <button class="studio-dropdown-item" id="btn-delete">${t('imageStudio.delete')}</button>
        </div>
      </div>
    </div>
    <div class="studio-layout">
      <div class="studio-sidebar">
        <div class="card studio-chat-history">
          <span class="form-label" style="margin-bottom:0">${t('hub.tiles.stories.title')}</span>
          <div class="chat-messages" id="story-chat"></div>
          <div id="story-generating" style="display:none">
            <div class="generating-indicator"><div class="gen-dots"><span></span><span></span><span></span></div><span>${t('storyStudio.generating')}</span></div>
          </div>
        </div>
        <div class="card studio-chat-input">
          <div class="image-controls">
            <div class="image-control-group"><span class="image-control-label">${t('storyStudio.format')}</span><div class="image-control-chips">${chipRow('format', FORMATS)}</div></div>
            <div class="image-control-group"><span class="image-control-label">${t('storyStudio.tone')}</span><div class="image-control-chips">${chipRow('tone', TONES)}</div></div>
            <div class="image-control-group"><span class="image-control-label">${t('storyStudio.length')}</span><div class="image-control-chips">${chipRow('length', LENGTHS)}</div></div>
          </div>
          <div class="chat-input-wrapper">
            <textarea class="chat-input" id="story-input" placeholder="${t('storyStudio.inputPlaceholder')}" rows="3"></textarea>
            <button class="send-btn" id="story-send" title="${t('imageStudio.send')}">→</button>
          </div>
        </div>
      </div>
      <div class="studio-divider" id="studio-divider" title="↔"></div>
      <div class="studio-preview">
        <div class="story-document" id="story-doc"></div>
      </div>
    </div>
  </div>`;
}

function latestContent() {
  if (creation.parameters?.content) return creation.parameters.content;
  const conv = (creation.conversation || []).filter(m => m.role === 'assistant');
  return conv.length ? conv[conv.length - 1].content : '';
}

function renderDocument() {
  const doc = document.getElementById('story-doc');
  if (!doc) return;
  const content = latestContent();
  doc.innerHTML = content
    ? renderMarkdown(content)
    : `<div class="image-empty-canvas"><div class="empty-state-icon">✎</div><div class="empty-state-desc">${t('storyStudio.emptyCanvas')}</div></div>`;
}

function renderChat() {
  const el = document.getElementById('story-chat');
  if (!el) return;
  const conv = (creation.conversation || []);
  if (!conv.length) {
    const chips = (t('storyStudio.welcomeChips') || []).map(c => `<button class="question-chip" data-seed="${escHtml(c)}">${escHtml(c)}</button>`).join('');
    el.innerHTML = `<div class="chat-message assistant welcome-msg"><div style="margin-bottom:8px">${t('storyStudio.welcome')}</div><div class="question-chips">${chips}</div></div>`;
    el.querySelectorAll('[data-seed]').forEach(b => b.addEventListener('click', () => { const i = document.getElementById('story-input'); i.value = b.dataset.seed; i.focus(); }));
    return;
  }
  el.innerHTML = conv.map(m => m.role === 'user'
    ? `<div class="chat-message user">${escHtml(m.content)}</div>`
    : `<div class="chat-message assistant">✓ ${t('storyStudio.generatedTurn')}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}

function setGenerating(active) {
  const ind = document.getElementById('story-generating');
  const input = document.getElementById('story-input');
  const send = document.getElementById('story-send');
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
  const chat = document.getElementById('story-chat');
  if (chat) {
    if (chat.querySelector('.welcome-msg')) chat.innerHTML = '';
    chat.insertAdjacentHTML('beforeend', `<div class="chat-message user">${escHtml(prompt)}</div>`);
    chat.scrollTop = chat.scrollHeight;
  }
  const jobId = genManager.start({
    presentationId: creation.id, module: 'story', title: creation.title,
    label: t('storyStudio.generating'), type: 'story-generate',
    openHref: `#story-studio/${creation.id}`, doneLabel: t('storyStudio.doneLabel'),
    apiCall: (signal) => api.creations.generate(creation.id, { prompt, format: controls.format || undefined, tone: controls.tone || undefined, length: controls.length || undefined }, signal),
  });
  _watchJob(jobId);
  const input = document.getElementById('story-input'); if (input) input.value = '';
}

function bindGenEvents() {
  if (_doneListener) window.removeEventListener('genmanager:done', _doneListener);
  if (_errorListener) window.removeEventListener('genmanager:error', _errorListener);
  _doneListener = async (e) => {
    if (e.detail.presentationId !== creation?.id) return;
    isGenerating = false; setGenerating(false);
    try { creation = await api.creations.get(creation.id); renderChat(); renderDocument(); } catch (_) {}
  };
  _errorListener = (e) => {
    if (e.detail.presentationId !== creation?.id) return;
    isGenerating = false; setGenerating(false);
    const info = e.detail.limitInfo;
    if (info && (info.code === 'feature_locked' || String(info.code || '').includes('quota'))) { toastError(e.detail.error || '?'); navigate('settings'); }
    else toastError(t('storyStudio.errorGenerate', { msg: e.detail.error || '?' }));
  };
  window.addEventListener('genmanager:done', _doneListener);
  window.addEventListener('genmanager:error', _errorListener);
}

function bindEvents() {
  const input = document.getElementById('story-input');
  document.getElementById('story-send')?.addEventListener('click', () => generate(input.value));
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(input.value); } });

  document.querySelectorAll('[data-ctrl]').forEach(chip => {
    chip.addEventListener('click', () => {
      const ctrl = chip.dataset.ctrl, val = chip.dataset.val;
      controls[ctrl] = controls[ctrl] === val ? '' : val;
      document.querySelectorAll(`[data-ctrl="${ctrl}"]`).forEach(c => c.classList.toggle('selected', c.dataset.val === controls[ctrl]));
    });
  });

  document.querySelectorAll('.studio-dropdown-trigger').forEach(tr => tr.addEventListener('click', (e) => {
    e.stopPropagation(); const d = tr.closest('.studio-dropdown');
    document.querySelectorAll('.studio-dropdown.open').forEach(x => { if (x !== d) x.classList.remove('open'); });
    d.classList.toggle('open');
  }));
  document.addEventListener('click', () => document.querySelectorAll('.studio-dropdown.open').forEach(d => d.classList.remove('open')));

  document.getElementById('btn-copy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(latestContent()); toastSuccess(t('storyStudio.copied')); } catch { toastError('?'); }
  });
  document.getElementById('btn-download')?.addEventListener('click', () => {
    const blob = new Blob([latestContent()], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${creation.title}.txt`; a.click(); URL.revokeObjectURL(a.href);
  });
  document.getElementById('btn-delete')?.addEventListener('click', () => {
    showConfirmModal(t('storyStudio.confirmDelete'), t('storyStudio.confirmDeleteMsg'), {
      confirmLabel: t('common.delete', { defaultValue: 'Löschen' }), danger: true,
      onConfirm: async () => { try { await api.creations.delete(creation.id); toastSuccess(t('storyStudio.deleted')); navigate('stories'); } catch (err) { toastError(err.message); } },
    });
  });
}

function initResizer() {
  const layout = document.querySelector('.studio-layout');
  const divider = document.getElementById('studio-divider');
  if (!layout || !divider) return;
  const MIN = 0.25, MAX = 0.7;
  const apply = (r) => { const ratio = Math.min(MAX, Math.max(MIN, r)); layout.style.setProperty('--studio-chat-fr', `${ratio}fr`); layout.style.setProperty('--studio-preview-fr', `${1 - ratio}fr`); return ratio; };
  const stored = parseFloat(localStorage.getItem('storyStudioSplitRatio'));
  let current = apply(Number.isFinite(stored) ? stored : 0.42);
  const onMove = (e) => { const rect = layout.getBoundingClientRect(); if (rect.width <= 0) return; current = apply((e.clientX - rect.left) / rect.width); };
  const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.classList.remove('studio-resizing'); divider.classList.remove('dragging'); localStorage.setItem('storyStudioSplitRatio', String(current)); };
  divider.addEventListener('mousedown', (e) => { e.preventDefault(); document.body.classList.add('studio-resizing'); divider.classList.add('dragging'); document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); });
}
