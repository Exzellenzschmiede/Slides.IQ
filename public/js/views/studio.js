// ─── AI Studio View ───────────────────────────────────────────────────────

import { api } from '../api.js';
import { navigate } from '../router.js';
import { showModal, closeModal } from '../components/modal.js';
import { toastSuccess, toastError, toastInfo } from '../components/toast.js';
import { openSlideEditor } from './slideEditor.js';

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

const QUICK_PROMPTS = [
  'Mache die Präsentation visuell beeindruckender',
  'Füge eine Agenda-Slide am Anfang hinzu',
  'Verbessere die Typografie und Lesbarkeit',
  'Füge interaktive Animationen hinzu',
  'Optimiere für mobile Geräte',
  'Mache das Closing stärker und einprägsamer'
];

export async function renderStudio(container, { id }) {
  if (!id) { navigate('dashboard'); return; }

  // Reset state on each render
  currentSlideIndex = 0;
  slideScopedMode = false;
  slideScopedIndex = -1;
  messageListenerActive = false;

  try {
    currentPresentation = await api.presentations.get(id);
  } catch {
    navigate('dashboard'); return;
  }

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
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
    <button class="studio-back-btn" onclick="window.history.back()" title="Zurück zu Meine Slides">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <div>
      <h1 class="view-title" style="font-size:18px" id="studio-title">${escHtml(p.title)}</h1>
      <p class="view-subtitle" id="studio-meta">${p.slide_count || 0} Slides · zuletzt ${formatDate(p.updated_at)}</p>
    </div>
    <div class="flex gap-8" style="margin-left:auto">
      ${p.html_content ? `
      <div class="studio-dropdown">
        <button class="btn btn-ghost btn-sm studio-dropdown-trigger">▶ Präsentieren ▾</button>
        <div class="studio-dropdown-menu">
          <button class="studio-dropdown-item" id="btn-present">▶ Präsentieren</button>
          <button class="studio-dropdown-item" id="btn-presenter-mode">⊞ Presenter</button>
        </div>
      </div>
      ` : ''}
      <div class="studio-dropdown">
        <button class="btn btn-ghost btn-sm studio-dropdown-trigger">✏ Bearbeiten ▾</button>
        <div class="studio-dropdown-menu">
          ${p.html_content ? `
          <button class="studio-dropdown-item" id="btn-edit-slides">✏ Bearbeiten</button>
          <button class="studio-dropdown-item" id="btn-analyze">◎ Analyse</button>
          ` : ''}
          <button class="studio-dropdown-item" id="btn-versions">⏱ Versionen</button>
        </div>
      </div>
      <div class="studio-dropdown">
        <button class="btn btn-ghost btn-sm studio-dropdown-trigger">🔗 Teilen ▾</button>
        <div class="studio-dropdown-menu">
          <button class="studio-dropdown-item" id="btn-share">🔗 Teilen</button>
          <button class="studio-dropdown-item" id="btn-export-html">↓ HTML</button>
          ${p.html_content ? `<button class="studio-dropdown-item" id="btn-export-pdf">↓ PDF</button>` : ''}
        </div>
      </div>
    </div>
  </div>

  <div class="studio-layout">
    <!-- Left: AI Chat + Controls -->
    <div class="studio-sidebar">

      <!-- Chat -->
      <div class="card" style="flex:1;display:flex;flex-direction:column;gap:12px">
        <div class="flex items-center justify-between">
          <span class="form-label" style="margin-bottom:0">✦ AI Studio</span>
          <span class="text-xs text-muted" id="studio-model-label">Claude</span>
        </div>

        <div class="chat-messages" id="chat-messages">
          ${chatHistory || `<div class="chat-message assistant">
            Willkommen im AI Studio! Beschreibe deine Präsentation und ich erstelle sie für dich.
            <br><br>
            <strong>Beispiele:</strong><br>
            • "Erstelle eine 10-slide Pitch-Deck über ein nachhaltiges Startup"<br>
            • "Tech-Präsentation über Machine Learning für Einsteiger"<br>
            • "Keynote über die Zukunft der Arbeit, 8 Slides, dramatischer Stil"
          </div>`}
        </div>

        <div id="generating-indicator" style="display:none">
          <div class="generating-indicator">
            <div class="gen-dots"><span></span><span></span><span></span></div>
            <span id="generating-label">Claude generiert deine Präsentation…</span>
          </div>
        </div>

        <!-- Quick prompts -->
        <div style="display:flex;flex-wrap:wrap;gap:6px" id="quick-prompts">
          ${QUICK_PROMPTS.map(q => `
            <button class="btn btn-ghost btn-sm quick-prompt" data-prompt="${escHtml(q)}" style="font-size:11px;padding:4px 10px">
              ${q}
            </button>
          `).join('')}
        </div>

        <div class="chat-input-area">
          <!-- Slide mode banner -->
          <div class="slide-mode-banner" id="slide-mode-banner" style="display:none">
            <span class="slide-mode-label" id="slide-mode-label">Slide 1 bearbeiten</span>
            <button class="btn btn-ghost btn-sm" id="slide-mode-off" style="font-size:10px;padding:2px 6px">✕ Ganzes Deck</button>
          </div>
          <div id="attachment-chips" class="attachment-chips"></div>
          <div class="chat-input-wrapper">
            <button class="attach-btn" id="attach-btn" title="Datei anhängen (PDF, Word, Excel, PowerPoint, Bilder…)">📎</button>
            <textarea
              class="chat-input" id="chat-input"
              placeholder="Beschreibe deine Präsentation…&#10;Shift+Enter für Zeilenumbruch"
              rows="3"
            ></textarea>
            <button class="send-btn" id="send-btn" title="Senden (Enter)">→</button>
          </div>
          <input type="file" id="file-input" multiple
            accept=".pdf,.docx,.xlsx,.xls,.csv,.pptx,.txt,.md,.png,.jpg,.jpeg,.gif,.webp"
            style="display:none">
        </div>
      </div>

      <!-- AI Suggestions (hidden initially) -->
      <div class="card hidden" id="suggestions-panel">
        <div class="flex items-center justify-between mb-8">
          <span class="form-label" style="margin-bottom:0">◎ KI-Vorschläge</span>
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
              <div class="text-muted" style="font-size:14px">Noch kein Inhalt — starte mit einem Prompt</div>
            </div>`
        }
        <!-- Streaming overlay -->
        <div id="stream-overlay" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,0.8);align-items:center;justify-content:center;flex-direction:column;gap:16px;backdrop-filter:blur(4px)">
          <div class="loading-orb"></div>
          <div class="text-muted text-sm" id="stream-label">Generiere Präsentation…</div>
          <div id="stream-chars" class="font-mono text-xs text-muted">0 Zeichen</div>
        </div>
      </div>

      <!-- Slide Navigator -->
      ${p.html_content ? `
      <div class="slide-navigator" id="slide-navigator">
        <!-- Built dynamically by buildSlideNavigator() -->
      </div>
      ` : ''}

      <div class="preview-actions">
        <span class="text-xs text-muted">Vorschau</span>
        <div style="flex:1"></div>
        ${currentPresentation.html_content ? `
          <button class="btn btn-ghost btn-sm" id="btn-suggest">◎ Verbesserungen</button>
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
  if (currentPresentation.html_content) {
    buildSlideNavigator();
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
    const tpl = templates.find(t => t.id === currentPresentation.template_id);
    tplEl.textContent = tpl ? tpl.name : 'Benutzerdefiniert';
  } else {
    tplEl.textContent = 'Kein Template (Standard)';
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
      `${e.data.total} Slides · Slide ${e.data.index + 1} aktiv`;
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
  html += `<button class="insert-tile-btn" data-after="-1" title="Slide am Anfang einfügen">+</button>`;

  for (let i = 0; i < count; i++) {
    html += `
      <div class="slide-tile${i === currentSlideIndex ? ' active' : ''}" data-index="${i}">
        <span>${i + 1}</span>
        <div class="slide-tile-actions">
          <button class="tile-action-btn" data-tile-action="edit" data-index="${i}" title="Mit KI bearbeiten">✏</button>
          <button class="tile-action-btn" data-tile-action="dup" data-index="${i}" title="Duplizieren">⧉</button>
          <button class="tile-action-btn danger" data-tile-action="del" data-index="${i}" title="Löschen">🗑</button>
        </div>
      </div>
      <button class="insert-tile-btn" data-after="${i}" title="Slide danach einfügen">+</button>
    `;
  }

  nav.innerHTML = html;

  // Tile click → navigate iframe
  nav.querySelectorAll('.slide-tile').forEach(tile => {
    tile.addEventListener('click', (e) => {
      if (e.target.closest('.slide-tile-actions')) return; // ignore action clicks
      const idx = parseInt(tile.dataset.index);
      gotoIframeSlide(idx);
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
  if (label) label.textContent = `Slide ${index + 1} bearbeiten`;
  if (input) {
    input.placeholder = `Slide ${index + 1} mit KI bearbeiten…\nShift+Enter für Zeilenumbruch`;
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
  if (input) input.placeholder = 'Beschreibe deine Präsentation…\nShift+Enter für Zeilenumbruch';
}

async function duplicateSlide(index) {
  if (isGenerating) return;
  try {
    const result = await api.presentations.duplicateSlide(currentPresentation.id, index);
    currentPresentation.slide_count = result.slide_count;
    await refreshAfterSlideOp(result.slide_count, result.new_index ?? index + 1);
    toastSuccess(`Slide ${index + 1} dupliziert`);
  } catch (err) {
    toastError('Fehler: ' + err.message);
  }
}

async function deleteSlide(index) {
  if (isGenerating) return;
  if (!confirm(`Slide ${index + 1} wirklich löschen?`)) return;
  try {
    const result = await api.presentations.deleteSlide(currentPresentation.id, index);
    currentPresentation.slide_count = result.slide_count;
    const newIndex = Math.min(index, result.slide_count - 1);
    await refreshAfterSlideOp(result.slide_count, newIndex);
    toastSuccess(`Slide ${index + 1} gelöscht`);
  } catch (err) {
    toastError('Fehler: ' + err.message);
  }
}

async function refreshAfterSlideOp(slideCount, gotoIndex = 0) {
  currentPresentation = await api.presentations.get(currentPresentation.id);
  currentPresentation.slide_count = slideCount;
  currentSlideIndex = gotoIndex;

  // Rebuild preview
  const container = document.getElementById('preview-container');
  if (container) {
    container.innerHTML = `<iframe id="preview-iframe" sandbox="allow-scripts allow-same-origin"></iframe>
      <div id="stream-overlay" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,0.8);align-items:center;justify-content:center;flex-direction:column;gap:16px;backdrop-filter:blur(4px)">
        <div class="loading-orb"></div>
        <div class="text-muted text-sm" id="stream-label">Generiere…</div>
        <div id="stream-chars" class="font-mono text-xs text-muted">0 Zeichen</div>
      </div>`;
    loadPreview();
  }

  buildSlideNavigator();

  // Goto new index after iframe loads
  setTimeout(() => gotoIframeSlide(gotoIndex), 600);

  document.getElementById('studio-meta').textContent =
    `${slideCount} Slides · gerade bearbeitet`;
}

function showInsertSlideModal(afterIndex) {
  const posLabel = afterIndex < 0 ? 'am Anfang' : `nach Slide ${afterIndex + 1}`;
  showModal(`Neue Slide einfügen (${posLabel})`, `
    <div class="form-group">
      <label class="form-label">Was soll diese Slide zeigen?</label>
      <textarea class="form-input" id="insert-slide-prompt" rows="3"
        placeholder="z.B. Eine Folie über unsere Kernzielgruppe mit 3 Personas"
        style="resize:vertical;width:100%"></textarea>
    </div>
    <div class="flex gap-8" style="justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" id="insert-slide-cancel">Abbrechen</button>
      <button class="btn btn-primary" id="insert-slide-confirm">Generieren</button>
    </div>
  `, `Slide wird im Stil der Präsentation generiert`);

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

async function streamEditSlide(slideIndex, prompt) {
  if (isGenerating) return;
  isGenerating = true;

  setGeneratingUI(true, `Slide ${slideIndex + 1} wird bearbeitet…`);
  showStreamOverlay(`Slide ${slideIndex + 1} bearbeiten…`);

  addChatMessage('user', `[Slide ${slideIndex + 1}] ${prompt}`);

  try {
    let charCount = 0;
    for await (const event of api.ai.editSlide(currentPresentation.id, slideIndex, prompt)) {
      if (event.type === 'chunk') {
        charCount += event.text.length;
        const charEl = document.getElementById('stream-chars');
        if (charEl) charEl.textContent = charCount.toLocaleString('de') + ' Zeichen';
      } else if (event.type === 'done') {
        currentPresentation.slide_count = event.slide_count;
      } else if (event.type === 'error') {
        throw new Error(event.message);
      }
    }

    await refreshAfterSlideOp(currentPresentation.slide_count, slideIndex);
    addChatMessage('assistant', `✓ Slide ${slideIndex + 1} aktualisiert`);
    toastSuccess(`Slide ${slideIndex + 1} aktualisiert!`);
  } catch (err) {
    addChatMessage('assistant', '✕ Fehler: ' + err.message);
    toastError(err.message);
  } finally {
    isGenerating = false;
    setGeneratingUI(false);
    hideStreamOverlay();
  }
}

async function streamInsertSlide(afterIndex, prompt) {
  if (isGenerating) return;
  isGenerating = true;

  const posLabel = afterIndex < 0 ? 'am Anfang' : `nach Slide ${afterIndex + 1}`;
  setGeneratingUI(true, `Neue Slide wird generiert (${posLabel})…`);
  showStreamOverlay(`Neue Slide generieren…`);

  addChatMessage('user', `[Neue Slide ${posLabel}] ${prompt}`);

  try {
    let charCount = 0;
    for await (const event of api.ai.insertSlide(currentPresentation.id, afterIndex, prompt)) {
      if (event.type === 'chunk') {
        charCount += event.text.length;
        const charEl = document.getElementById('stream-chars');
        if (charEl) charEl.textContent = charCount.toLocaleString('de') + ' Zeichen';
      } else if (event.type === 'done') {
        currentPresentation.slide_count = event.slide_count;
        const newIndex = event.new_index ?? afterIndex + 1;
        await refreshAfterSlideOp(currentPresentation.slide_count, newIndex);
        addChatMessage('assistant', `✓ Neue Slide ${newIndex + 1} eingefügt (${currentPresentation.slide_count} Slides gesamt)`);
        toastSuccess('Neue Slide eingefügt!');
      } else if (event.type === 'error') {
        throw new Error(event.message);
      }
    }
  } catch (err) {
    addChatMessage('assistant', '✕ Fehler: ' + err.message);
    toastError(err.message);
  } finally {
    isGenerating = false;
    setGeneratingUI(false);
    hideStreamOverlay();
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────

function setGeneratingUI(active, label = 'Claude generiert…') {
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

function showStreamOverlay(label = 'Generiere…') {
  const overlay = document.getElementById('stream-overlay');
  const labelEl = document.getElementById('stream-label');
  const charEl = document.getElementById('stream-chars');
  if (overlay) overlay.style.display = 'flex';
  if (labelEl) labelEl.textContent = label;
  if (charEl) charEl.textContent = '0 Zeichen';
}

function hideStreamOverlay() {
  const overlay = document.getElementById('stream-overlay');
  if (overlay) overlay.style.display = 'none';
}

// ─── Main send (routes to full generation or slide-scoped edit) ───────────

async function sendMessage() {
  if (isGenerating) return;
  const input = document.getElementById('chat-input');
  const prompt = input?.value.trim();
  if (!prompt) return;

  // Route to slide-scoped edit if mode is active
  if (slideScopedMode && slideScopedIndex >= 0) {
    input.value = '';
    await streamEditSlide(slideScopedIndex, prompt);
    return;
  }

  const attachments = [...pendingAttachments];
  clearAttachments();

  isGenerating = true;
  input.value = '';
  setGeneratingUI(true, 'Claude generiert deine Präsentation…');

  // Add user message to chat
  const attachmentLabel = attachments.length
    ? `\n📎 ${attachments.map(a => a.name).join(', ')}`
    : '';
  addChatMessage('user', prompt + attachmentLabel);

  showStreamOverlay('Generiere Präsentation…');

  let charCount = 0;

  try {
    for await (const event of api.ai.generate(currentPresentation.id, prompt, attachments)) {
      if (event.type === 'chunk') {
        charCount += event.text.length;
        const charEl = document.getElementById('stream-chars');
        if (charEl) charEl.textContent = charCount.toLocaleString('de') + ' Zeichen';
      } else if (event.type === 'done') {
        currentPresentation.slide_count = event.slide_count;
      } else if (event.type === 'warning') {
        toastError(event.message);
      } else if (event.type === 'error') {
        throw new Error(event.message);
      }
    }

    // Update presentation
    currentPresentation = await api.presentations.get(currentPresentation.id);

    // Rebuild preview and navigator
    const container = document.getElementById('preview-container');
    if (container) {
      container.innerHTML = `<iframe id="preview-iframe" sandbox="allow-scripts allow-same-origin"></iframe>
        <div id="stream-overlay" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,0.8);align-items:center;justify-content:center;flex-direction:column;gap:16px;backdrop-filter:blur(4px)">
          <div class="loading-orb"></div>
          <div class="text-muted text-sm" id="stream-label">Generiere…</div>
          <div id="stream-chars" class="font-mono text-xs text-muted">0 Zeichen</div>
        </div>`;
      loadPreview();

      // Show suggest button if not present
      const previewActions = document.querySelector('.preview-actions');
      if (previewActions && !document.getElementById('btn-suggest')) {
        previewActions.innerHTML += `<button class="btn btn-ghost btn-sm" id="btn-suggest">◎ Verbesserungen</button>`;
        document.getElementById('btn-suggest')?.addEventListener('click', loadSuggestions);
      }
    }

    // Add navigator if not present
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
      `${currentPresentation.slide_count} Slides · gerade aktualisiert`;

    addChatMessage('assistant', `✓ Präsentation erstellt mit ${currentPresentation.slide_count} Slides`);
    toastSuccess('Präsentation generiert!');

    // Show present button if not visible
    if (!document.getElementById('btn-present')) {
      refreshStudioHeader();
    }

  } catch (err) {
    addChatMessage('assistant', '✕ Fehler: ' + err.message);
    toastError(err.message);
  } finally {
    isGenerating = false;
    setGeneratingUI(false);
    hideStreamOverlay();
    input?.focus();
  }
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
  document.addEventListener('click', () => {
    document.querySelectorAll('.studio-dropdown.open').forEach(d => d.classList.remove('open'));
  }, { capture: true });

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
        `${currentPresentation.slide_count} Slides · gerade bearbeitet`;
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
      toastInfo('PDF wird erstellt…');
      const blob = await api.presentations.exportPdf(currentPresentation.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${currentPresentation.title}.pdf`; a.click();
      toastSuccess('PDF exportiert!');
    } catch (err) {
      toastError('PDF-Fehler: ' + err.message);
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
    toastError(`Upload fehlgeschlagen: ${err.message}`);
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
    <button class="chip-remove" data-chip="${id}" title="Entfernen">✕</button>
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
  showModal('Narrative Arc Analyse', '<div class="loading-screen" style="height:200px"><div class="loading-orb"></div></div>');
  try {
    const analysis = await api.ai.analyze(currentPresentation.id);
    const scoreVal = analysis.score || 0;
    closeModal();
    showModal('Narrative Arc Analyse', `
      <div class="analysis-score">
        <div class="score-circle" style="--score:${scoreVal}">
          <span>${scoreVal}/10</span>
        </div>
        <div>
          <div style="font-weight:600;margin-bottom:4px">${analysis.summary || ''}</div>
          <div class="text-sm text-muted">Narrative Flow: ${analysis.narrativeFlow || '—'}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <div class="form-label">Stärken</div>
          ${(analysis.strengths || []).map(s => `<div class="text-sm" style="padding:4px 0;border-bottom:1px solid var(--border)">✓ ${s}</div>`).join('') || '<div class="text-muted text-sm">—</div>'}
        </div>
        <div>
          <div class="form-label">Verbesserungen</div>
          ${(analysis.improvements || []).map(s => `<div class="text-sm" style="padding:4px 0;border-bottom:1px solid var(--border)">→ ${s}</div>`).join('') || '<div class="text-muted text-sm">—</div>'}
        </div>
      </div>
    `, 'KI-Analyse deiner Präsentationsstruktur');
  } catch (err) {
    closeModal();
    toastError('Analyse fehlgeschlagen: ' + err.message);
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
        <div style="font-size:13px;font-weight:600;margin-bottom:4px">${s.title || `Vorschlag ${i+1}`}</div>
        <div class="text-sm text-muted">${s.description || ''}</div>
        <div class="text-xs" style="margin-top:8px;color:var(--primary)">→ Klicken zum Anwenden</div>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<div class="text-muted text-sm">Fehler: ${err.message}</div>`;
  }
}

// ─── Versions / Share / Template ─────────────────────────────────────────

async function showVersions() {
  const p = await api.presentations.get(currentPresentation.id);
  const versions = p.versions || [];

  showModal('Versionshistorie', `
    <div class="versions-list">
      ${versions.length === 0
        ? '<div class="empty-state" style="padding:40px 0"><div class="empty-state-icon">⏱</div><div class="text-muted">Noch keine Versionen. Versionen werden automatisch bei jeder Generierung gespeichert.</div></div>'
        : versions.map(v => `
          <div class="version-item">
            <div class="version-label">${v.label || 'Version'}</div>
            <div class="version-date">${formatDate(v.timestamp)}</div>
            <button class="btn btn-ghost btn-sm" onclick="restoreVersion('${v.id}')">Wiederherstellen</button>
          </div>
        `).join('')
      }
    </div>
  `, `${versions.length} gespeicherte Versionen`);

  window.restoreVersion = async (versionId) => {
    if (!confirm('Version wiederherstellen? Die aktuelle Version wird als neue Version gespeichert.')) return;
    try {
      await api.presentations.restoreVersion(currentPresentation.id, versionId);
      currentPresentation = await api.presentations.get(currentPresentation.id);
      closeModal();
      loadPreview();
      buildSlideNavigator();
      toastSuccess('Version wiederhergestellt!');
    } catch (err) {
      toastError('Fehler: ' + err.message);
    }
  };
}

async function showShare() {
  showModal('Präsentation teilen', '<div class="loading-screen" style="height:200px"><div class="loading-orb"></div></div>');

  try {
    const share = await api.presentations.share(currentPresentation.id);
    closeModal();
    showModal('Präsentation teilen', `
      <div class="qr-container">
        <img src="${share.qrDataUrl}" alt="QR Code">
        <div>
          <div class="form-label">Öffentlicher Link</div>
          <div class="share-url">${share.shareUrl}</div>
        </div>
        <div class="flex gap-8">
          <button class="btn btn-accent" onclick="navigator.clipboard.writeText('${share.shareUrl}').then(()=>window.showCopySuccess())">
            Kopieren
          </button>
          <button class="btn btn-ghost" onclick="window.revokeShare()">Link entfernen</button>
        </div>
        <div class="text-xs text-muted text-center">
          Personen mit diesem Link können deine Präsentation anzeigen.<br>
          Views werden getrackt (aktuell: ${currentPresentation.view_count || 0} Views).
        </div>
      </div>
    `, 'Live Audience Mode — QR-Code scannen zum Folgen');

    window.showCopySuccess = () => toastSuccess('Link kopiert!');
    window.revokeShare = async () => {
      await api.presentations.unshare(currentPresentation.id);
      closeModal();
      toastSuccess('Link entfernt');
    };
  } catch (err) {
    closeModal();
    toastError('Fehler: ' + err.message);
  }
}

async function showTemplateChooser() {
  const templates = await api.templates.list();
  showModal('Template ändern', `
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
      <div class="template-card ${!currentPresentation.template_id ? 'selected' : ''}" data-tpl="" style="cursor:pointer">
        <div class="template-preview" style="background:#1a1a2e;height:80px;font-size:12px;color:rgba(255,255,255,0.5)">Standard</div>
        <div class="template-info"><div class="template-name">Kein Template</div></div>
      </div>
      ${templates.map(t => `
        <div class="template-card ${currentPresentation.template_id === t.id ? 'selected' : ''}" data-tpl="${t.id}" style="cursor:pointer">
          <div class="template-preview" style="background:${getTemplateGradient(t.theme)};height:80px;font-size:12px;color:white;font-weight:600">${t.name}</div>
          <div class="template-info">
            <div class="template-name">${t.name}</div>
            <div class="template-desc">${t.description || ''}</div>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="flex gap-8" style="justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" onclick="document.getElementById('modal-close').click()">Abbrechen</button>
      <button class="btn btn-primary" id="apply-template-btn">Anwenden</button>
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
    toastSuccess('Template angewendet!');
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
  return new Date(iso).toLocaleDateString('de', { day: '2-digit', month: 'short', year: 'numeric' });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
