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
    <button class="btn btn-ghost btn-sm" onclick="window.history.back()">← Zurück</button>
    <div>
      <h1 class="view-title" style="font-size:18px" id="studio-title">${escHtml(p.title)}</h1>
      <p class="view-subtitle" id="studio-meta">${p.slide_count || 0} Slides · zuletzt ${formatDate(p.updated_at)}</p>
    </div>
    <div class="flex gap-8" style="margin-left:auto;flex-wrap:wrap">
      ${p.html_content ? `
        <button class="btn btn-ghost btn-sm" id="btn-present">▶ Präsentieren</button>
        <button class="btn btn-ghost btn-sm" id="btn-presenter-mode">⊞ Presenter</button>
        <button class="btn btn-ghost btn-sm" id="btn-edit-slides">✏ Bearbeiten</button>
        <button class="btn btn-ghost btn-sm" id="btn-analyze">◎ Analyse</button>
      ` : ''}
      <button class="btn btn-ghost btn-sm" id="btn-versions">⏱ Versionen</button>
      <button class="btn btn-ghost btn-sm" id="btn-share">🔗 Teilen</button>
      <button class="btn btn-ghost btn-sm" id="btn-export-html">↓ HTML</button>
      ${p.html_content ? `<button class="btn btn-ghost btn-sm" id="btn-export-pdf">↓ PDF</button>` : ''}
    </div>
  </div>

  <div class="studio-layout">
    <!-- Left: AI Chat + Controls -->
    <div class="studio-sidebar">

      <!-- Template selector -->
      <div class="card" id="template-section">
        <div class="flex items-center justify-between mb-8">
          <span class="form-label" style="margin-bottom:0">Template</span>
          <button class="btn btn-ghost btn-sm" id="btn-change-template">Ändern</button>
        </div>
        <div id="active-template-name" class="text-sm text-muted">Wird geladen…</div>
      </div>

      <!-- Chat -->
      <div class="card" style="flex:1;display:flex;flex-direction:column;gap:12px">
        <div class="flex items-center justify-between">
          <span class="form-label" style="margin-bottom:0">✦ AI Studio</span>
          <span class="text-xs text-muted">Claude claude-opus-4-5</span>
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
            Claude generiert deine Präsentation…
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
          <div class="chat-input-wrapper">
            <textarea
              class="chat-input" id="chat-input"
              placeholder="Beschreibe deine Präsentation…&#10;Shift+Enter für Zeilenumbruch"
              rows="3"
            ></textarea>
            <button class="send-btn" id="send-btn" title="Senden (Enter)">→</button>
          </div>
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

    <!-- Right: Preview -->
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
        <div id="stream-overlay" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,0.8);display:none;align-items:center;justify-content:center;flex-direction:column;gap:16px;backdrop-filter:blur(4px)">
          <div class="loading-orb"></div>
          <div class="text-muted text-sm">Generiere Präsentation…</div>
          <div id="stream-chars" class="font-mono text-xs text-muted">0 Zeichen</div>
        </div>
      </div>
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
  loadPreview();
  bindEvents();
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

  // Listen for slide changes from iframe
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'nexus-slide') {
      document.getElementById('studio-meta').textContent =
        `${e.data.total} Slides · Slide ${e.data.index + 1} aktiv`;
    }
  });
}

function bindEvents() {
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');

  // Send on Enter (not Shift+Enter)
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
    openSlideEditor(currentPresentation, async (newHtml) => {
      currentPresentation = await api.presentations.get(currentPresentation.id);
      loadPreview();
      document.getElementById('studio-meta').textContent =
        `${currentPresentation.slide_count} Slides · gerade bearbeitet`;
    });
  });

  // Analyze
  document.getElementById('btn-analyze')?.addEventListener('click', showAnalysis);

  // Suggest
  document.getElementById('btn-suggest')?.addEventListener('click', loadSuggestions);

  // Versions
  document.getElementById('btn-versions')?.addEventListener('click', showVersions);

  // Share
  document.getElementById('btn-share')?.addEventListener('click', showShare);

  // Export HTML
  document.getElementById('btn-export-html')?.addEventListener('click', () => {
    api.presentations.exportHtml(currentPresentation.id, currentPresentation.title);
  });

  // Export PDF
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

  // Change template
  document.getElementById('btn-change-template')?.addEventListener('click', showTemplateChooser);

  // Close suggestions
  document.getElementById('close-suggestions')?.addEventListener('click', () => {
    document.getElementById('suggestions-panel').classList.add('hidden');
  });
}

async function sendMessage() {
  if (isGenerating) return;
  const input = document.getElementById('chat-input');
  const prompt = input?.value.trim();
  if (!prompt) return;

  isGenerating = true;
  input.value = '';
  input.disabled = true;
  document.getElementById('send-btn').disabled = true;

  // Add user message to chat
  addChatMessage('user', prompt);

  // Show generating indicator
  document.getElementById('generating-indicator').style.display = 'block';
  document.getElementById('quick-prompts').style.opacity = '0.4';

  // Show stream overlay
  const overlay = document.getElementById('stream-overlay');
  if (overlay) overlay.style.display = 'flex';

  let charCount = 0;
  let generatedHtml = '';

  try {
    for await (const event of api.ai.generate(currentPresentation.id, prompt)) {
      if (event.type === 'chunk') {
        charCount += event.text.length;
        generatedHtml += event.text;
        const charEl = document.getElementById('stream-chars');
        if (charEl) charEl.textContent = charCount.toLocaleString('de') + ' Zeichen';
      } else if (event.type === 'done') {
        currentPresentation.slide_count = event.slide_count;
      } else if (event.type === 'error') {
        throw new Error(event.message);
      }
    }

    // Update presentation
    currentPresentation = await api.presentations.get(currentPresentation.id);

    // Refresh preview
    const container = document.getElementById('preview-container');
    if (container) {
      container.innerHTML = `<iframe id="preview-iframe" sandbox="allow-scripts allow-same-origin"></iframe>`;
      loadPreview();

      // Show suggest button
      const suggestBtn = document.querySelector('.preview-actions');
      if (suggestBtn && !document.getElementById('btn-suggest')) {
        suggestBtn.innerHTML += `<button class="btn btn-ghost btn-sm" id="btn-suggest">◎ Verbesserungen</button>`;
        document.getElementById('btn-suggest')?.addEventListener('click', loadSuggestions);
      }
    }

    // Update meta
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
    input.disabled = false;
    document.getElementById('send-btn').disabled = false;
    document.getElementById('generating-indicator').style.display = 'none';
    document.getElementById('quick-prompts').style.opacity = '1';
    if (overlay) overlay.style.display = 'none';
    input.focus();
  }
}

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
  // Reload full view
  renderStudio(document.getElementById('view-container'), { id: currentPresentation.id });
}

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

function openPresenterMode() {
  if (!currentPresentation.html_content) return;

  const panel = document.getElementById('presenter-panel');
  panel.classList.remove('hidden');

  const iframe = document.getElementById('presenter-iframe');
  const blob = new Blob([currentPresentation.html_content], { type: 'text/html' });
  iframe.src = URL.createObjectURL(blob);

  // Listen for slide events
  window.addEventListener('message', onPresenterMessage);

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

function onPresenterMessage(e) {
  if (e.data?.type === 'nexus-slide') {
    const notesEl = document.getElementById('presenter-notes-content');
    const counterEl = document.getElementById('presenter-counter');
    if (notesEl) notesEl.textContent = e.data.notes || '—';
    if (counterEl) counterEl.textContent = `${e.data.index + 1} / ${e.data.total}`;
  }
}

window.closePresenter = () => {
  document.getElementById('presenter-panel').classList.add('hidden');
  clearInterval(presenterTimerInterval);
  window.removeEventListener('message', onPresenterMessage);
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
