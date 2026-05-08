// ─── Dashboard View ───────────────────────────────────────────────────────

import { api } from '../api.js';
import { navigate } from '../router.js';
import { showModal, closeModal, showConfirmModal } from '../components/modal.js';
import { toastSuccess, toastError, toastInfo } from '../components/toast.js';
import { t, getCurrentLocale } from '../i18n.js';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(getCurrentLocale(), { day: '2-digit', month: 'short', year: 'numeric' });
}

function renderCard(p) {
  const hasContent = !!p.html_content;
  const tags = (p.tags || []).map(tag => `<span class="tag">${tag}</span>`).join('');

  return `
    <div class="presentation-card card-glow" data-id="${p.id}">
      <div class="presentation-card-preview" onclick="window.nexusOpenStudio('${p.id}')">
        ${hasContent
          ? `<iframe src="/api/presentations/${p.id}/content-preview" sandbox="allow-scripts allow-same-origin" loading="lazy"></iframe>`
          : `<div class="presentation-card-preview-placeholder">◈</div>`
        }
        ${p.slide_count > 0 ? `<div class="slide-count-badge">${t('dashboard.slideBadge', { count: p.slide_count })}</div>` : ''}
        ${p.share_token ? `<div class="slide-count-badge" style="bottom:8px;left:8px;right:auto">${t('dashboard.shared')}</div>` : ''}
        ${!p.is_owner ? `<div class="slide-count-badge" style="top:8px;left:8px;right:auto;background:rgba(124,58,237,.8)">${p.shared_permission === 'write' ? '✏' : p.shared_permission === 'delete' ? '⚙' : '👁'} ${p.owner_name || t('dashboard.shared')}</div>` : ''}
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
            <button class="btn btn-ghost btn-sm" onclick="window.nexusPresent('${p.id}')">${t('dashboard.present')}</button>
            <button class="btn btn-ghost btn-sm" onclick="window.nexusExportPdf('${p.id}', '${p.title}')">${t('dashboard.pdf')}</button>
          ` : ''}
          ${p.is_owner ? `<button class="btn btn-ghost btn-sm" onclick="window.nexusDeletePresentation('${p.id}')" style="margin-left:auto">✕</button>` : ''}
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

  const count = presentations.length;
  const subtitleKey = count === 1 ? 'dashboard.subtitle_one' : 'dashboard.subtitle_many';

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">${t('dashboard.title')}</h1>
        <p class="view-subtitle">${t(subtitleKey, { count })}</p>
      </div>
      <div class="flex gap-8">
        <input type="search" id="search-input" class="form-input" placeholder="${t('dashboard.searchPlaceholder')}" style="width:220px">
        <button class="btn btn-primary" id="new-btn">${t('dashboard.newBtn')}</button>
      </div>
    </div>

    <div class="presentations-grid" id="presentations-grid">
      <div class="new-presentation-card" id="new-card">
        <div class="new-card-icon">+</div>
        <div style="font-size:14px;font-weight:500">${t('dashboard.newCard')}</div>
        <div class="text-sm text-muted">${t('dashboard.newCardSub')}</div>
      </div>
      ${presentations.map(renderCard).join('')}
    </div>

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

  bindGridActions();
}

function bindGridActions() {
  // Content preview iframes
  document.querySelectorAll('.presentation-card-preview iframe').forEach(iframe => {
    const id = iframe.closest('.presentation-card').dataset.id;
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
  const templateOptions = templates.map(tpl => `
    <div class="template-card" data-tpl-id="${tpl.id}" style="cursor:pointer;margin-bottom:0">
      <div class="template-preview" style="background:${getTemplateGradient(tpl.theme)};height:80px;font-size:11px;color:white;font-weight:600">
        ${tpl.name}
      </div>
    </div>
  `).join('');

  showModal(t('dashboard.modalTitle'), `
    <div class="form-group">
      <label class="form-label">${t('dashboard.titleLabel')}</label>
      <input type="text" class="form-input" id="new-title" placeholder="${t('dashboard.titlePlaceholder')}" autofocus>
    </div>
    <div class="form-group">
      <label class="form-label">${t('dashboard.descLabel')}</label>
      <input type="text" class="form-input" id="new-desc" placeholder="${t('dashboard.descPlaceholder')}">
    </div>
    <div class="form-group">
      <label class="form-label">${t('dashboard.templateLabel')}</label>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px" id="tpl-picker">
        <div class="template-card" data-tpl-id="" style="cursor:pointer;margin-bottom:0">
          <div class="template-preview" style="background:#1a1a2e;height:80px;font-size:11px;color:rgba(255,255,255,0.5);font-weight:600">
            ${t('dashboard.noTemplate')}
          </div>
        </div>
        ${templateOptions}
      </div>
    </div>
    <div class="flex gap-8" style="justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" onclick="document.getElementById('modal-close').click()">${t('common.cancel')}</button>
      <button class="btn btn-primary" id="create-btn">${t('dashboard.createOpen')}</button>
    </div>
  `, t('dashboard.modalSubtitle'));

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
      toastError(t('dashboard.errorCreate', { msg: err.message }));
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
    if (!p.html_content) return toastError(t('dashboard.noContentYet'));
    const blob = new Blob([p.html_content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'fullscreen=yes');
  });
};

window.nexusExportPdf = async (id, title) => {
  try {
    toastInfo(t('dashboard.pdfCreating'));
    const blob = await api.presentations.exportPdf(id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${title}.pdf`; a.click();
    URL.revokeObjectURL(url);
    toastSuccess(t('dashboard.pdfExported'));
  } catch (err) {
    toastError(t('dashboard.pdfError', { msg: err.message }));
  }
};

window.nexusDeletePresentation = (id) => {
  showConfirmModal(t('dashboard.confirmDelete'), t('dashboard.confirmDeleteMsg', { defaultValue: 'Diese Präsentation wird unwiderruflich gelöscht.' }), {
    confirmLabel: t('common.delete', { defaultValue: 'Löschen' }),
    danger: true,
    onConfirm: async () => {
      try {
        await api.presentations.delete(id);
        toastSuccess(t('dashboard.deleted'));
        navigate('dashboard');
        renderDashboard(document.getElementById('view-container'));
      } catch (err) {
        toastError(t('common.error') + ': ' + err.message);
      }
    }
  });
};
