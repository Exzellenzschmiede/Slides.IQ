// ─── Settings View ────────────────────────────────────────────────────────

import { api } from '../api.js';
import { toastSuccess, toastError } from '../components/toast.js';
import { showModal, closeModal } from '../components/modal.js';
import { initPasswordToggles } from '../utils/passwordToggle.js';

export async function renderSettings(container) {
  let settings = {};
  try { settings = await api.settings.get(); } catch {}

  const brand = settings.brand || {};
  const prefs = settings.preferences || {};

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Einstellungen</h1>
        <p class="view-subtitle">Slides.IQ konfigurieren und Brand Identity festlegen</p>
      </div>
      <button class="btn btn-primary" id="save-settings-btn">Speichern</button>
    </div>

    <div class="settings-grid">

      <!-- API -->
      <div class="settings-section">
        <div class="settings-section-title">Claude API</div>
      </div>
      <div class="card" style="grid-column:span 2">
        <div class="form-group">
          <label class="form-label">API Key Status</label>
          <div id="api-key-status" class="text-sm text-muted">Wird geprüft…</div>
        </div>
        <div class="form-group" style="margin-top:16px">
          <label class="form-label">Generierungsmodell</label>
          <select class="form-select" id="pref-model">
            ${[
              ['claude-opus-4-6',          'Opus 4.6 — Stärkstes Modell'],
              ['claude-sonnet-4-6',        'Sonnet 4.6 — Ausgewogen'],
              ['claude-haiku-4-5-20251001','Haiku 4.5 — Schnellstes Modell'],
            ].map(([v, l]) => `<option value="${v}" ${(prefs.mainModel || 'claude-sonnet-4-6') === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <div class="text-xs text-muted" style="margin-top:6px">Gilt für die Präsentationsgenerierung. Analyse-Funktionen nutzen immer Haiku.</div>
        </div>
      </div>

      <!-- Brand Identity -->
      <div class="settings-section">
        <div class="settings-section-title">Brand Identity (Design DNA)</div>
      </div>

      <div class="card">
        <div class="form-group">
          <label class="form-label">Firmen-/Projektname</label>
          <input type="text" class="form-input" id="brand-name" value="${brand.name || ''}" placeholder="Slides.IQ">
        </div>
        <div class="form-group">
          <label class="form-label">Primärfarbe</label>
          <div class="flex items-center gap-8">
            <input type="color" class="form-input" id="brand-primary" value="${brand.primaryColor || '#7c3aed'}" style="width:60px;height:42px;cursor:pointer">
            <input type="text" class="form-input" id="brand-primary-text" value="${brand.primaryColor || '#7c3aed'}" style="font-family:var(--font-mono);width:120px">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Akzentfarbe</label>
          <div class="flex items-center gap-8">
            <input type="color" class="form-input" id="brand-accent" value="${brand.accentColor || '#06b6d4'}" style="width:60px;height:42px;cursor:pointer">
            <input type="text" class="form-input" id="brand-accent-text" value="${brand.accentColor || '#06b6d4'}" style="font-family:var(--font-mono);width:120px">
          </div>
        </div>
      </div>

      <div class="card">
        <div class="form-group">
          <label class="form-label">Schriftart</label>
          <select class="form-select" id="brand-font">
            ${['Inter', 'Georgia', 'JetBrains Mono', 'Times New Roman', 'Arial', 'Helvetica'].map(f =>
              `<option value="${f}" ${(brand.font || 'Inter') === f ? 'selected' : ''}>${f}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Design-Stil</label>
          <select class="form-select" id="brand-style">
            ${[
              ['modern', 'Modern & Clean'],
              ['corporate', 'Corporate & Professional'],
              ['creative', 'Kreativ & Verspielt'],
              ['minimal', 'Minimalistisch'],
              ['tech', 'Tech & Digital']
            ].map(([v, l]) => `<option value="${v}" ${(brand.style || 'modern') === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Brand Tagline (optional)</label>
          <input type="text" class="form-input" id="brand-tagline" value="${brand.tagline || ''}" placeholder="Innovation neu gedacht">
        </div>
        <div class="form-group">
          <label class="form-label">Ton/Stimme</label>
          <select class="form-select" id="brand-tone">
            ${[
              ['professional', 'Professionell & Sachlich'],
              ['inspiring', 'Inspirierend & Motivierend'],
              ['casual', 'Locker & Freundlich'],
              ['bold', 'Mutig & Direkt'],
              ['academic', 'Akademisch & Präzise']
            ].map(([v, l]) => `<option value="${v}" ${(brand.tone || 'professional') === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- Preferences -->
      <div class="settings-section">
        <div class="settings-section-title">Präferenzen</div>
      </div>

      <div class="card" style="grid-column:span 2">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="form-group">
            <label class="form-label">Standard Slide-Anzahl</label>
            <select class="form-select" id="pref-slides">
              ${[6,8,10,12,15,20].map(n => `<option value="${n}" ${(prefs.defaultSlideCount || 10) === n ? 'selected' : ''}>${n} Slides</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Standard Sprache</label>
            <select class="form-select" id="pref-lang">
              <option value="de" ${(prefs.language || 'de') === 'de' ? 'selected' : ''}>Deutsch</option>
              <option value="en" ${(prefs.language || 'de') === 'en' ? 'selected' : ''}>English</option>
              <option value="fr" ${(prefs.language || 'de') === 'fr' ? 'selected' : ''}>Français</option>
              <option value="es" ${(prefs.language || 'de') === 'es' ? 'selected' : ''}>Español</option>
            </select>
          </div>
        </div>
      </div>

      ${window.__currentUser?.role === 'admin' ? `
      <!-- User Management -->
      <div class="settings-section">
        <div class="settings-section-title">Benutzerverwaltung</div>
      </div>
      <div class="card" style="grid-column:span 2" id="user-mgmt-card">
        <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
          <button class="btn btn-primary btn-sm" id="add-user-btn">+ Benutzer hinzufügen</button>
        </div>
        <div id="user-list">Wird geladen…</div>
      </div>
      ` : ''}

    </div>
  `;

  // Color sync
  ['primary', 'accent'].forEach(type => {
    const picker = document.getElementById(`brand-${type}`);
    const text = document.getElementById(`brand-${type}-text`);
    picker?.addEventListener('input', () => { if (text) text.value = picker.value; });
    text?.addEventListener('input', () => {
      if (/^#[0-9a-f]{6}$/i.test(text.value)) picker.value = text.value;
    });
  });

  // Check API status
  api.ai.status().then(status => {
    const el = document.getElementById('api-key-status');
    if (!el) return;
    const dot = document.querySelector('.status-dot');
    if (status.hasApiKey) {
      el.innerHTML = `<span style="color:var(--success)">✓ API Key gefunden</span> · Model: <code class="font-mono">${status.model}</code>`;
      dot?.classList.add('online');
    } else {
      el.innerHTML = `<span style="color:var(--danger)">✕ Kein API Key gesetzt</span> — Setze ANTHROPIC_API_KEY in der .env Datei`;
      dot?.classList.add('error');
    }
  }).catch(() => {
    document.getElementById('api-key-status').textContent = 'Status nicht verfügbar';
  });

  // User management (admin only)
  if (window.__currentUser?.role === 'admin') {
    loadUsers();

    document.getElementById('add-user-btn')?.addEventListener('click', () => {
      showAddUserForm();
    });
  }

  // Save
  document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const data = {
      brand: {
        name: document.getElementById('brand-name').value,
        primaryColor: document.getElementById('brand-primary-text').value,
        accentColor: document.getElementById('brand-accent-text').value,
        font: document.getElementById('brand-font').value,
        style: document.getElementById('brand-style').value,
        tagline: document.getElementById('brand-tagline').value,
        tone: document.getElementById('brand-tone').value
      },
      preferences: {
        defaultSlideCount: parseInt(document.getElementById('pref-slides').value),
        language: document.getElementById('pref-lang').value,
        mainModel: document.getElementById('pref-model').value
      }
    };

    try {
      await api.settings.update(data);
      toastSuccess('Einstellungen gespeichert!');
    } catch (err) {
      toastError('Fehler: ' + err.message);
    }
  });
}

// ─── User Management Helpers ──────────────────────────────────────────────

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function loadUsers() {
  const list = document.getElementById('user-list');
  if (!list) return;
  try {
    const users = await api.auth.users.list();
    if (!users.length) { list.innerHTML = '<p class="text-muted text-sm">Keine Benutzer.</p>'; return; }
    list.innerHTML = `
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:1px solid var(--border)">
            <th style="text-align:left;padding:8px 4px;font-size:12px;color:var(--text-muted)">Name</th>
            <th style="text-align:left;padding:8px 4px;font-size:12px;color:var(--text-muted)">E-Mail</th>
            <th style="text-align:left;padding:8px 4px;font-size:12px;color:var(--text-muted)">Rolle</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => `
            <tr style="border-bottom:1px solid var(--border)" data-uid="${u.id}">
              <td style="padding:8px 4px;font-size:13px">${escHtml(u.name)}</td>
              <td style="padding:8px 4px;font-size:13px;color:var(--text-muted)">${escHtml(u.email)}</td>
              <td style="padding:8px 4px"><span class="tag" style="${u.role==='admin'?'background:rgba(124,58,237,.2);color:#a78bfa':''}">${u.role}</span></td>
              <td style="padding:4px;text-align:right;white-space:nowrap">
                ${u.id !== window.__currentUser?.id ? `
                  <button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="window.__resetPw('${u.id}','${escHtml(u.name)}')">Passwort</button>
                  <button class="btn btn-ghost btn-sm" style="font-size:11px;color:var(--danger)" onclick="window.__deleteUser('${u.id}','${escHtml(u.name)}')">✕</button>
                ` : '<span class="text-muted text-xs">(du)</span>'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    list.innerHTML = `<p style="color:var(--danger)">${escHtml(err.message)}</p>`;
  }

  window.__deleteUser = async (id, name) => {
    if (!confirm(`Benutzer "${name}" wirklich löschen?`)) return;
    try {
      await api.auth.users.delete(id);
      toastSuccess('Benutzer gelöscht');
      loadUsers();
    } catch (err) { toastError(err.message); }
  };

  window.__resetPw = (id, name) => {
    const pw = prompt(`Neues Passwort für "${name}" (mind. 8 Zeichen):`);
    if (!pw) return;
    api.auth.users.resetPassword(id, pw)
      .then(() => toastSuccess('Passwort geändert'))
      .catch(err => toastError(err.message));
  };
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
        <button type="button" class="password-toggle" data-target="new-user-password" title="Passwort anzeigen/verstecken">
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

  document.getElementById('create-user-confirm-btn')?.addEventListener('click', async () => {
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
