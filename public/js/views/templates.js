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
      <div class="flex gap-8">
        <button class="btn btn-ghost" id="import-pptx-btn">⬆ Aus PowerPoint</button>
        <button class="btn btn-primary" id="new-template-btn">+ Neues Template</button>
      </div>
    </div>
    <input type="file" id="pptx-file-input" accept=".pptx" style="display:none">

    <div class="templates-grid">
      ${templates.map(renderTemplateCard).join('')}
    </div>

  `;

  document.getElementById('new-template-btn').addEventListener('click', showCreateModal);

  const pptxInput = document.getElementById('pptx-file-input');
  document.getElementById('import-pptx-btn').addEventListener('click', () => pptxInput.click());
  pptxInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pptxInput.value = '';
    await handlePptxImport(file, container);
  });

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

// ─── PPTX Import ──────────────────────────────────────────────────────────

async function handlePptxImport(file, container) {
  // Show loading modal
  showModal(
    'PowerPoint analysieren',
    `<div style="text-align:center;padding:32px 0">
      <div class="loading-orb" style="width:40px;height:40px;margin:0 auto 16px"></div>
      <div style="color:var(--text-muted);font-size:14px">AI analysiert Stil und Farben…</div>
      <div style="color:var(--text-muted);font-size:12px;margin-top:8px;opacity:0.6">${file.name}</div>
    </div>`,
    'Template wird aus deiner Präsentation generiert'
  );

  let suggestion;
  try {
    suggestion = await api.templates.analyzeFromPptx(file);
  } catch (err) {
    closeModal();
    toastError('Analyse fehlgeschlagen: ' + err.message);
    return;
  }

  // Re-open modal with editable preview of the AI suggestion
  showModal(
    'Template aus PowerPoint',
    buildTemplateForm({
      name: suggestion.name,
      description: suggestion.description,
      system_prompt: suggestion.system_prompt,
      theme: suggestion.theme
    }),
    'Von AI generiert — du kannst alles anpassen bevor du speicherst'
  );

  document.getElementById('save-template-btn').textContent = 'Template speichern';
  document.getElementById('save-template-btn').addEventListener('click', async () => {
    const data = {
      name: document.getElementById('tpl-name').value.trim(),
      description: document.getElementById('tpl-desc').value.trim(),
      system_prompt: document.getElementById('tpl-prompt').value.trim(),
      theme: {
        primaryColor: document.getElementById('tpl-primary').value,
        accentColor:  document.getElementById('tpl-accent').value,
        style: suggestion.theme?.style || 'corporate'
      }
    };

    if (!data.name || !data.system_prompt) {
      toastError('Name und System Prompt sind Pflichtfelder');
      return;
    }

    try {
      await api.templates.create(data);
      closeModal();
      toastSuccess('Template aus PowerPoint erstellt!');
      renderTemplates(container);
    } catch (err) {
      toastError(err.message);
    }
  });
}
