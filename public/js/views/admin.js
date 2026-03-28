// ─── Admin View ───────────────────────────────────────────────────────────

import { api } from '../api.js';
import { toastSuccess, toastError } from '../components/toast.js';
import { showModal, closeModal } from '../components/modal.js';
import { initPasswordToggles } from '../utils/passwordToggle.js';

export async function renderAdmin(container) {
  if (window.__currentUser?.role !== 'admin') {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⊘</div>
        <div class="empty-state-title">Kein Zugriff</div>
        <div class="empty-state-desc">Dieser Bereich ist nur für Admins.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Administration</h1>
        <p class="view-subtitle">Benutzer verwalten und Zugriffsrechte vergeben</p>
      </div>
      <button class="btn btn-primary" id="add-user-btn">+ Benutzer hinzufügen</button>
    </div>

    <div class="card" style="max-width:900px">
      <div id="user-list" class="text-muted text-sm">Wird geladen…</div>
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
      list.innerHTML = '<p class="text-muted text-sm">Keine Benutzer vorhanden.</p>';
      return;
    }
    list.innerHTML = `
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:1px solid var(--border)">
            <th style="text-align:left;padding:10px 8px;font-size:12px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.06em">Name</th>
            <th style="text-align:left;padding:10px 8px;font-size:12px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.06em">E-Mail</th>
            <th style="text-align:left;padding:10px 8px;font-size:12px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.06em">Rolle</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => `
            <tr style="border-bottom:1px solid var(--border)" data-uid="${escHtml(u.id)}">
              <td style="padding:10px 8px;font-size:14px">${escHtml(u.name)}</td>
              <td style="padding:10px 8px;font-size:13px;color:var(--text-muted)">${escHtml(u.email)}</td>
              <td style="padding:10px 8px">
                <span class="tag" style="${u.role === 'admin' ? 'background:rgba(124,58,237,.2);color:#a78bfa' : ''}">${escHtml(u.role)}</span>
              </td>
              <td style="padding:6px 8px;text-align:right;white-space:nowrap">
                ${u.id !== window.__currentUser?.id ? `
                  <button class="btn btn-ghost btn-sm" style="font-size:12px" data-action="reset-pw" data-uid="${escHtml(u.id)}" data-name="${escHtml(u.name)}">Passwort</button>
                  <button class="btn btn-ghost btn-sm" style="font-size:12px;color:var(--danger)" data-action="delete" data-uid="${escHtml(u.id)}" data-name="${escHtml(u.name)}">✕ Löschen</button>
                ` : '<span class="text-muted text-xs">(du)</span>'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

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

async function deleteUser(id, name) {
  if (!confirm(`Benutzer "${name}" wirklich löschen?`)) return;
  try {
    await api.auth.users.delete(id);
    toastSuccess('Benutzer gelöscht');
    loadUsers();
  } catch (err) {
    toastError(err.message);
  }
}

function showResetPasswordForm(id, name) {
  showModal(`Passwort ändern`, `
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Neues Passwort für <strong>${escHtml(name)}</strong></p>
    <div class="form-group">
      <label class="form-label">Neues Passwort (mind. 8 Zeichen)</label>
      <div class="password-wrapper">
        <input type="password" class="form-input" id="reset-pw-input" placeholder="••••••••">
        <button type="button" class="password-toggle" title="Passwort anzeigen/verstecken">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>
    </div>
    <div id="reset-pw-error" style="color:var(--danger);font-size:13px;display:none"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" onclick="window.__modalApi.closeModal()">Abbrechen</button>
      <button class="btn btn-primary" id="reset-pw-confirm-btn">Speichern</button>
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
      toastSuccess('Passwort geändert');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = '';
    }
  });
}

function showAddUserForm() {
  showModal('Benutzer hinzufügen', `
    <div class="form-group">
      <label class="form-label">Name</label>
      <input type="text" class="form-input" id="new-user-name" placeholder="Max Mustermann">
    </div>
    <div class="form-group">
      <label class="form-label">E-Mail</label>
      <input type="email" class="form-input" id="new-user-email" placeholder="max@firma.de">
    </div>
    <div class="form-group">
      <label class="form-label">Passwort (mind. 8 Zeichen)</label>
      <div class="password-wrapper">
        <input type="password" class="form-input" id="new-user-password">
        <button type="button" class="password-toggle" title="Passwort anzeigen/verstecken">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Rolle</label>
      <select class="form-select" id="new-user-role">
        <option value="user">Benutzer</option>
        <option value="admin">Admin</option>
      </select>
    </div>
    <div id="new-user-error" style="color:var(--danger);font-size:13px;display:none"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" onclick="window.__modalApi.closeModal()">Abbrechen</button>
      <button class="btn btn-primary" id="create-user-confirm-btn">Erstellen</button>
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
      toastSuccess('Benutzer erstellt');
      loadUsers();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = '';
    }
  });
}
