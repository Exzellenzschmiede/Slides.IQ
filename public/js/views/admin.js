// ─── Admin View ───────────────────────────────────────────────────────────

import { api } from '../api.js';
import { toastSuccess, toastError } from '../components/toast.js';
import { showModal, closeModal, showConfirmModal } from '../components/modal.js';
import { initPasswordToggles } from '../utils/passwordToggle.js';
import { t } from '../i18n.js';

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const PROVIDERS = [
  {
    id: 'anthropic', label: 'Anthropic Claude', logo: '◈',
    models: [
      { value: 'claude-opus-4-7',           label: 'Claude Opus 4.7 (stärkste)' },
      { value: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6 (empfohlen)' },
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (schnell)' },
    ],
    keyPlaceholder: 'sk-ant-...',
    keyHint: 'console.anthropic.com',
  },
  {
    id: 'openai', label: 'OpenAI ChatGPT', logo: '⬡',
    models: [
      { value: 'gpt-5.5',      label: 'GPT-5.5 (aktuell, empfohlen)' },
      { value: 'gpt-5.4',      label: 'GPT-5.4' },
      { value: 'gpt-5.4-mini', label: 'GPT-5.4 mini (schnell)' },
      { value: 'gpt-5.4-nano', label: 'GPT-5.4 nano (günstig)' },
    ],
    keyPlaceholder: 'sk-...',
    keyHint: 'platform.openai.com',
  },
  {
    id: 'mistral', label: 'Mistral Le Chat', logo: '🌊',
    models: [
      { value: 'mistral-large-3',         label: 'Mistral Large 3 (stärkste)' },
      { value: 'mistral-medium-3-5',      label: 'Mistral Medium 3.5' },
      { value: 'mistral-small-2603',      label: 'Mistral Small 4 (schnell)' },
      { value: 'magistral-medium-latest', label: 'Magistral Medium (Reasoning)' },
    ],
    keyPlaceholder: 'Dein Mistral API-Key',
    keyHint: 'console.mistral.ai',
  },
  {
    id: 'gemini', label: 'Google Gemini', logo: '✦',
    models: [
      { value: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro (empfohlen)' },
      { value: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash (schnell)' },
      { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (günstig)' },
    ],
    keyPlaceholder: 'AIza...',
    keyHint: 'aistudio.google.com',
  },
];

function buildProviderSection(activeProvider, aiProviders) {
  const tabs = PROVIDERS.map(p => `
    <button class="provider-tab${p.id === activeProvider ? ' active' : ''}" data-provider="${p.id}">
      <span class="provider-tab-logo">${p.logo}</span> ${p.label}
    </button>`).join('');

  const panels = PROVIDERS.map(p => {
    const cfg = aiProviders[p.id] || {};
    const selectedModel = cfg.model || p.models[0].value;
    const apiKey = cfg.apiKey || '';
    return `
      <div id="ai-provider-panel-${p.id}" class="provider-panel${p.id !== activeProvider ? ' hidden' : ''}">
        <div class="form-group" style="margin-top:16px">
          <label class="form-label">Aktiver Anbieter</label>
          <div style="display:flex;align-items:center;gap:10px">
            <input type="radio" name="ai-provider" id="ai-provider-${p.id}" value="${p.id}" ${p.id === activeProvider ? 'checked' : ''} style="accent-color:var(--primary)">
            <label for="ai-provider-${p.id}" style="font-size:13px;cursor:pointer">${p.logo} ${p.label} als aktiven Anbieter verwenden</label>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">API-Key</label>
          <div class="password-wrapper">
            <input type="password" class="form-input" id="ai-key-${p.id}" value="${escHtml(apiKey)}" placeholder="${p.keyPlaceholder}" autocomplete="off">
            <button type="button" class="password-toggle" title="Anzeigen/Verbergen">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
          <div class="text-xs text-muted" style="margin-top:5px">Key abrufen: ${p.keyHint}</div>
        </div>
        <div class="form-group">
          <label class="form-label">Modell</label>
          <select class="form-select" id="ai-model-${p.id}">
            ${p.models.map(m => `<option value="${m.value}" ${selectedModel === m.value ? 'selected' : ''}>${m.label}</option>`).join('')}
          </select>
        </div>
      </div>`;
  }).join('');

  return `<div class="provider-tabs">${tabs}</div>${panels}`;
}

export async function renderAdmin(container) {
  if (window.__currentUser?.role !== 'admin') {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⊘</div>
        <div class="empty-state-title">${t('admin.noAccess')}</div>
        <div class="empty-state-desc">${t('admin.noAccessDesc')}</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">${t('admin.title')}</h1>
        <p class="view-subtitle">${t('admin.subtitle')}</p>
      </div>
      <button class="btn btn-primary" id="add-user-btn">${t('admin.addUserBtn')}</button>
    </div>

    <div class="settings-grid" style="max-width:900px;margin-bottom:32px">
      <div class="settings-section">
        <div class="settings-section-title">KI-Anbieter</div>
        <div class="settings-section-desc" style="font-size:13px;color:var(--text-muted);margin-top:4px">Gilt für alle Benutzer</div>
      </div>
      <div class="card" style="grid-column:span 2" id="ai-settings-card">
        <div class="text-muted text-sm">Lade…</div>
      </div>
    </div>

    <div class="card" style="max-width:900px">
      <div id="user-list" class="text-muted text-sm">${t('admin.loadingUsers')}</div>
    </div>
  `;

  loadAiSettings();
  loadUsers();

  document.getElementById('add-user-btn').addEventListener('click', showAddUserForm);
}

// ─── AI Settings ──────────────────────────────────────────────────────────

async function loadAiSettings() {
  const card = document.getElementById('ai-settings-card');
  if (!card) return;
  try {
    const data = await api.admin.aiSettings.get();
    const activeProvider = data.aiProvider || 'anthropic';
    const aiProviders = data.aiProviders || {};

    card.innerHTML = buildProviderSection(activeProvider, aiProviders) + `
      <div style="display:flex;align-items:center;gap:12px;margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
        <button class="btn btn-primary btn-sm" id="ai-settings-save">Speichern</button>
        <span id="ai-settings-status" style="font-size:13px;color:var(--text-muted)"></span>
      </div>
    `;

    initPasswordToggles(card);

    // Tab switching
    card.querySelectorAll('.provider-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        card.querySelectorAll('.provider-tab').forEach(t => t.classList.remove('active'));
        card.querySelectorAll('.provider-panel').forEach(p => p.classList.add('hidden'));
        tab.classList.add('active');
        card.getElementById?.('ai-provider-panel-' + tab.dataset.provider)?.classList.remove('hidden');
        document.getElementById('ai-provider-panel-' + tab.dataset.provider)?.classList.remove('hidden');
      });
    });

    document.getElementById('ai-settings-save').addEventListener('click', saveAiSettings);
  } catch (err) {
    if (card) card.innerHTML = `<p style="color:var(--danger)">${err.message}</p>`;
  }
}

async function saveAiSettings() {
  const statusEl = document.getElementById('ai-settings-status');
  const saveBtn = document.getElementById('ai-settings-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Speichert…'; }

  const aiProvider = document.querySelector('input[name="ai-provider"]:checked')?.value || 'anthropic';
  const aiProviders = {};
  for (const p of PROVIDERS) {
    aiProviders[p.id] = {
      apiKey: document.getElementById(`ai-key-${p.id}`)?.value || '',
      model: document.getElementById(`ai-model-${p.id}`)?.value || p.models[0].value,
    };
  }

  try {
    await api.admin.aiSettings.update({ aiProvider, aiProviders });
    if (statusEl) { statusEl.textContent = '✓ Gespeichert'; statusEl.style.color = 'var(--success)'; }
    setTimeout(() => { if (statusEl) { statusEl.textContent = ''; } }, 2500);
  } catch (err) {
    if (statusEl) { statusEl.textContent = err.message; statusEl.style.color = 'var(--danger)'; }
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Speichern'; }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function loadUsers() {
  const list = document.getElementById('user-list');
  if (!list) return;
  try {
    const users = await api.auth.users.list();
    if (!users.length) {
      list.innerHTML = `<p class="text-muted text-sm">${t('admin.noUsers')}</p>`;
      return;
    }
    list.innerHTML = `
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:1px solid var(--border)">
            <th style="text-align:left;padding:10px 8px;font-size:12px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.06em">${t('admin.colName')}</th>
            <th style="text-align:left;padding:10px 8px;font-size:12px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.06em">${t('admin.colEmail')}</th>
            <th style="text-align:left;padding:10px 8px;font-size:12px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.06em">${t('admin.colRole')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => `
            <tr style="border-bottom:1px solid var(--border)" data-uid="${escHtml(u.id)}">
              <td style="padding:10px 8px;font-size:14px">${escHtml(u.name)}</td>
              <td style="padding:10px 8px;font-size:13px;color:var(--text-muted)">${escHtml(u.email)}</td>
              <td style="padding:10px 8px">
                ${u.id !== window.__currentUser?.id ? `
                  <button class="btn btn-ghost btn-sm tag" style="font-size:11px;cursor:pointer;${u.role === 'admin' ? 'background:rgba(124,58,237,.2);color:#a78bfa' : ''}" data-action="toggle-role" data-uid="${escHtml(u.id)}" data-role="${escHtml(u.role)}" title="${t('admin.colRole')}">
                    ${escHtml(u.role)} ⇄
                  </button>
                ` : `<span class="tag" style="${u.role === 'admin' ? 'background:rgba(124,58,237,.2);color:#a78bfa' : ''}">${escHtml(u.role)}</span>`}
              </td>
              <td style="padding:6px 8px;text-align:right;white-space:nowrap">
                ${u.id !== window.__currentUser?.id ? `
                  <button class="btn btn-ghost btn-sm" style="font-size:12px" data-action="reset-pw" data-uid="${escHtml(u.id)}" data-name="${escHtml(u.name)}">${t('admin.resetPwBtn')}</button>
                  <button class="btn btn-ghost btn-sm" style="font-size:12px;color:var(--danger)" data-action="delete" data-uid="${escHtml(u.id)}" data-name="${escHtml(u.name)}">${t('admin.deleteBtn')}</button>
                ` : `<span class="text-muted text-xs">${t('admin.you')}</span>`}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    list.querySelectorAll('[data-action="toggle-role"]').forEach(btn => {
      btn.addEventListener('click', () => toggleRole(btn.dataset.uid, btn.dataset.role));
    });
    list.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => deleteUser(btn.dataset.uid, btn.dataset.name));
    });
    list.querySelectorAll('[data-action="reset-pw"]').forEach(btn => {
      btn.addEventListener('click', () => showResetPasswordForm(btn.dataset.uid, btn.dataset.name));
    });
  } catch (err) {
    list.innerHTML = `<p style="color:var(--danger)">${escHtml(err.message)}</p>`;
  }
}

function toggleRole(id, currentRole) {
  const newRole = currentRole === 'admin' ? 'user' : 'admin';
  const label = newRole === 'admin' ? t('admin.toggleRoleAdmin') : t('admin.toggleRoleUser');
  showConfirmModal(t('admin.confirmToggleRole', { label }), `Rolle wird zu "${label}" geändert.`, {
    confirmLabel: 'Ändern',
    onConfirm: async () => {
      try {
        await api.auth.users.changeRole(id, newRole);
        toastSuccess(t('admin.roleChanged', { role: newRole }));
        loadUsers();
      } catch (err) { toastError(err.message); }
    }
  });
}

function deleteUser(id, name) {
  showConfirmModal(t('admin.confirmDeleteUser', { name }), `Benutzer "${escHtml(name)}" wird unwiderruflich gelöscht.`, {
    confirmLabel: 'Löschen', danger: true,
    onConfirm: async () => {
      try {
        await api.auth.users.delete(id);
        toastSuccess(t('admin.userDeleted'));
        loadUsers();
      } catch (err) { toastError(err.message); }
    }
  });
}

function showResetPasswordForm(id, name) {
  showModal(t('admin.resetPwTitle'), `
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">${t('admin.resetPwFor')} <strong>${escHtml(name)}</strong></p>
    <div class="form-group">
      <label class="form-label">${t('admin.resetPwLabel')}</label>
      <div class="password-wrapper">
        <input type="password" class="form-input" id="reset-pw-input" placeholder="••••••••">
        <button type="button" class="password-toggle" title="${t('admin.resetPwLabel')}">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>
    </div>
    <div id="reset-pw-error" style="color:var(--danger);font-size:13px;display:none"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" onclick="window.__modalApi.closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" id="reset-pw-confirm-btn">${t('admin.resetPwSave')}</button>
    </div>
  `);

  initPasswordToggles(document);

  document.getElementById('reset-pw-confirm-btn').addEventListener('click', async () => {
    const errEl = document.getElementById('reset-pw-error');
    const pw = document.getElementById('reset-pw-input').value;
    errEl.style.display = 'none';
    try {
      await api.auth.users.resetPassword(id, pw);
      closeModal();
      toastSuccess(t('admin.pwChanged'));
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = '';
    }
  });
}

function showAddUserForm() {
  showModal(t('admin.addUserTitle'), `
    <div class="form-group">
      <label class="form-label">${t('admin.nameLabel')}</label>
      <input type="text" class="form-input" id="new-user-name" placeholder="${t('admin.namePlaceholder')}">
    </div>
    <div class="form-group">
      <label class="form-label">${t('admin.emailLabel')}</label>
      <input type="email" class="form-input" id="new-user-email" placeholder="${t('admin.emailPlaceholder')}">
    </div>
    <div class="form-group">
      <label class="form-label">${t('admin.passwordLabel')}</label>
      <div class="password-wrapper">
        <input type="password" class="form-input" id="new-user-password">
        <button type="button" class="password-toggle" title="${t('admin.passwordLabel')}">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">${t('admin.roleLabel')}</label>
      <select class="form-select" id="new-user-role">
        <option value="user">${t('admin.roleUser')}</option>
        <option value="admin">${t('admin.roleAdmin')}</option>
      </select>
    </div>
    <div id="new-user-error" style="color:var(--danger);font-size:13px;display:none"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" onclick="window.__modalApi.closeModal()">${t('admin.cancelBtn')}</button>
      <button class="btn btn-primary" id="create-user-confirm-btn">${t('admin.createBtn')}</button>
    </div>
  `);

  initPasswordToggles(document);

  document.getElementById('create-user-confirm-btn').addEventListener('click', async () => {
    const errEl = document.getElementById('new-user-error');
    errEl.style.display = 'none';
    try {
      await api.auth.users.create({
        name: document.getElementById('new-user-name').value.trim(),
        email: document.getElementById('new-user-email').value.trim(),
        password: document.getElementById('new-user-password').value,
        role: document.getElementById('new-user-role').value
      });
      closeModal();
      toastSuccess(t('admin.userCreated'));
      loadUsers();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = '';
    }
  });
}
