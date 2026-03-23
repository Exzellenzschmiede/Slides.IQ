// ─── Templates View ───────────────────────────────────────────────────────

import { api } from '../api.js';
import { showModal, closeModal } from '../components/modal.js';
import { toastSuccess, toastError } from '../components/toast.js';

const STYLE_GRADIENTS = {
  cosmic: 'linear-gradient(135deg,#7c3aed30,#06b6d420)',
  minimal: 'linear-gradient(135deg,#f8fafc,#e2e8f0)',
  neon: 'linear-gradient(135deg,#00ff8820,#ff006620)',
  corporate: 'linear-gradient(135deg,#1e3a5f20,#f59e0b20)',
  gradient: 'linear-gradient(135deg,#f472b630,#a78bfa30)'
};

export async function renderTemplates(container) {
  const templates = await api.templates.list();

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Templates</h1>
        <p class="view-subtitle">Visuelle Stile und Systemprompts für Claude</p>
      </div>
      <button class="btn btn-primary" id="new-template-btn">+ Neues Template</button>
    </div>

    <div class="templates-grid">
      ${templates.map(renderTemplateCard).join('')}
    </div>

    <div class="divider" style="margin:32px 0"></div>

    <!-- Slide Library -->
    <div class="view-header">
      <div>
        <h2 style="font-size:18px;font-weight:700">Slide Library</h2>
        <p class="view-subtitle">Gespeicherte Einzelslides aus deinen Präsentationen</p>
      </div>
    </div>
    <div id="slide-library-grid" class="presentations-grid">
      <div class="loading-screen" style="height:100px"><div class="loading-orb" style="width:24px;height:24px"></div></div>
    </div>
  `;

  document.getElementById('new-template-btn').addEventListener('click', showCreateModal);

  document.querySelectorAll('.template-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showEditModal(templates.find(t => t.id === btn.dataset.id));
    });
  });

  document.querySelectorAll('.template-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Template löschen?')) return;
      try {
        await api.templates.delete(btn.dataset.id);
        toastSuccess('Template gelöscht');
        renderTemplates(container);
      } catch (err) { toastError(err.message); }
    });
  });

  // Load slide library
  loadSlideLibrary();
}

function renderTemplateCard(t) {
  const bg = STYLE_GRADIENTS[t.theme?.style] || STYLE_GRADIENTS.cosmic;
  const isDefault = t.id.startsWith('tpl-');

  return `
    <div class="template-card">
      <div class="template-preview" style="background:${bg}">
        <div style="text-align:center;padding:8px">
          <div style="font-size:16px;margin-bottom:4px">${getTemplateEmoji(t.theme?.style)}</div>
          <div style="font-size:12px;font-weight:600;color:var(--text)">${t.name}</div>
        </div>
      </div>
      <div class="template-info">
        <div class="template-name">${t.name}</div>
        <div class="template-desc">${t.description || ''}</div>
        <div class="flex gap-8 mt-8">
          <button class="btn btn-ghost btn-sm template-edit-btn" data-id="${t.id}">✎ Bearbeiten</button>
          ${!isDefault ? `<button class="btn btn-danger btn-sm template-delete-btn" data-id="${t.id}">✕</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

function getTemplateEmoji(style) {
  const map = { cosmic: '✦', minimal: '◻', neon: '⚡', corporate: '◈', gradient: '◎' };
  return map[style] || '✦';
}

async function loadSlideLibrary() {
  const grid = document.getElementById('slide-library-grid');
  try {
    const slides = await api.slideLibrary.list();
    if (!slides.length) {
      grid.innerHTML = `<div class="empty-state" style="padding:40px 0;grid-column:1/-1">
        <div class="empty-state-icon">◈</div>
        <div class="empty-state-title">Slide Library leer</div>
        <div class="empty-state-desc">Speichere einzelne Slides aus deinen Präsentationen im Studio</div>
      </div>`;
      return;
    }
    grid.innerHTML = slides.map(s => `
      <div class="card card-glow" style="display:flex;align-items:center;gap:12px">
        <div style="flex:1">
          <div style="font-size:14px;font-weight:600">${s.title}</div>
          <div class="text-xs text-muted">${new Date(s.created_at).toLocaleDateString('de')}</div>
        </div>
        <div class="flex gap-8">
          ${s.tags?.map(t => `<span class="tag">${t}</span>`).join('') || ''}
        </div>
      </div>
    `).join('');
  } catch {}
}

function showCreateModal() {
  showModal('Neues Template', buildTemplateForm(null), 'Definiere Stil und System-Prompt für Claude');
  bindTemplateForm(null);
}

function showEditModal(template) {
  showModal('Template bearbeiten', buildTemplateForm(template), 'Bearbeite das Template');
  bindTemplateForm(template);
}

function buildTemplateForm(t) {
  return `
    <div class="form-group">
      <label class="form-label">Name</label>
      <input type="text" class="form-input" id="tpl-name" value="${t?.name || ''}" placeholder="Mein Template">
    </div>
    <div class="form-group">
      <label class="form-label">Beschreibung</label>
      <input type="text" class="form-input" id="tpl-desc" value="${t?.description || ''}" placeholder="Kurze Beschreibung">
    </div>
    <div class="form-group">
      <label class="form-label">System Prompt für Claude</label>
      <textarea class="form-textarea" id="tpl-prompt" rows="6" placeholder="Beschreibe den visuellen Stil, die Farbpalette, die Animationen und das Design-Konzept...">${t?.system_prompt || ''}</textarea>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px" class="form-group">
      <div>
        <label class="form-label">Primärfarbe</label>
        <input type="color" class="form-input" id="tpl-primary" value="${t?.theme?.primaryColor || '#7c3aed'}" style="height:42px;cursor:pointer">
      </div>
      <div>
        <label class="form-label">Akzentfarbe</label>
        <input type="color" class="form-input" id="tpl-accent" value="${t?.theme?.accentColor || '#06b6d4'}" style="height:42px;cursor:pointer">
      </div>
    </div>
    <div class="flex gap-8" style="justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" onclick="document.getElementById('modal-close').click()">Abbrechen</button>
      <button class="btn btn-primary" id="save-template-btn">${t ? 'Speichern' : 'Erstellen'}</button>
    </div>
  `;
}

function bindTemplateForm(existing) {
  document.getElementById('save-template-btn').addEventListener('click', async () => {
    const data = {
      name: document.getElementById('tpl-name').value.trim(),
      description: document.getElementById('tpl-desc').value.trim(),
      system_prompt: document.getElementById('tpl-prompt').value.trim(),
      theme: {
        primaryColor: document.getElementById('tpl-primary').value,
        accentColor: document.getElementById('tpl-accent').value
      }
    };

    if (!data.name || !data.system_prompt) {
      toastError('Name und System Prompt sind Pflichtfelder');
      return;
    }

    try {
      if (existing) {
        await api.templates.update(existing.id, data);
      } else {
        await api.templates.create(data);
      }
      closeModal();
      toastSuccess(existing ? 'Template gespeichert!' : 'Template erstellt!');
      renderTemplates(document.getElementById('view-container'));
    } catch (err) {
      toastError(err.message);
    }
  });
}
