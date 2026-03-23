// ─── Dashboard View ───────────────────────────────────────────────────────

import { api } from '../api.js';
import { navigate } from '../router.js';
import { showModal, closeModal } from '../components/modal.js';
import { toastSuccess, toastError } from '../components/toast.js';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('de', { day: '2-digit', month: 'short', year: 'numeric' });
}

function renderCard(p) {
  const hasContent = !!p.html_content;
  const tags = (p.tags || []).map(t => `<span class="tag">${t}</span>`).join('');

  return `
    <div class="presentation-card card-glow" data-id="${p.id}">
      <div class="presentation-card-preview" onclick="window.nexusOpenStudio('${p.id}')">
        ${hasContent
          ? `<iframe src="/api/presentations/${p.id}/content-preview" sandbox="allow-scripts allow-same-origin" loading="lazy"></iframe>`
          : `<div class="presentation-card-preview-placeholder">◈</div>`
        }
        ${p.slide_count > 0 ? `<div class="slide-count-badge">⊡ ${p.slide_count} Slides</div>` : ''}
        ${p.share_token ? '<div class="slide-count-badge" style="bottom:8px;left:8px;right:auto">🔗 Geteilt</div>' : ''}
      </div>
      <div class="presentation-card-body">
        <div class="presentation-card-title" title="${p.title}">${p.title}</div>
        <div class="presentation-card-meta">${formatDate(p.updated_at)} ${tags ? '· ' + tags : ''}</div>
        ${p.description ? `<div class="text-sm text-muted mb-8">${p.description}</div>` : ''}
        <div class="presentation-card-actions">
          <button class="btn btn-primary btn-sm" onclick="window.nexusOpenStudio('${p.id}')">
            ✦ Studio
          </button>
          ${hasContent ? `
            <button class="btn btn-ghost btn-sm" onclick="window.nexusPresent('${p.id}')">▶ Präsent.</button>
            <button class="btn btn-ghost btn-sm" onclick="window.nexusExportPdf('${p.id}', '${p.title}')">↓ PDF</button>
          ` : ''}
          <button class="btn btn-ghost btn-sm" onclick="window.nexusDeletePresentation('${p.id}')" style="margin-left:auto">✕</button>
        </div>
      </div>
    </div>
  `;
}

export async function renderDashboard(container) {
  const [presentations, templates] = await Promise.all([
    api.presentations.list(),
    api.templates.list()
  ]);

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Dashboard</h1>
        <p class="view-subtitle">${presentations.length} Präsentation${presentations.length !== 1 ? 'en' : ''}</p>
      </div>
      <div class="flex gap-8">
        <input type="search" id="search-input" class="form-input" placeholder="Suchen…" style="width:220px">
        <button class="btn btn-primary" id="new-btn">✦ Neu erstellen</button>
      </div>
    </div>

    <div class="presentations-grid" id="presentations-grid">
      <div class="new-presentation-card" id="new-card">
        <div class="new-card-icon">+</div>
        <div style="font-size:14px;font-weight:500">Neue Präsentation</div>
        <div class="text-sm text-muted">Starte mit einem Prompt</div>
      </div>
      ${presentations.map(renderCard).join('')}
    </div>

    ${presentations.length === 0 ? `
      <div class="empty-state" style="margin-top:40px">
        <div class="empty-state-icon">✦</div>
        <div class="empty-state-title">Noch keine Präsentationen</div>
        <div class="empty-state-desc">Erstelle deine erste Präsentation mit einem KI-Prompt im AI Studio</div>
        <button class="btn btn-primary mt-16" id="first-btn">✦ Erste Präsentation erstellen</button>
      </div>
    ` : ''}
  `;

  // Search
  document.getElementById('search-input')?.addEventListener('input', async (e) => {
    const filtered = presentations.filter(p =>
      p.title.toLowerCase().includes(e.target.value.toLowerCase()) ||
      (p.description || '').toLowerCase().includes(e.target.value.toLowerCase())
    );
    const grid = document.getElementById('presentations-grid');
    const newCard = document.getElementById('new-card')?.outerHTML || '';
    grid.innerHTML = newCard + filtered.map(renderCard).join('');
    bindGridActions();
  });

  document.getElementById('new-btn')?.addEventListener('click', () => showNewModal(templates));
  document.getElementById('new-card')?.addEventListener('click', () => showNewModal(templates));
  document.getElementById('first-btn')?.addEventListener('click', () => showNewModal(templates));

  bindGridActions();
}

function bindGridActions() {
  // Content preview iframes
  document.querySelectorAll('.presentation-card-preview iframe').forEach(iframe => {
    const id = iframe.closest('.presentation-card').dataset.id;
    // Use the main presentation HTML but scaled
    fetch(`/api/presentations/${id}`)
      .then(r => r.json())
      .then(p => {
        if (p.html_content) {
          const blob = new Blob([p.html_content], { type: 'text/html' });
          iframe.src = URL.createObjectURL(blob);
        }
      })
      .catch(() => {});
  });
}

function showNewModal(templates) {
  const templateOptions = templates.map(t => `
    <div class="template-card" data-tpl-id="${t.id}" style="cursor:pointer;margin-bottom:0">
      <div class="template-preview" style="background:${getTemplateGradient(t.theme)};height:80px;font-size:11px;color:white;font-weight:600">
        ${t.name}
      </div>
    </div>
  `).join('');

  showModal('Neue Präsentation', `
    <div class="form-group">
      <label class="form-label">Titel</label>
      <input type="text" class="form-input" id="new-title" placeholder="Meine Präsentation" autofocus>
    </div>
    <div class="form-group">
      <label class="form-label">Beschreibung (optional)</label>
      <input type="text" class="form-input" id="new-desc" placeholder="Worum geht es?">
    </div>
    <div class="form-group">
      <label class="form-label">Template (optional)</label>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px" id="tpl-picker">
        <div class="template-card" data-tpl-id="" style="cursor:pointer;margin-bottom:0">
          <div class="template-preview" style="background:#1a1a2e;height:80px;font-size:11px;color:rgba(255,255,255,0.5);font-weight:600">
            Kein Template
          </div>
        </div>
        ${templateOptions}
      </div>
    </div>
    <div class="flex gap-8" style="justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" onclick="document.getElementById('modal-close').click()">Abbrechen</button>
      <button class="btn btn-primary" id="create-btn">Erstellen & Studio öffnen →</button>
    </div>
  `, 'Wähle einen Template-Stil als Startpunkt');

  // Template selection
  let selectedTemplateId = '';
  document.querySelectorAll('#tpl-picker .template-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('#tpl-picker .template-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedTemplateId = card.dataset.tplId;
    });
  });

  document.getElementById('create-btn').addEventListener('click', async () => {
    const title = document.getElementById('new-title').value.trim();
    if (!title) { document.getElementById('new-title').focus(); return; }

    try {
      const p = await api.presentations.create({
        title,
        description: document.getElementById('new-desc').value.trim(),
        template_id: selectedTemplateId || null
      });
      closeModal();
      navigate('studio', { id: p.id });
    } catch (err) {
      toastError('Fehler: ' + err.message);
    }
  });
}

function getTemplateGradient(theme) {
  if (!theme) return 'linear-gradient(135deg,#1a1a2e,#2d1b69)';
  const p = theme.primaryColor || '#7c3aed';
  const a = theme.accentColor || '#06b6d4';
  return `linear-gradient(135deg, ${p}40, ${a}20)`;
}

// Global handlers (called from card HTML)
window.nexusOpenStudio = (id) => navigate('studio', { id });

window.nexusPresent = (id) => {
  api.presentations.get(id).then(p => {
    if (!p.html_content) return toastError('Noch kein Inhalt generiert');
    const blob = new Blob([p.html_content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'fullscreen=yes');
  });
};

window.nexusExportPdf = async (id, title) => {
  try {
    toastInfo('PDF wird erstellt…');
    const blob = await api.presentations.exportPdf(id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${title}.pdf`; a.click();
    URL.revokeObjectURL(url);
    toastSuccess('PDF exportiert!');
  } catch (err) {
    toastError('PDF-Fehler: ' + err.message);
  }
};

window.nexusDeletePresentation = async (id) => {
  if (!confirm('Präsentation wirklich löschen?')) return;
  try {
    await api.presentations.delete(id);
    toastSuccess('Gelöscht');
    navigate('dashboard');
    renderDashboard(document.getElementById('view-container'));
  } catch (err) {
    toastError('Fehler: ' + err.message);
  }
};
