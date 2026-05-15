// ─── AI Studio View ───────────────────────────────────────────────────────

import { api } from '../api.js';
import { genManager } from '../generationManager.js';
import { navigate } from '../router.js';
import { showModal, closeModal, showConfirmModal } from '../components/modal.js';
import { toastSuccess, toastError, toastInfo } from '../components/toast.js';
import { openSlideEditor } from './slideEditor.js';
import { t, getCurrentLocale } from '../i18n.js';

let currentPresentation = null;
let isGenerating = false;
let presenterTimerInterval = null;
let presenterSeconds = 0;
let pendingAttachments = []; // [{type, name, content?, data?, mediaType?}]

// Slide navigator state
let currentSlideIndex = 0;
let slideScopedMode = false;
let slideScopedIndex = -1;
let messageListenerActive = false;

// Generation manager event listeners (stored to allow removal on re-render)
let _genProgressListener = null;
let _genDoneListener = null;
let _genErrorListener = null;

// ─── Stream overlay HTML template ────────────────────────────────────────
function streamOverlayHTML() {
  return `<div id="stream-overlay" style="display:none;position:absolute;inset:0;z-index:5;background:rgba(10,10,20,0.93);backdrop-filter:blur(4px)">
    <div class="stream-progress-bar"></div>
    <div class="stream-overlay-inner">
      <div class="stream-slide-cards" id="stream-slide-cards"></div>
      <div class="stream-counter-wrap">
        <span class="stream-counter-num" id="stream-slide-count">0</span>
        <span class="stream-counter-label">Slides</span>
      </div>
      <div class="stream-status-row">
        <div class="gen-toast-dots"><span></span><span></span><span></span></div>
        <span id="stream-label" class="text-sm text-muted"></span>
      </div>
      <div id="stream-chars" class="font-mono text-muted" style="font-size:11px;opacity:0.45"></div>
    </div>
  </div>`;
}

// Job IDs whose gen-toast cards the studio is suppressing
let _watchingJobIds = [];
let _navAwayHandler = null;

// Hide the gen-toast card for a job and register a one-shot hashchange listener
// that restores it when the user navigates away from the studio.
function _watchJob(jobId) {
  genManager.setCardVisible(jobId, false);
  _watchingJobIds.push(jobId);
  _bindNavAwayRestore();
}

function _bindNavAwayRestore() {
  if (_navAwayHandler) return; // already registered
  const handler = () => {
    _watchingJobIds.forEach(id => genManager.setCardVisible(id, true));
    _watchingJobIds = [];
    _navAwayHandler = null;
    window.removeEventListener('hashchange', handler);
  };
  _navAwayHandler = handler;
  window.addEventListener('hashchange', handler);
}

function getQuickPrompts() {
  return t('studio.quickPrompts');
}

export async function renderStudio(container, { id }) {
  if (!id) { navigate('dashboard'); return; }

  // Reset state on each render
  currentSlideIndex = 0;
  slideScopedMode = false;
  slideScopedIndex = -1;
  messageListenerActive = false;
  _watchingJobIds = [];
  if (_navAwayHandler) {
    window.removeEventListener('hashchange', _navAwayHandler);
    _navAwayHandler = null;
  }

  try {
    currentPresentation = await api.presentations.get(id);
  } catch {
    navigate('dashboard'); return;
  }

  container.classList.add('studio-mode');
  container.innerHTML = buildStudioHTML(currentPresentation);
  initStudio();
}

function buildStudioHTML(p) {
  const conversation = p.conversation || [];
  const chatHistory = conversation
    .filter(m => m.role === 'user')
    .map(m => `<div class="chat-message user">${escHtml(m.content)}</div>`)
    .join('');

  return `
  <div class="studio-wrapper">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-shrink:0">
    <button class="studio-back-btn" onclick="window.history.back()" title="${t('studio.backTitle')}">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <div>
      <h1 class="view-title" style="font-size:18px" id="studio-title">${escHtml(p.title)}</h1>
      <p class="view-subtitle" id="studio-meta">${p.slide_count || 0} ${t('common.slides')} · ${t('studio.metaSlides', { count: p.slide_count || 0, date: formatDate(p.updated_at) })}</p>
    </div>
    <div class="flex gap-8" style="margin-left:auto">
      ${p.html_content ? `
      <div class="studio-dropdown">
        <button class="btn btn-ghost btn-sm studio-dropdown-trigger">${t('studio.presentMenu')}</button>
        <div class="studio-dropdown-menu">
          <button class="studio-dropdown-item" id="btn-present">${t('studio.presentBtn')}</button>
          <button class="studio-dropdown-item" id="btn-presenter-mode">${t('studio.presenterBtn')}</button>
        </div>
      </div>
      ` : ''}
      ${p.html_content ? `
      <div class="studio-dropdown">
        <button class="btn btn-ghost btn-sm studio-dropdown-trigger">${t('studio.editBtn')}</button>
        <div class="studio-dropdown-menu">
          <button class="studio-dropdown-item" id="btn-edit-slides">${t('studio.editSlidesBtn')}</button>
          <button class="studio-dropdown-item" id="btn-analyze">${t('studio.analyzeBtn')}</button>
          <button class="studio-dropdown-item" id="btn-versions">${t('studio.versionsBtn')}</button>
        </div>
      </div>
      <div class="studio-dropdown">
        <button class="btn btn-ghost btn-sm studio-dropdown-trigger">${t('studio.shareBtn')}</button>
        <div class="studio-dropdown-menu">
          <button class="studio-dropdown-item" id="btn-share">${t('studio.shareSingle')}</button>
          <button class="studio-dropdown-item" id="btn-export-html">${t('studio.exportHtml')}</button>
          <button class="studio-dropdown-item" id="btn-export-pdf">${t('studio.exportPdf')}</button>
        </div>
      </div>
      ` : ''}
    </div>
  </div>

  <div class="studio-layout">
    <!-- Left: AI Chat + Controls -->
    <div class="studio-sidebar">

      <!-- Chat History -->
      <div class="card studio-chat-history">
        <div class="flex items-center justify-between">
          <span class="form-label" style="margin-bottom:0">${t('studio.aiStudio')}</span>
          <span class="text-xs text-muted" id="studio-model-label">Claude</span>
        </div>
        <div class="chat-messages" id="chat-messages">
          ${chatHistory || ''}
        </div>
        <div id="generating-indicator" style="display:none">
          <div class="generating-indicator">
            <div class="gen-dots"><span></span><span></span><span></span></div>
            <span id="generating-label">${t('studio.generating')}</span>
          </div>
        </div>
      </div>

      <!-- Chat Input -->
      <div class="card studio-chat-input">
        <div class="chat-input-area">
          <!-- Slide mode banner -->
          <div class="slide-mode-banner" id="slide-mode-banner" style="display:none">
            <span class="slide-mode-label" id="slide-mode-label">${t('studio.slideModeLabel', { index: 1 })}</span>
            <button class="btn btn-ghost btn-sm" id="slide-mode-off" style="font-size:10px;padding:2px 6px">${t('studio.slideModeOff')}</button>
          </div>
          <div id="attachment-chips" class="attachment-chips"></div>
          <div class="chat-input-wrapper">
            <button class="attach-btn" id="attach-btn" title="${t('studio.attachBtn')}">📎</button>
            <textarea
              class="chat-input" id="chat-input"
              placeholder="${t('studio.inputPlaceholder')}"
              rows="3"
            ></textarea>
            <button class="send-btn" id="send-btn" title="${t('studio.sendTitle')}">→</button>
          </div>
          <input type="file" id="file-input" multiple
            accept=".pdf,.docx,.xlsx,.xls,.csv,.pptx,.txt,.md,.png,.jpg,.jpeg,.gif,.webp"
            style="display:none">
        </div>
      </div>

      <!-- AI Suggestions (hidden initially) -->
      <div class="card hidden" id="suggestions-panel">
        <div class="flex items-center justify-between mb-8">
          <span class="form-label" style="margin-bottom:0">${t('studio.suggestionsTitle')}</span>
          <button class="btn btn-ghost btn-sm" id="close-suggestions">✕</button>
        </div>
        <div id="suggestions-list"></div>
      </div>
    </div>

    <!-- Right: Preview + Navigator -->
    <div class="studio-preview">
      <div class="preview-frame-container" id="preview-container">
        ${currentPresentation.html_content
          ? `<iframe id="preview-iframe" sandbox="allow-scripts allow-same-origin"></iframe>`
          : `<div class="preview-placeholder">
              <div class="preview-placeholder-icon">◈</div>
              <div class="text-muted" style="font-size:14px">${t('studio.noContentPlaceholder')}</div>
            </div>`
        }
        <!-- Streaming overlay -->
        ${streamOverlayHTML()}
      </div>

      <!-- Slide Navigator -->
      ${p.html_content ? `
      <div class="slide-navigator" id="slide-navigator">
        <!-- Built dynamically by buildSlideNavigator() -->
      </div>
      ` : ''}

    </div>
  </div>
  </div>
  `;
}

function initStudio() {
  loadTemplateInfo();
  loadModelLabel();
  loadPreview();
  bindEvents();
  bindGenerationEvents();
  if (currentPresentation.html_content) {
    buildSlideNavigator();
  }
  // Re-attach to any generation that started before navigating away
  const active = genManager.getActiveForPresentation(currentPresentation.id);
  if (active.length > 0) {
    isGenerating = true;
    showStreamOverlay(active[0].label);
    setGeneratingUI(true, active[0].label);
    // Hide gen-toast cards — the studio overlay is the primary status indicator
    active.forEach(j => genManager.setCardVisible(j.id, false));
    _watchingJobIds = active.map(j => j.id);
    _bindNavAwayRestore();
  }
}

async function loadModelLabel() {
  try {
    const status = await api.ai.status();
    const el = document.getElementById('studio-model-label');
    if (el) el.textContent = status.model || 'Claude';
  } catch {}
}

async function loadTemplateInfo() {
  const templates = await api.templates.list().catch(() => []);
  const tplEl = document.getElementById('active-template-name');
  if (!tplEl) return;

  if (currentPresentation.template_id) {
    const tpl = templates.find(tpl => tpl.id === currentPresentation.template_id);
    tplEl.textContent = tpl ? tpl.name : t('studio.customTemplate');
  } else {
    tplEl.textContent = t('studio.noTemplateDefault');
  }
}

function loadPreview() {
  const iframe = document.getElementById('preview-iframe');
  if (!iframe || !currentPresentation.html_content) return;

  const blob = new Blob([currentPresentation.html_content], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  iframe.src = url;

  // Register message listener once per studio session
  if (!messageListenerActive) {
    messageListenerActive = true;
    window.addEventListener('message', onIframeMessage);
  }
}

function onIframeMessage(e) {
  if (e.data?.type === 'nexus-slide') {
    currentSlideIndex = e.data.index;
    document.getElementById('studio-meta').textContent =
      `${e.data.total} ${t('common.slides')} · ${t('studio.metaActive', { count: e.data.total, index: e.data.index + 1 })}`;
    syncNavigatorToSlide(e.data.index);
  }
  // Presenter panel
  if (e.data?.type === 'nexus-slide') {
    const notesEl = document.getElementById('presenter-notes-content');
    const counterEl = document.getElementById('presenter-counter');
    if (notesEl) notesEl.textContent = e.data.notes || '—';
    if (counterEl) counterEl.textContent = `${e.data.index + 1} / ${e.data.total}`;
  }
}

// ─── Slide Navigator ──────────────────────────────────────────────────────

function buildSlideNavigator() {
  const nav = document.getElementById('slide-navigator');
  if (!nav) return;

  const count = currentPresentation.slide_count || 0;
  if (count === 0) { nav.innerHTML = ''; return; }

  let html = '';

  // Insert before first slide
  html += `<button class="insert-tile-btn" data-after="-1" title="${t('studio.insertBtnTitleStart')}">+</button>`;

  for (let i = 0; i < count; i++) {
    html += `
      <div class="slide-tile${i === currentSlideIndex ? ' active' : ''}" data-index="${i}">
        <span>${i + 1}</span>
        <div class="slide-tile-actions">
          <button class="tile-action-btn" data-tile-action="edit" data-index="${i}" title="${t('studio.slideEditTitle', { index: i + 1 })}">✏</button>
          <button class="tile-action-btn" data-tile-action="dup" data-index="${i}" title="${t('studio.dupTitle')}">⧉</button>
          <button class="tile-action-btn danger" data-tile-action="del" data-index="${i}" title="${t('studio.delTitle')}">🗑</button>
        </div>
      </div>
      <button class="insert-tile-btn" data-after="${i}" title="${t('studio.insertBtnTitle')}">+</button>
    `;
  }

  nav.innerHTML = html;

  // Tile click → activate scoped edit mode + navigate iframe
  nav.querySelectorAll('.slide-tile').forEach(tile => {
    tile.addEventListener('click', (e) => {
      if (e.target.closest('.slide-tile-actions')) return; // ignore action clicks
      const idx = parseInt(tile.dataset.index);
      activateSlideScopedMode(idx);
    });
  });

  // Action buttons
  nav.querySelectorAll('[data-tile-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.tileAction;
      const idx = parseInt(btn.dataset.index);
      handleSlideAction(idx, action);
    });
  });

  // Insert buttons
  nav.querySelectorAll('.insert-tile-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const afterIndex = parseInt(btn.dataset.after);
      showInsertSlideModal(afterIndex);
    });
  });
}

function syncNavigatorToSlide(index) {
  document.querySelectorAll('.slide-tile').forEach((tile, i) => {
    tile.classList.toggle('active', i === index);
  });

  // Scroll active tile into view
  const activeTile = document.querySelector(`.slide-tile[data-index="${index}"]`);
  activeTile?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
}

function gotoIframeSlide(index) {
  const iframe = document.getElementById('preview-iframe');
  iframe?.contentWindow?.postMessage({ type: 'nexus-goto', index }, '*');
  currentSlideIndex = index;
  syncNavigatorToSlide(index);
}

function handleSlideAction(index, action) {
  if (action === 'edit') {
    activateSlideScopedMode(index);
  } else if (action === 'dup') {
    duplicateSlide(index);
  } else if (action === 'del') {
    deleteSlide(index);
  }
}

function activateSlideScopedMode(index) {
  slideScopedMode = true;
  slideScopedIndex = index;

  const banner = document.getElementById('slide-mode-banner');
  const label = document.getElementById('slide-mode-label');
  const input = document.getElementById('chat-input');

  if (banner) banner.style.display = 'flex';
  if (label) label.textContent = t('studio.slideModeLabel', { index: index + 1 });
  if (input) {
    input.placeholder = t('studio.slideScopedPlaceholder', { index: index + 1 });
    input.focus();
  }

  // Navigate to that slide in preview
  gotoIframeSlide(index);
}

function deactivateSlideScopedMode() {
  slideScopedMode = false;
  slideScopedIndex = -1;

  const banner = document.getElementById('slide-mode-banner');
  const input = document.getElementById('chat-input');

  if (banner) banner.style.display = 'none';
  if (input) input.placeholder = t('studio.inputPlaceholder');
}

async function duplicateSlide(index) {
  if (isGenerating) return;
  try {
    const result = await api.presentations.duplicateSlide(currentPresentation.id, index);
    currentPresentation.slide_count = result.slide_count;
    await refreshAfterSlideOp(result.slide_count, result.new_index ?? index + 1);
    toastSuccess(t('studio.slideDuplicated', { index: index + 1 }));
  } catch (err) {
    toastError(t('common.error') + ': ' + err.message);
  }
}

function deleteSlide(index) {
  if (isGenerating) return;
  showConfirmModal(t('studio.confirmDeleteSlide', { index: index + 1 }), `Slide ${index + 1} wird unwiderruflich gelöscht.`, {
    confirmLabel: 'Löschen', danger: true,
    onConfirm: async () => {
      try {
        const result = await api.presentations.deleteSlide(currentPresentation.id, index);
        currentPresentation.slide_count = result.slide_count;
        const newIndex = Math.min(index, result.slide_count - 1);
        await refreshAfterSlideOp(result.slide_count, newIndex);
        toastSuccess(t('studio.slideDeleted', { index: index + 1 }));
      } catch (err) {
        toastError(t('common.error') + ': ' + err.message);
      }
    }
  });
}

async function refreshAfterSlideOp(slideCount, gotoIndex = 0) {
  currentPresentation = await api.presentations.get(currentPresentation.id);
  currentPresentation.slide_count = slideCount;
  currentSlideIndex = gotoIndex;

  // Rebuild preview
  const container = document.getElementById('preview-container');
  if (container) {
    container.innerHTML = `<iframe id="preview-iframe" sandbox="allow-scripts allow-same-origin"></iframe>${streamOverlayHTML()}`;
    loadPreview();
  }

  buildSlideNavigator();

  // Goto new index after iframe loads
  setTimeout(() => gotoIframeSlide(gotoIndex), 600);

  document.getElementById('studio-meta').textContent =
    `${slideCount} ${t('common.slides')} · ${t('studio.metaJustEdited', { count: slideCount })}`;
}

function showInsertSlideModal(afterIndex) {
  const posLabel = afterIndex < 0
    ? t('studio.insertAtStart')
    : t('studio.insertAfter', { index: afterIndex + 1 });
  showModal(t('studio.insertSlideTitle', { pos: posLabel }), `
    <div class="form-group">
      <label class="form-label">${t('studio.insertPromptLabel')}</label>
      <textarea class="form-input" id="insert-slide-prompt" rows="3"
        placeholder="${t('studio.insertPromptPlaceholder')}"
        style="resize:vertical;width:100%"></textarea>
    </div>
    <div class="flex gap-8" style="justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" id="insert-slide-cancel">${t('common.cancel')}</button>
      <button class="btn btn-primary" id="insert-slide-confirm">${t('studio.insertConfirm')}</button>
    </div>
  `, t('studio.insertStyle'));

  setTimeout(() => document.getElementById('insert-slide-prompt')?.focus(), 50);

  document.getElementById('insert-slide-cancel')?.addEventListener('click', closeModal);
  document.getElementById('insert-slide-confirm')?.addEventListener('click', async () => {
    const prompt = document.getElementById('insert-slide-prompt')?.value.trim();
    if (!prompt) return;
    closeModal();
    await streamInsertSlide(afterIndex, prompt);
  });

  document.getElementById('insert-slide-prompt')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('insert-slide-confirm')?.click();
    }
  });
}

// ─── Streaming: edit or insert single slide ───────────────────────────────

function streamEditSlide(slideIndex, prompt) {
  if (isGenerating) return;
  isGenerating = true;

  const label = t('studio.generatingSlide', { index: slideIndex + 1 });
  setGeneratingUI(true, label);
  showStreamOverlay(label);
  addChatMessage('user', `[Slide ${slideIndex + 1}] ${prompt}`);

  const jobId = genManager.start({
    presentationId: currentPresentation.id,
    title: currentPresentation.title,
    label,
    type: 'edit',
    meta: { slideIndex },
    apiCall: (signal) => api.ai.editSlide(currentPresentation.id, slideIndex, prompt, signal),
  });
  _watchJob(jobId);
}

function streamInsertSlide(afterIndex, prompt) {
  if (isGenerating) return;
  isGenerating = true;

  const posLabel = afterIndex < 0
    ? t('studio.insertAtStart')
    : t('studio.insertAfter', { index: afterIndex + 1 });
  const label = t('studio.generatingNew', { pos: posLabel });
  setGeneratingUI(true, label);
  showStreamOverlay(label);
  addChatMessage('user', `[${t('common.slides')} ${posLabel}] ${prompt}`);

  const jobId = genManager.start({
    presentationId: currentPresentation.id,
    title: currentPresentation.title,
    label,
    type: 'insert',
    meta: { afterIndex },
    apiCall: (signal) => api.ai.insertSlide(currentPresentation.id, afterIndex, prompt, signal),
  });
  _watchJob(jobId);
}

// ─── UI helpers ───────────────────────────────────────────────────────────

function setGeneratingUI(active, label) {
  if (!label) label = t('studio.generating');
  const indicator = document.getElementById('generating-indicator');
  const labelEl = document.getElementById('generating-label');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');
  const quickPrompts = document.getElementById('quick-prompts');

  if (indicator) indicator.style.display = active ? 'block' : 'none';
  if (labelEl) labelEl.textContent = label;
  if (input) input.disabled = active;
  if (sendBtn) sendBtn.disabled = active;
  if (quickPrompts) quickPrompts.style.opacity = active ? '0.4' : '1';
}

function showStreamOverlay(label) {
  if (!label) label = t('studio.streamLabel');
  const overlay = document.getElementById('stream-overlay');
  const labelEl = document.getElementById('stream-label');
  const charEl = document.getElementById('stream-chars');
  const countEl = document.getElementById('stream-slide-count');
  const cardsEl = document.getElementById('stream-slide-cards');
  if (overlay) overlay.style.display = 'block';
  if (labelEl) labelEl.textContent = label;
  if (charEl) charEl.textContent = '';
  if (countEl) countEl.textContent = '0';
  if (cardsEl) cardsEl.innerHTML = '';
}

function hideStreamOverlay() {
  const overlay = document.getElementById('stream-overlay');
  if (overlay) overlay.style.display = 'none';
}

function updateStreamSlideCount(count) {
  const countEl = document.getElementById('stream-slide-count');
  const cardsEl = document.getElementById('stream-slide-cards');
  if (!countEl || !cardsEl) return;
  const current = parseInt(countEl.textContent) || 0;
  if (count === current) return;
  countEl.textContent = String(count);
  // Bump animation
  countEl.classList.remove('bump');
  requestAnimationFrame(() => countEl.classList.add('bump'));
  // Add new slide-card thumbnails
  const existing = cardsEl.children.length;
  for (let i = existing; i < count; i++) {
    const card = document.createElement('div');
    card.className = 'stream-slide-card';
    cardsEl.appendChild(card);
  }
}

// ─── Question-slide detection ─────────────────────────────────────────────

function detectQuestionSlide(html) {
  // Use a temporary DOM element for reliable parsing
  const temp = document.createElement('div');
  temp.innerHTML = html;
  const slides = temp.querySelectorAll('#nexus-presentation .slide');
  if (slides.length !== 1) return null;

  const slide = slides[0];
  const text = slide.textContent.trim();
  if (!text.includes('?')) return null;

  // Extract the question sentence
  const headingWithQ = [...slide.querySelectorAll('h1,h2,h3,p')].find(el => el.textContent.includes('?'));
  const question = headingWithQ
    ? headingWithQ.textContent.trim()
    : (text.match(/[^.!]*\?/) || [''])[0].trim() || text.substring(0, 240);

  // Extract options from list items or buttons (max 6)
  const options = [...slide.querySelectorAll('li, button')]
    .map(el => el.textContent.trim())
    .filter(Boolean)
    .slice(0, 6);

  return { question, options };
}

function showQuestionInChat({ question, options }) {
  const chips = options.length
    ? `<div class="question-chips">${options.map(o =>
        `<button class="question-chip" data-suggestion="${escHtml(o)}">${escHtml(o)}</button>`
      ).join('')}</div>`
    : '';

  const messages = document.getElementById('chat-messages');
  if (!messages) return;

  messages.insertAdjacentHTML('beforeend',
    `<div class="chat-message assistant"><div style="margin-bottom:${options.length ? 6 : 0}px">${escHtml(question)}</div>${chips}</div>`
  );
  messages.scrollTop = messages.scrollHeight;

  // Wire chip clicks → fill input
  const input = document.getElementById('chat-input');
  messages.querySelectorAll('.question-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (input) { input.value = chip.dataset.suggestion; input.focus(); }
    });
  });
}

// ─── Planning helpers ─────────────────────────────────────────────────────

function addThinkingMessage() {
  const id = 'thinking-' + Date.now();
  const messages = document.getElementById('chat-messages');
  if (messages) {
    messages.insertAdjacentHTML('beforeend',
      `<div class="thinking-msg" id="${id}">
        <div class="gen-toast-dots"><span></span><span></span><span></span></div>
        <span>${t('studio.planning') || 'Planning…'}</span>
      </div>`
    );
    messages.scrollTop = messages.scrollHeight;
  }
  return id;
}

function removeThinkingMessage(id) {
  document.getElementById(id)?.remove();
}

function showPlanInChat(plan, onConfirm) {
  const outlineHtml = plan.outline.length
    ? `<div class="plan-outline-label" style="margin-top:10px">📋 ${plan.slideCount} ${t('common.slides') || 'Slides'}</div>
       <ol class="plan-outline-list">${plan.outline.map(title => `<li>${escHtml(title)}</li>`).join('')}</ol>`
    : '';

  const msgId = 'plan-' + Date.now();
  const messages = document.getElementById('chat-messages');
  if (!messages) return;

  messages.insertAdjacentHTML('beforeend', `
    <div class="chat-message assistant" id="${msgId}">
      <div class="plan-summary">${escHtml(plan.summary)}</div>
      ${outlineHtml}
      <div class="question-chips" style="margin-top:12px">
        <button class="question-chip" style="border-color:rgba(74,222,128,0.4);background:rgba(74,222,128,0.1)" id="${msgId}-ok">✓ ${t('studio.planConfirm') || 'So erstellen'}</button>
        <button class="question-chip" id="${msgId}-cancel">✗ ${t('common.cancel') || 'Abbrechen'}</button>
      </div>
    </div>
  `);
  messages.scrollTop = messages.scrollHeight;

  document.getElementById(`${msgId}-ok`)?.addEventListener('click', () => {
    // Disable chips to prevent double-fire
    document.querySelectorAll(`#${msgId} button`).forEach(b => b.disabled = true);
    onConfirm();
  });

  document.getElementById(`${msgId}-cancel`)?.addEventListener('click', () => {
    document.getElementById(msgId)?.remove();
    const input = document.getElementById('chat-input');
    if (input) { input.disabled = false; input.focus(); }
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) sendBtn.disabled = false;
  });
}

function startFullGeneration(prompt, attachments) {
  isGenerating = true;
  setGeneratingUI(true, t('studio.generating'));
  showStreamOverlay(t('studio.streamLabel'));

  const jobId = genManager.start({
    presentationId: currentPresentation.id,
    title: currentPresentation.title,
    label: t('studio.generating'),
    type: 'generate',
    meta: {},
    apiCall: (signal) => api.ai.generate(currentPresentation.id, prompt, attachments, signal),
  });
  _watchJob(jobId);
}

function startInsertOperation(prompt, attachments) {
  const afterIndex = (currentPresentation.slide_count || 0) - 1;
  isGenerating = true;
  setGeneratingUI(true, t('studio.generating'));
  showStreamOverlay(t('studio.streamLabel'));

  const jobId = genManager.start({
    presentationId: currentPresentation.id,
    title: currentPresentation.title,
    label: t('studio.generating'),
    type: 'insert',
    meta: { afterIndex },
    apiCall: (signal) => api.ai.insertSlide(currentPresentation.id, afterIndex, prompt, signal),
  });
  _watchJob(jobId);
}

// ─── Main send (routes to full generation or slide-scoped edit) ───────────

async function sendMessage() {
  if (isGenerating) return;
  const input = document.getElementById('chat-input');
  const prompt = input?.value.trim();
  if (!prompt) return;

  // Route to slide-scoped edit if mode is active — no planning needed
  if (slideScopedMode && slideScopedIndex >= 0) {
    input.value = '';
    streamEditSlide(slideScopedIndex, prompt);
    return;
  }

  const attachments = [...pendingAttachments];
  clearAttachments();
  input.value = '';

  const attachmentLabel = attachments.length
    ? `\n📎 ${attachments.map(a => a.name).join(', ')}`
    : '';
  addChatMessage('user', prompt + attachmentLabel);

  // ── Planning phase: show plan before generating ───────────────────────
  input.disabled = true;
  document.getElementById('send-btn').disabled = true;
  const thinkingId = addThinkingMessage();

  try {
    const plan = await api.ai.plan(currentPresentation.id, prompt, attachments);
    removeThinkingMessage(thinkingId);
    input.disabled = false;
    document.getElementById('send-btn').disabled = false;

    showPlanInChat(plan, () => {
      if (plan.action === 'insert') {
        startInsertOperation(prompt, attachments);
      } else {
        startFullGeneration(prompt, attachments);
      }
    });
  } catch (err) {
    removeThinkingMessage(thinkingId);
    input.disabled = false;
    document.getElementById('send-btn').disabled = false;
    // Planning failed → fall back to direct generation
    toastError((t('studio.planError') || 'Planung fehlgeschlagen') + ': ' + err.message);
  }
}

// ─── Generation manager event wiring ─────────────────────────────────────

function bindGenerationEvents() {
  // Remove stale listeners from any previous studio mount
  if (_genProgressListener) window.removeEventListener('genmanager:progress', _genProgressListener);
  if (_genDoneListener)     window.removeEventListener('genmanager:done',     _genDoneListener);
  if (_genErrorListener)    window.removeEventListener('genmanager:error',    _genErrorListener);

  _genProgressListener = (e) => {
    if (e.detail.presentationId !== currentPresentation?.id) return;

    const charEl = document.getElementById('stream-chars');
    if (charEl) charEl.textContent = t('studio.streamChars', {
      count: e.detail.chars.toLocaleString(getCurrentLocale())
    });

    // Count slides detected so far and update the counter + card grid
    if (e.detail.liveHtml) {
      const count = (e.detail.liveHtml.match(/<div class="slide"/g) || []).length;
      updateStreamSlideCount(count);
    }
  };

  _genDoneListener = async (e) => {
    if (e.detail.presentationId !== currentPresentation?.id) return;
    const { type, meta, slideCount, newIndex } = e.detail;

    isGenerating = false;
    setGeneratingUI(false);
    hideStreamOverlay();

    try {
      currentPresentation = await api.presentations.get(currentPresentation.id);

      if (type === 'generate') {
        // Check if the AI generated a question slide instead of a real presentation
        if (currentPresentation.slide_count === 1 && currentPresentation.html_content) {
          const questionData = detectQuestionSlide(currentPresentation.html_content);
          if (questionData) {
            showQuestionInChat(questionData);
            // Don't rebuild preview — keep whatever was there before
            document.getElementById('chat-input')?.focus();
            return;
          }
        }

        // Rebuild full preview + navigator
        const container = document.getElementById('preview-container');
        if (container) {
          container.innerHTML = `<iframe id="preview-iframe" sandbox="allow-scripts allow-same-origin"></iframe>${streamOverlayHTML()}`;
          loadPreview();
        }
        if (!document.getElementById('slide-navigator')) {
          const previewDiv = document.querySelector('.studio-preview');
          if (previewDiv) {
            const nav = document.createElement('div');
            nav.className = 'slide-navigator';
            nav.id = 'slide-navigator';
            previewDiv.insertBefore(nav, previewDiv.querySelector('.preview-actions'));
          }
        }
        buildSlideNavigator();
        document.getElementById('studio-meta').textContent =
          `${currentPresentation.slide_count} ${t('common.slides')} · ${t('studio.metaJustUpdated', { count: currentPresentation.slide_count })}`;
        addChatMessage('assistant', t('studio.assistantCreated', { count: currentPresentation.slide_count }));
        toastSuccess(t('studio.presentationGenerated'));
        if (!document.getElementById('btn-present')) refreshStudioHeader();

      } else if (type === 'edit') {
        await refreshAfterSlideOp(currentPresentation.slide_count, meta.slideIndex);
        addChatMessage('assistant', t('studio.assistantSlideUpdated', { index: meta.slideIndex + 1 }));
        toastSuccess(t('studio.slideUpdated', { index: meta.slideIndex + 1 }));

      } else if (type === 'insert') {
        const idx = newIndex ?? meta.afterIndex + 1;
        await refreshAfterSlideOp(currentPresentation.slide_count, idx);
        addChatMessage('assistant', t('studio.assistantSlideInserted', { index: idx + 1, total: currentPresentation.slide_count }));
        toastSuccess(t('studio.slideInserted'));
      }
    } catch (err) {
      toastError(err.message);
    }

    document.getElementById('chat-input')?.focus();
  };

  _genErrorListener = (e) => {
    if (e.detail.presentationId !== currentPresentation?.id) return;
    isGenerating = false;
    setGeneratingUI(false);
    hideStreamOverlay();
    if (e.detail.status !== 'cancelled') {
      addChatMessage('assistant', t('studio.assistantError', { msg: e.detail.error || 'Fehler' }));
      toastError(e.detail.error || 'Generierung fehlgeschlagen');
    }
    document.getElementById('chat-input')?.focus();
  };

  window.addEventListener('genmanager:progress', _genProgressListener);
  window.addEventListener('genmanager:done',     _genDoneListener);
  window.addEventListener('genmanager:error',    _genErrorListener);
}

// ─── Event binding ────────────────────────────────────────────────────────

function bindEvents() {
  // Dropdown menus
  document.querySelectorAll('.studio-dropdown-trigger').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = trigger.closest('.studio-dropdown');
      const isOpen = dropdown.classList.contains('open');
      document.querySelectorAll('.studio-dropdown.open').forEach(d => d.classList.remove('open'));
      if (!isOpen) dropdown.classList.add('open');
    });
  });
  // Close dropdowns on outside click (bubble phase — stopPropagation in trigger prevents re-close)
  document.addEventListener('click', () => {
    document.querySelectorAll('.studio-dropdown.open').forEach(d => d.classList.remove('open'));
  });

  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');

  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn?.addEventListener('click', sendMessage);

  // Quick prompts
  document.querySelectorAll('.quick-prompt').forEach(btn => {
    btn.addEventListener('click', () => {
      chatInput.value = btn.dataset.prompt;
      chatInput.focus();
    });
  });

  // Slide mode off
  document.getElementById('slide-mode-off')?.addEventListener('click', deactivateSlideScopedMode);

  // File attachment
  document.getElementById('attach-btn')?.addEventListener('click', () => {
    document.getElementById('file-input')?.click();
  });

  document.getElementById('file-input')?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const file of files) {
      await uploadAttachment(file);
    }
  });

  // Present button
  document.getElementById('btn-present')?.addEventListener('click', () => {
    if (!currentPresentation.html_content) return;
    const blob = new Blob([currentPresentation.html_content], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  });

  // Presenter mode
  document.getElementById('btn-presenter-mode')?.addEventListener('click', openPresenterMode);

  // WYSIWYG slide editor
  document.getElementById('btn-edit-slides')?.addEventListener('click', () => {
    openSlideEditor(currentPresentation, async () => {
      currentPresentation = await api.presentations.get(currentPresentation.id);
      loadPreview();
      buildSlideNavigator();
      document.getElementById('studio-meta').textContent =
        `${currentPresentation.slide_count} ${t('common.slides')} · ${t('studio.metaJustEdited', { count: currentPresentation.slide_count })}`;
    });
  });

  document.getElementById('btn-analyze')?.addEventListener('click', showAnalysis);
  document.getElementById('btn-suggest')?.addEventListener('click', loadSuggestions);
  document.getElementById('btn-versions')?.addEventListener('click', showVersions);
  document.getElementById('btn-share')?.addEventListener('click', showShare);

  document.getElementById('btn-export-html')?.addEventListener('click', () => {
    api.presentations.exportHtml(currentPresentation.id, currentPresentation.title);
  });

  document.getElementById('btn-export-pdf')?.addEventListener('click', async () => {
    try {
      toastInfo(t('studio.pdfCreating'));
      const blob = await api.presentations.exportPdf(currentPresentation.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${currentPresentation.title}.pdf`; a.click();
      toastSuccess(t('studio.pdfExported'));
    } catch (err) {
      toastError(t('studio.pdfError', { msg: err.message }));
    }
  });

  document.getElementById('btn-change-template')?.addEventListener('click', showTemplateChooser);

  document.getElementById('close-suggestions')?.addEventListener('click', () => {
    document.getElementById('suggestions-panel').classList.add('hidden');
  });
}

// ─── Attachment handling ──────────────────────────────────────────────────

async function uploadAttachment(file) {
  const chipId = `chip-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  addAttachmentChip(chipId, file.name, true);
  try {
    const result = await api.ai.upload(file);
    pendingAttachments.push(result);
    updateAttachmentChip(chipId, file.name, false);
  } catch (err) {
    removeAttachmentChip(chipId);
    toastError(t('studio.uploadFailed', { msg: err.message }));
  }
}

function addAttachmentChip(id, name, loading) {
  const chips = document.getElementById('attachment-chips');
  if (!chips) return;
  const chip = document.createElement('div');
  chip.className = 'attachment-chip' + (loading ? ' loading' : '');
  chip.id = id;
  const icon = name.match(/\.(png|jpe?g|gif|webp)$/i) ? '🖼' :
               name.match(/\.pdf$/i) ? '📄' :
               name.match(/\.docx?$/i) ? '📝' :
               name.match(/\.xlsx?|\.csv$/i) ? '📊' :
               name.match(/\.pptx?$/i) ? '📑' : '📎';
  chip.innerHTML = `
    <span class="chip-icon">${loading ? '⏳' : icon}</span>
    <span class="chip-name">${escHtml(name)}</span>
    <button class="chip-remove" data-chip="${id}" title="${t('common.remove')}">✕</button>
  `;
  chip.querySelector('.chip-remove').addEventListener('click', () => {
    const idx = pendingAttachments.findIndex(a => a.name === name);
    if (idx !== -1) pendingAttachments.splice(idx, 1);
    removeAttachmentChip(id);
  });
  chips.appendChild(chip);
}

function updateAttachmentChip(id, name, loading) {
  const chip = document.getElementById(id);
  if (!chip) return;
  chip.classList.toggle('loading', loading);
  const icon = chip.querySelector('.chip-icon');
  if (icon) icon.textContent = name.match(/\.(png|jpe?g|gif|webp)$/i) ? '🖼' :
    name.match(/\.pdf$/i) ? '📄' : name.match(/\.docx?$/i) ? '📝' :
    name.match(/\.xlsx?|\.csv$/i) ? '📊' : name.match(/\.pptx?$/i) ? '📑' : '📎';
}

function removeAttachmentChip(id) {
  document.getElementById(id)?.remove();
}

function clearAttachments() {
  pendingAttachments = [];
  const chips = document.getElementById('attachment-chips');
  if (chips) chips.innerHTML = '';
}

// ─── Chat ─────────────────────────────────────────────────────────────────

function addChatMessage(role, text) {
  const messages = document.getElementById('chat-messages');
  if (!messages) return;
  const div = document.createElement('div');
  div.className = `chat-message ${role}`;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function refreshStudioHeader() {
  renderStudio(document.getElementById('view-container'), { id: currentPresentation.id });
}

// ─── Analysis / Suggestions ───────────────────────────────────────────────

async function showAnalysis() {
  showModal(t('studio.analysisTitle'), '<div class="loading-screen" style="height:200px"><div class="loading-orb"></div></div>');
  try {
    const analysis = await api.ai.analyze(currentPresentation.id);
    const scoreVal = analysis.score || 0;
    closeModal();
    showModal(t('studio.analysisTitle'), `
      <div class="analysis-score">
        <div class="score-circle" style="--score:${scoreVal}">
          <span>${scoreVal}/10</span>
        </div>
        <div>
          <div style="font-weight:600;margin-bottom:4px">${analysis.summary || ''}</div>
          <div class="text-sm text-muted">${t('studio.narrativeFlow')}: ${analysis.narrativeFlow || '—'}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <div class="form-label">${t('studio.strengths')}</div>
          ${(analysis.strengths || []).map(s => `<div class="text-sm" style="padding:4px 0;border-bottom:1px solid var(--border)">✓ ${s}</div>`).join('') || '<div class="text-muted text-sm">—</div>'}
        </div>
        <div>
          <div class="form-label">${t('studio.improvements')}</div>
          ${(analysis.improvements || []).map(s => `<div class="text-sm" style="padding:4px 0;border-bottom:1px solid var(--border)">→ ${s}</div>`).join('') || '<div class="text-muted text-sm">—</div>'}
        </div>
      </div>
    `, t('studio.analysisSubtitle'));
  } catch (err) {
    closeModal();
    toastError(t('studio.analysisFailed', { msg: err.message }));
  }
}

async function loadSuggestions() {
  const panel = document.getElementById('suggestions-panel');
  const list = document.getElementById('suggestions-list');
  if (!panel || !list) return;

  panel.classList.remove('hidden');
  list.innerHTML = '<div class="loading-screen" style="height:80px"><div class="loading-orb" style="width:24px;height:24px"></div></div>';

  try {
    const suggestions = await api.ai.suggest(currentPresentation.id);
    list.innerHTML = suggestions.map((s, i) => `
      <div class="card" style="margin-bottom:8px;cursor:pointer" onclick="document.getElementById('chat-input').value = '${escHtml(s.prompt).replace(/'/g, "\\'")}'; document.getElementById('chat-input').focus()">
        <div style="font-size:13px;font-weight:600;margin-bottom:4px">${s.title || t('studio.suggestionFallback', { index: i + 1 })}</div>
        <div class="text-sm text-muted">${s.description || ''}</div>
        <div class="text-xs" style="margin-top:8px;color:var(--primary)">${t('studio.suggestClickToApply')}</div>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<div class="text-muted text-sm">${t('studio.suggestError', { msg: err.message })}</div>`;
  }
}

// ─── Versions / Share / Template ─────────────────────────────────────────

async function showVersions() {
  const p = await api.presentations.get(currentPresentation.id);
  const versions = p.versions || [];

  showModal(t('studio.versionsTitle'), `
    <div class="versions-list">
      ${versions.length === 0
        ? `<div class="empty-state" style="padding:40px 0"><div class="empty-state-icon">⏱</div><div class="text-muted">${t('studio.versionEmpty')}</div></div>`
        : versions.map(v => `
          <div class="version-item">
            <div class="version-label">${v.label || t('studio.versionLabel')}</div>
            <div class="version-date">${formatDate(v.timestamp)}</div>
            <button class="btn btn-ghost btn-sm" onclick="restoreVersion('${v.id}')">${t('common.restore')}</button>
          </div>
        `).join('')
      }
    </div>
  `, t('studio.versionsSubtitle', { count: versions.length }));

  window.restoreVersion = (versionId) => {
    showConfirmModal(t('studio.restoreConfirm'), 'Die aktuelle Version wird durch diese ersetzt.', {
      confirmLabel: 'Wiederherstellen', danger: false,
      onConfirm: async () => {
        try {
          await api.presentations.restoreVersion(currentPresentation.id, versionId);
          currentPresentation = await api.presentations.get(currentPresentation.id);
          closeModal();
          loadPreview();
          buildSlideNavigator();
          toastSuccess(t('studio.versionRestored'));
        } catch (err) {
          toastError(t('common.error') + ': ' + err.message);
        }
      }
    });
  };
}

async function showShare() {
  showModal(t('studio.shareTitle'), '<div class="loading-screen" style="height:200px"><div class="loading-orb"></div></div>');

  try {
    const [share] = await Promise.all([
      api.presentations.share(currentPresentation.id),
      api.shares.list(currentPresentation.id).catch(() => [])
    ]);

    const renderShareModal = async () => {
      const shares = await api.shares.list(currentPresentation.id).catch(() => []);
      closeModal();
      showModal(t('studio.shareTitle'), `
        <div style="display:flex;flex-direction:column;gap:20px">
          <!-- Public link -->
          <div>
            <div class="form-label" style="margin-bottom:8px">${t('studio.publicLinkLabel')}</div>
            <div class="qr-container" style="margin:0">
              <img src="${share.qrDataUrl}" alt="QR Code">
              <div>
                <div class="share-url">${share.shareUrl}</div>
                <div class="flex gap-8" style="margin-top:8px">
                  <button class="btn btn-accent btn-sm" onclick="navigator.clipboard.writeText('${share.shareUrl}').then(()=>window.showCopySuccess())">${t('studio.copyLink')}</button>
                  <button class="btn btn-ghost btn-sm" onclick="window.revokeShare()">${t('studio.revokeLink')}</button>
                </div>
              </div>
            </div>
            <div class="text-xs text-muted" style="margin-top:6px">${t('studio.publicLinkInfo', { views: currentPresentation.view_count || 0 })}</div>
          </div>

          <!-- User shares -->
          <div>
            <div class="form-label" style="margin-bottom:8px">${t('studio.userSharesLabel')}</div>
            <div id="user-shares-list" style="margin-bottom:10px">
              ${shares.length === 0
                ? `<p class="text-muted text-xs">${t('studio.noUserShares')}</p>`
                : shares.map(s => `
                  <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
                    <span style="flex:1;font-size:13px">${escHtml(s.name)} <span class="text-muted" style="font-size:11px">${escHtml(s.email)}</span></span>
                    <select class="form-select" style="width:100px;padding:4px 8px;font-size:12px" onchange="window.__updateShare('${s.user_id}',this.value)">
                      ${['read','write','delete'].map(perm => `<option value="${perm}" ${s.permission===perm?'selected':''}>${perm==='read'?t('common.read'):perm==='write'?t('common.write'):t('common.deletePermission')}</option>`).join('')}
                    </select>
                    <button class="btn btn-ghost btn-sm" style="color:var(--danger);padding:4px 8px" onclick="window.__removeShare('${s.user_id}')">✕</button>
                  </div>
                `).join('')}
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <input type="email" class="form-input" id="share-add-email" placeholder="${t('studio.shareAddPlaceholder')}" style="flex:1;font-size:13px">
              <select class="form-select" id="share-add-perm" style="width:110px;font-size:13px">
                <option value="read">${t('common.read')}</option>
                <option value="write">${t('common.write')}</option>
                <option value="delete">${t('common.deletePermission')}</option>
              </select>
              <button class="btn btn-primary btn-sm" id="share-add-btn" style="white-space:nowrap">${t('studio.shareAddBtn')}</button>
            </div>
            <div id="share-add-error" style="color:var(--danger);font-size:12px;margin-top:4px;display:none"></div>
          </div>
        </div>
      `, t('studio.shareSubtitlePublic'));

      window.showCopySuccess = () => toastSuccess(t('studio.shareLinkCopied'));
      window.revokeShare = async () => {
        await api.presentations.unshare(currentPresentation.id);
        closeModal();
        toastSuccess(t('studio.shareLinkRevoked'));
      };

      window.__updateShare = async (userId, permission) => {
        try {
          await api.shares.set(currentPresentation.id, userId, permission);
          toastSuccess(t('studio.sharePermUpdated'));
        } catch (err) { toastError(err.message); }
      };

      window.__removeShare = async (userId) => {
        try {
          await api.shares.remove(currentPresentation.id, userId);
          toastSuccess(t('studio.shareRemoved'));
          renderShareModal();
        } catch (err) { toastError(err.message); }
      };

      document.getElementById('share-add-btn')?.addEventListener('click', async () => {
        const email = document.getElementById('share-add-email').value.trim();
        const permission = document.getElementById('share-add-perm').value;
        const errEl = document.getElementById('share-add-error');
        errEl.style.display = 'none';
        if (!email) return;

        try {
          const users = await api.auth.users.list();
          const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
          if (!user) { errEl.textContent = t('studio.shareUserNotFound'); errEl.style.display = ''; return; }
          await api.shares.set(currentPresentation.id, user.id, permission);
          renderShareModal();
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = '';
        }
      });
    };

    renderShareModal();
  } catch (err) {
    closeModal();
    toastError(t('studio.shareError', { msg: err.message }));
  }
}

async function showTemplateChooser() {
  const templates = await api.templates.list();
  showModal(t('studio.templateTitle'), `
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
      <div class="template-card ${!currentPresentation.template_id ? 'selected' : ''}" data-tpl="" style="cursor:pointer">
        <div class="template-preview" style="background:#1a1a2e;height:80px;font-size:12px;color:rgba(255,255,255,0.5)">${t('common.slides')}</div>
        <div class="template-info"><div class="template-name">${t('studio.noTemplateName')}</div></div>
      </div>
      ${templates.map(tpl => `
        <div class="template-card ${currentPresentation.template_id === tpl.id ? 'selected' : ''}" data-tpl="${tpl.id}" style="cursor:pointer">
          <div class="template-preview" style="background:${getTemplateGradient(tpl.theme)};height:80px;font-size:12px;color:white;font-weight:600">${tpl.name}</div>
          <div class="template-info">
            <div class="template-name">${tpl.name}</div>
            <div class="template-desc">${tpl.description || ''}</div>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="flex gap-8" style="justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" onclick="document.getElementById('modal-close').click()">${t('common.cancel')}</button>
      <button class="btn btn-primary" id="apply-template-btn">${t('common.apply')}</button>
    </div>
  `);

  let selectedId = currentPresentation.template_id || '';
  document.querySelectorAll('[data-tpl]').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('[data-tpl]').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedId = card.dataset.tpl;
    });
  });

  document.getElementById('apply-template-btn').addEventListener('click', async () => {
    await api.presentations.update(currentPresentation.id, { template_id: selectedId || null });
    currentPresentation = await api.presentations.get(currentPresentation.id);
    closeModal();
    loadTemplateInfo();
    toastSuccess(t('studio.templateApplied'));
  });
}

// ─── Presenter mode ───────────────────────────────────────────────────────

function openPresenterMode() {
  if (!currentPresentation.html_content) return;

  const panel = document.getElementById('presenter-panel');
  panel.classList.remove('hidden');

  const iframe = document.getElementById('presenter-iframe');
  const blob = new Blob([currentPresentation.html_content], { type: 'text/html' });
  iframe.src = URL.createObjectURL(blob);

  // Start timer
  presenterSeconds = 0;
  clearInterval(presenterTimerInterval);
  presenterTimerInterval = setInterval(() => {
    presenterSeconds++;
    const m = Math.floor(presenterSeconds / 60).toString().padStart(2, '0');
    const s = (presenterSeconds % 60).toString().padStart(2, '0');
    const el = document.getElementById('presenter-timer');
    if (el) el.textContent = `${m}:${s}`;
  }, 1000);
}

window.closePresenter = () => {
  document.getElementById('presenter-panel').classList.add('hidden');
  clearInterval(presenterTimerInterval);
};

window.resetTimer = () => {
  presenterSeconds = 0;
  const el = document.getElementById('presenter-timer');
  if (el) el.textContent = '00:00';
};

window.presenterGoto = (dir) => {
  const iframe = document.getElementById('presenter-iframe');
  if (!iframe?.contentWindow) return;
  iframe.contentWindow.postMessage(
    { type: dir === 'next' ? 'nexus-next' : 'nexus-prev' },
    '*'
  );
};

// ─── Utilities ────────────────────────────────────────────────────────────

function getTemplateGradient(theme) {
  if (!theme) return 'linear-gradient(135deg,#1a1a2e,#2d1b69)';
  const p = theme.primaryColor || '#7c3aed';
  const a = theme.accentColor || '#06b6d4';
  return `linear-gradient(135deg,${p}40,${a}20)`;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(getCurrentLocale(), { day: '2-digit', month: 'short', year: 'numeric' });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
