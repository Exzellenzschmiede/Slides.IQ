// ─── Admin View ───────────────────────────────────────────────────────────

import { api } from '../api.js';
import { toastSuccess, toastError } from '../components/toast.js';
import { showModal, closeModal, showConfirmModal } from '../components/modal.js';
import { initPasswordToggles } from '../utils/passwordToggle.js';
import { t } from '../i18n.js';

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

    <div class="card" style="max-width:900px">
      <div id="user-list" class="text-muted text-sm">${t('admin.loadingUsers')}</div>
    </div>
  `;

  loadUsers();

  document.getElementById('add-user-btn').addEventListener('click', showAddUserForm);
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
