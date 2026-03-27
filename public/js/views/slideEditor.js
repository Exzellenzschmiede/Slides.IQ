// ─── Slide WYSIWYG Editor ─────────────────────────────────────────────────

import { api } from '../api.js';
import { toastSuccess, toastError } from '../components/toast.js';

const state = {
  presentation: null,
  slides: [],        // [{outerHTML, notes}]
  styles: '',        // Extracted CSS from presentation
  currentIndex: 0,
  isDirty: false,
  onSave: null,
};

// ─── Public Entry Point ───────────────────────────────────────────────────

export function openSlideEditor(presentation, onSave) {
  state.presentation = presentation;
  state.onSave = onSave;
  state.isDirty = false;
  state.currentIndex = 0;

  parsePresentation(presentation.html_content);

  if (state.slides.length === 0) {
    toastError('Keine Folien gefunden.');
    return;
  }

  renderOverlay();
}

// ─── HTML Parsing ─────────────────────────────────────────────────────────

function parsePresentation(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Include ALL styles (incl. framework) so CSS variables and layout rules are available.
  // Editor-specific overrides in buildSlideDoc will correct the positioning rules.
  state.styles = Array.from(doc.querySelectorAll('style'))
    .map(s => s.textContent)
    .join('\n');

  // Extract slides
  state.slides = Array.from(
    doc.querySelectorAll('#nexus-presentation .slide')
  ).map(el => ({
    outerHTML: el.outerHTML,
    notes: el.getAttribute('data-notes') || '',
  }));
}

function getTitleFromSlide(outerHTML) {
  const doc = new DOMParser().parseFromString(outerHTML, 'text/html');
  for (const sel of ['h1', 'h2', 'h3', 'h4', '[class*="title"]', '[class*="heading"]', 'p']) {
    const el = doc.querySelector(sel);
    const text = el?.textContent?.replace(/\s+/g, ' ').trim();
    if (text && text.length >= 2) return text.slice(0, 60);
  }
  return '';
}

// ─── Overlay Rendering ────────────────────────────────────────────────────

function renderOverlay() {
  document.getElementById('slide-editor-overlay')?.remove();

  const total = state.slides.length;
  const el = document.createElement('div');
  el.id = 'slide-editor-overlay';
  el.innerHTML = `
    <div class="se-header">
      <div class="se-header-left">
        <button class="presenter-close" id="se-close">✕ Schließen</button>
        <span class="se-title">Folien bearbeiten</span>
        <span class="se-badge">${total} Folien</span>
      </div>

      <div class="se-toolbar" id="se-toolbar">
        <button class="se-tool" data-cmd="bold"         title="Fett (Ctrl+B)"><b>B</b></button>
        <button class="se-tool" data-cmd="italic"       title="Kursiv (Ctrl+I)"><i>I</i></button>
        <button class="se-tool" data-cmd="underline"    title="Unterstrichen (Ctrl+U)"><u>U</u></button>
        <button class="se-tool" data-cmd="strikeThrough" title="Durchgestrichen"><s>S</s></button>
        <div class="se-divider"></div>
        <button class="se-tool" data-cmd="formatBlock" data-val="h1" title="Überschrift 1">H1</button>
        <button class="se-tool" data-cmd="formatBlock" data-val="h2" title="Überschrift 2">H2</button>
        <button class="se-tool" data-cmd="formatBlock" data-val="h3" title="Überschrift 3">H3</button>
        <button class="se-tool" data-cmd="formatBlock" data-val="p"  title="Absatz">¶</button>
        <div class="se-divider"></div>
        <button class="se-tool" data-cmd="justifyLeft"   title="Linksbündig">⬅</button>
        <button class="se-tool" data-cmd="justifyCenter" title="Zentriert">⬌</button>
        <button class="se-tool" data-cmd="justifyRight"  title="Rechtsbündig">➡</button>
        <div class="se-divider"></div>
        <label class="se-tool se-color-wrap" title="Textfarbe">
          <span style="border-bottom:3px solid #fff;padding-bottom:1px">A</span>
          <input type="color" id="se-color" value="#ffffff">
        </label>
        <select class="se-select" id="se-fontsize" title="Schriftgröße">
          <option value="">Größe</option>
          <option value="1">Sehr klein</option>
          <option value="2">Klein</option>
          <option value="3">Normal</option>
          <option value="4">Mittel</option>
          <option value="5">Groß</option>
          <option value="6">Sehr groß</option>
          <option value="7">Riesig</option>
        </select>
      </div>

      <div class="se-header-right">
        <span class="se-dirty" id="se-dirty">● Ungespeichert</span>
        <button class="btn btn-primary btn-sm" id="se-save">Speichern</button>
      </div>
    </div>

    <div class="se-body">
      <div class="se-slide-list" id="se-slide-list"></div>

      <div class="se-editor-wrap">
        <div class="se-editor-area">
          <iframe id="se-iframe" sandbox="allow-same-origin allow-scripts" title="Folien-Editor"></iframe>
        </div>
        <div class="se-nav-bar">
          <button class="btn btn-ghost btn-sm" id="se-prev">← Vorherige</button>
          <span id="se-counter" class="text-sm text-muted">1 / ${total}</span>
          <button class="btn btn-ghost btn-sm" id="se-next">Nächste →</button>
        </div>
      </div>

      <div class="se-notes-panel">
        <div class="form-label" style="margin-bottom:8px">📝 Speaker Notes</div>
        <textarea id="se-notes" class="se-notes-input" placeholder="Notizen für diese Folie…"></textarea>
        <div class="text-xs text-muted" style="margin-top:8px">
          Notes werden beim Präsentieren angezeigt.
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(el);
  buildSlideList();
  bindEvents();
  loadSlide(0);

  // Scale iframe to fit editor area
  const area = el.querySelector('.se-editor-area');
  const ro = new ResizeObserver(() => scaleEditorIframe(area));
  ro.observe(area);
  scaleEditorIframe(area);
}

// ─── Slide List ───────────────────────────────────────────────────────────

function buildSlideList() {
  const list = document.getElementById('se-slide-list');
  if (!list) return;

  list.innerHTML = state.slides.map((slide, i) => {
    const title = getTitleFromSlide(slide.outerHTML) || `Folie ${i + 1}`;
    return `
      <div class="se-slide-item ${i === state.currentIndex ? 'active' : ''}" data-idx="${i}">
        <span class="se-slide-num">${i + 1}</span>
        <span class="se-slide-title">${esc(title)}</span>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.se-slide-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.idx, 10);
      if (idx !== state.currentIndex) {
        captureCurrentSlide();
        loadSlide(idx);
      }
    });
  });
}

function updateSlideListSelection() {
  document.querySelectorAll('.se-slide-item').forEach((el, i) => {
    el.classList.toggle('active', i === state.currentIndex);
  });
  document.querySelector('.se-slide-item.active')
    ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ─── Load Slide into Editor ───────────────────────────────────────────────

function loadSlide(index) {
  if (index < 0 || index >= state.slides.length) return;
  state.currentIndex = index;

  updateSlideListSelection();

  const counter = document.getElementById('se-counter');
  if (counter) counter.textContent = `${index + 1} / ${state.slides.length}`;

  const notesEl = document.getElementById('se-notes');
  if (notesEl) notesEl.value = state.slides[index].notes;

  const iframe = document.getElementById('se-iframe');
  if (!iframe) return;

  const html = buildSlideDoc(state.slides[index].outerHTML);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));

  // Revoke previous blob URL
  if (iframe._blobUrl) URL.revokeObjectURL(iframe._blobUrl);
  iframe._blobUrl = url;
  iframe.src = url;

  iframe.onload = () => {
    try {
      const slide = iframe.contentDocument?.querySelector('.slide');
      if (slide) slide.contentEditable = 'true';
      // Track edits inside the iframe
      iframe.contentDocument.addEventListener('input', markDirty);
    } catch (_) {}
  };
}

function buildSlideDoc(slideOuterHTML) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>${state.styles}</style>
<style>
  /* ── Editor overrides (after all presentation styles) ── */
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    width: 1280px; height: 720px;
    margin: 0; padding: 0; overflow: hidden;
  }
  /* Show slide at full size, undoing framework show/hide logic */
  .slide, #nexus-presentation .slide {
    position: absolute !important;
    inset: 0 !important;
    opacity: 1 !important;
    pointer-events: all !important;
    transform: none !important;
    display: flex !important;
    width: 1280px !important;
    height: 720px !important;
    overflow: hidden;
  }
  /* Hide framework chrome */
  #nexus-controls, #speaker-notes-panel, #overview-panel { display: none !important; }
  /* Editable hover indicator */
  [contenteditable="true"] *:hover {
    outline: 1px dashed rgba(124,58,237,0.45) !important;
    outline-offset: 2px; cursor: text;
  }
  [contenteditable="true"]:focus-within { outline: none !important; }
</style>
</head>
<body>
${slideOuterHTML}
</body>
</html>`;
}

// ─── Capture & Reconstruct ────────────────────────────────────────────────

function captureCurrentSlide() {
  const iframe = document.getElementById('se-iframe');
  if (!iframe?.contentDocument) return;

  try {
    const slide = iframe.contentDocument.querySelector('.slide');
    if (slide) {
      const clone = slide.cloneNode(true);
      clone.removeAttribute('contenteditable');
      // Clean up any leftover contenteditable attrs on children
      clone.querySelectorAll('[contenteditable]').forEach(el =>
        el.removeAttribute('contenteditable')
      );
      // Apply current notes from textarea
      const notes = document.getElementById('se-notes')?.value ?? '';
      if (notes) {
        clone.setAttribute('data-notes', notes);
      } else {
        clone.removeAttribute('data-notes');
      }
      state.slides[state.currentIndex].outerHTML = clone.outerHTML;
      state.slides[state.currentIndex].notes = notes;
    }
  } catch (_) {}
}

function reconstructHtml() {
  captureCurrentSlide();

  const doc = new DOMParser().parseFromString(
    state.presentation.html_content, 'text/html'
  );
  const slideEls = Array.from(doc.querySelectorAll('#nexus-presentation .slide'));

  state.slides.forEach((modSlide, i) => {
    if (!slideEls[i]) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = modSlide.outerHTML;
    const newSlide = tmp.firstElementChild;
    if (newSlide) slideEls[i].replaceWith(newSlide);
  });

  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

// ─── Save ─────────────────────────────────────────────────────────────────

async function saveChanges() {
  const saveBtn = document.getElementById('se-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Speichert…'; }

  try {
    const newHtml = reconstructHtml();
    await api.presentations.updateContent(state.presentation.id, {
      html_content: newHtml,
      save_version: true,
    });

    state.isDirty = false;
    const dirty = document.getElementById('se-dirty');
    if (dirty) dirty.style.display = 'none';

    toastSuccess('Folien gespeichert!');
    if (state.onSave) state.onSave(newHtml);
  } catch (err) {
    toastError('Speichern fehlgeschlagen: ' + err.message);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Speichern'; }
  }
}

// ─── Toolbar execCommand ──────────────────────────────────────────────────

function execCmd(cmd, value = null) {
  const doc = document.getElementById('se-iframe')?.contentDocument;
  if (!doc) return;
  doc.execCommand(cmd, false, value);
  document.getElementById('se-iframe')?.contentWindow?.focus();
}

// ─── Events ───────────────────────────────────────────────────────────────

function bindEvents() {
  // Close
  document.getElementById('se-close')?.addEventListener('click', () => {
    if (state.isDirty && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
    const iframe = document.getElementById('se-iframe');
    if (iframe?._blobUrl) URL.revokeObjectURL(iframe._blobUrl);
    document.getElementById('slide-editor-overlay')?.remove();
  });

  // Save
  document.getElementById('se-save')?.addEventListener('click', saveChanges);

  // Prev / Next
  document.getElementById('se-prev')?.addEventListener('click', () => {
    captureCurrentSlide();
    loadSlide(state.currentIndex - 1);
  });
  document.getElementById('se-next')?.addEventListener('click', () => {
    captureCurrentSlide();
    loadSlide(state.currentIndex + 1);
  });

  // Formatting toolbar
  document.querySelectorAll('.se-tool[data-cmd]').forEach(btn => {
    btn.addEventListener('click', () => execCmd(btn.dataset.cmd, btn.dataset.val ?? null));
  });

  // Color picker
  document.getElementById('se-color')?.addEventListener('input', e => {
    execCmd('foreColor', e.target.value);
  });

  // Font size
  document.getElementById('se-fontsize')?.addEventListener('change', e => {
    if (e.target.value) {
      execCmd('fontSize', e.target.value);
      e.target.value = ''; // Reset select
    }
  });

  // Notes textarea
  document.getElementById('se-notes')?.addEventListener('input', () => {
    state.slides[state.currentIndex].notes =
      document.getElementById('se-notes').value;
    markDirty();
  });

  // Keyboard shortcuts (Prev / Next arrows when focus is outside iframe)
  document.getElementById('slide-editor-overlay')?.addEventListener('keydown', e => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      captureCurrentSlide(); loadSlide(state.currentIndex + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      captureCurrentSlide(); loadSlide(state.currentIndex - 1);
    } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault(); saveChanges();
    }
  });
}

function markDirty() {
  state.isDirty = true;
  const dirty = document.getElementById('se-dirty');
  if (dirty) dirty.style.display = 'inline';
}

function scaleEditorIframe(area) {
  const iframe = document.getElementById('se-iframe');
  if (!area || !iframe) return;
  const pad = 20;
  const availW = area.clientWidth - pad * 2;
  const availH = area.clientHeight - pad * 2;
  const scale = Math.min(availW / 1280, availH / 720);
  const scaledW = 1280 * scale;
  const scaledH = 720 * scale;
  iframe.style.transform = `scale(${scale})`;
  iframe.style.left = `${(area.clientWidth - scaledW) / 2}px`;
  iframe.style.top = `${(area.clientHeight - scaledH) / 2}px`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
