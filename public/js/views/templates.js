// ─── Templates View ───────────────────────────────────────────────────────

import { api } from '../api.js';
import { showModal, closeModal } from '../components/modal.js';
import { toastSuccess, toastError } from '../components/toast.js';
import { t } from '../i18n.js';

const STYLE_GRADIENTS = {
  cosmic:    'linear-gradient(135deg,#7c3aed30,#06b6d420)',
  minimal:   'linear-gradient(135deg,#f8fafc,#e2e8f0)',
  neon:      'linear-gradient(135deg,#00ff8820,#ff006620)',
  corporate: 'linear-gradient(135deg,#1e3a5f20,#f59e0b20)',
  gradient:  'linear-gradient(135deg,#f472b630,#a78bfa30)'
};

export async function renderTemplates(container) {
  const templates = await api.templates.list();

  const system = templates.filter(tpl => tpl.scope === 'system');
  const own    = templates.filter(tpl => tpl.scope === 'own');
  const shared = templates.filter(tpl => tpl.scope === 'shared');

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">${t('templates.title')}</h1>
        <p class="view-subtitle">${t('templates.subtitle')}</p>
      </div>
      <div class="flex gap-8">
        <button class="btn btn-ghost" id="import-pptx-btn">${t('templates.importPptx')}</button>
        <button class="btn btn-primary" id="new-template-btn">${t('templates.newBtn')}</button>
      </div>
    </div>
    <input type="file" id="pptx-file-input" accept=".pptx" style="display:none">

    ${renderSection(t('templates.sectionSystem'), system)}
    ${own.length    ? renderSection(t('templates.sectionOwn'), own) : ''}
    ${shared.length ? renderSection(t('templates.sectionShared'), shared) : ''}
  `;

  document.getElementById('new-template-btn').addEventListener('click', () => showCreateModal(container));

  const pptxInput = document.getElementById('pptx-file-input');
  document.getElementById('import-pptx-btn').addEventListener('click', () => pptxInput.click());
  pptxInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pptxInput.value = '';
    await handlePptxImport(file, container);
  });

  container.querySelectorAll('.template-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showEditModal(templates.find(tpl => tpl.id === btn.dataset.id), container);
    });
  });

  container.querySelectorAll('.template-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(t('templates.confirmDelete'))) return;
      try {
        await api.templates.delete(btn.dataset.id);
        toastSuccess(t('templates.deleted'));
        renderTemplates(container);
      } catch (err) { toastError(err.message); }
    });
  });

  container.querySelectorAll('.template-share-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const currentlyShared = btn.dataset.shared === 'true';
      try {
        await api.templates.share(btn.dataset.id, !currentlyShared);
        toastSuccess(currentlyShared ? t('templates.nowPrivate') : t('templates.nowShared'));
        renderTemplates(container);
      } catch (err) { toastError(err.message); }
    });
  });
}

function renderSection(title, templates) {
  if (!templates.length) return '';
  return `
    <div style="margin-bottom: 32px">
      <h2 style="font-size:13px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:16px">${title}</h2>
      <div class="templates-grid">
        ${templates.map(tpl => renderTemplateCard(tpl)).join('')}
      </div>
    </div>
  `;
}

function renderTemplateCard(tpl) {
  const bg = STYLE_GRADIENTS[tpl.theme?.style] || STYLE_GRADIENTS.cosmic;
  const isSystem = tpl.scope === 'system';
  const isOwn    = tpl.scope === 'own';
  const isAdmin  = window.__currentUser?.role === 'admin';
  const canEdit  = isOwn || (isSystem && isAdmin);
  const canDelete = isOwn || (!isSystem && isAdmin);

  return `
    <div class="template-card">
      <div class="template-preview" style="background:${bg}">
        <div style="text-align:center;padding:8px">
          <div style="font-size:16px;margin-bottom:4px">${getTemplateEmoji(tpl.theme?.style)}</div>
          <div style="font-size:12px;font-weight:600;color:var(--text)">${escHtml(tpl.name)}</div>
        </div>
      </div>
      <div class="template-info">
        <div class="template-name">${escHtml(tpl.name)}</div>
        <div class="template-desc">${escHtml(tpl.description || '')}</div>
        <div class="flex gap-8 mt-8" style="align-items:center;flex-wrap:wrap">
          ${isSystem ? `<span class="tag" style="font-size:10px">${t('templates.tagDefault')}</span>` : ''}
          ${tpl.is_public && !isSystem ? `<span class="tag" style="font-size:10px;background:rgba(6,182,212,.15);color:#06b6d4">${t('templates.tagShared')}</span>` : ''}
          ${canEdit   ? `<button class="btn btn-ghost btn-sm template-edit-btn" data-id="${tpl.id}">${t('templates.editBtn')}</button>` : ''}
          ${isOwn     ? `<button class="btn btn-ghost btn-sm template-share-btn" data-id="${tpl.id}" data-shared="${tpl.is_public}" style="font-size:11px">${tpl.is_public ? t('templates.unshareBtn') : t('templates.shareBtn')}</button>` : ''}
          ${canDelete ? `<button class="btn btn-danger btn-sm template-delete-btn" data-id="${tpl.id}">✕</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

function getTemplateEmoji(style) {
  const map = { cosmic: '✦', minimal: '◻', neon: '⚡', corporate: '◈', gradient: '◎' };
  return map[style] || '✦';
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showCreateModal(container) {
  showModal(t('templates.createTitle'), buildTemplateForm(null), t('templates.createSubtitle'));
  bindTemplateForm(null, container);
}

function showEditModal(template, container) {
  showModal(t('templates.editTitle'), buildTemplateForm(template), t('templates.editSubtitle'));
  bindTemplateForm(template, container);
}

function buildTemplateForm(tpl) {
  return `
    <div class="form-group">
      <label class="form-label">${t('templates.nameLabel')}</label>
      <input type="text" class="form-input" id="tpl-name" value="${escHtml(tpl?.name || '')}" placeholder="${t('templates.namePlaceholder')}">
    </div>
    <div class="form-group">
      <label class="form-label">${t('templates.descLabel')}</label>
      <input type="text" class="form-input" id="tpl-desc" value="${escHtml(tpl?.description || '')}" placeholder="${t('templates.descPlaceholder')}">
    </div>
    <div class="form-group">
      <label class="form-label">${t('templates.promptLabel')}</label>
      <textarea class="form-textarea" id="tpl-prompt" rows="6" placeholder="${t('templates.promptPlaceholder')}">${escHtml(tpl?.system_prompt || '')}</textarea>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px" class="form-group">
      <div>
        <label class="form-label">${t('templates.primaryLabel')}</label>
        <input type="color" class="form-input" id="tpl-primary" value="${tpl?.theme?.primaryColor || '#7c3aed'}" style="height:42px;cursor:pointer">
      </div>
      <div>
        <label class="form-label">${t('templates.accentLabel')}</label>
        <input type="color" class="form-input" id="tpl-accent" value="${tpl?.theme?.accentColor || '#06b6d4'}" style="height:42px;cursor:pointer">
      </div>
    </div>
    <div class="flex gap-8" style="justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" onclick="document.getElementById('modal-close').click()">${t('common.cancel')}</button>
      <button class="btn btn-primary" id="save-template-btn">${tpl ? t('templates.saveBtn') : t('templates.createBtn')}</button>
    </div>
  `;
}

function bindTemplateForm(existing, container) {
  document.getElementById('save-template-btn').addEventListener('click', async () => {
    const data = {
      name:          document.getElementById('tpl-name').value.trim(),
      description:   document.getElementById('tpl-desc').value.trim(),
      system_prompt: document.getElementById('tpl-prompt').value.trim(),
      theme: {
        primaryColor: document.getElementById('tpl-primary').value,
        accentColor:  document.getElementById('tpl-accent').value
      }
    };
    if (!data.name || !data.system_prompt) {
      toastError(t('templates.requiredFields'));
      return;
    }
    try {
      if (existing) {
        await api.templates.update(existing.id, data);
      } else {
        await api.templates.create(data);
      }
      closeModal();
      toastSuccess(existing ? t('templates.saved') : t('templates.created'));
      renderTemplates(container);
    } catch (err) {
      toastError(err.message);
    }
  });
}

// ─── PPTX Import ──────────────────────────────────────────────────────────

async function handlePptxImport(file, container) {
  showModal(
    t('templates.pptxTitle'),
    `<div style="text-align:center;padding:32px 0">
      <div class="loading-orb" style="width:40px;height:40px;margin:0 auto 16px"></div>
      <div style="color:var(--text-muted);font-size:14px">${t('templates.pptxAnalyzing')}</div>
      <div style="color:var(--text-muted);font-size:12px;margin-top:8px;opacity:0.6">${escHtml(file.name)}</div>
    </div>`,
    t('templates.pptxSubtitle')
  );

  let suggestion;
  try {
    suggestion = await api.templates.analyzeFromPptx(file);
  } catch (err) {
    closeModal();
    toastError(t('templates.pptxFailed', { msg: err.message }));
    return;
  }

  showModal(
    t('templates.pptxResultTitle'),
    buildTemplateForm({
      name:          suggestion.name,
      description:   suggestion.description,
      system_prompt: suggestion.system_prompt,
      theme:         suggestion.theme
    }),
    t('templates.pptxResultSubtitle')
  );

  document.getElementById('save-template-btn').textContent = t('templates.pptxSaveBtn');
  document.getElementById('save-template-btn').addEventListener('click', async () => {
    const data = {
      name:          document.getElementById('tpl-name').value.trim(),
      description:   document.getElementById('tpl-desc').value.trim(),
      system_prompt: document.getElementById('tpl-prompt').value.trim(),
      theme: {
        primaryColor: document.getElementById('tpl-primary').value,
        accentColor:  document.getElementById('tpl-accent').value,
        style:        suggestion.theme?.style || 'corporate'
      }
    };
    if (!data.name || !data.system_prompt) {
      toastError(t('templates.requiredFields'));
      return;
    }
    try {
      await api.templates.create(data);
      closeModal();
      toastSuccess(t('templates.pptxCreated'));
      renderTemplates(container);
    } catch (err) {
      toastError(err.message);
    }
  });
}
