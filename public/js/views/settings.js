// ─── Settings View ────────────────────────────────────────────────────────

import { api } from '../api.js';
import { toastSuccess, toastError } from '../components/toast.js';
import { initPasswordToggles } from '../utils/passwordToggle.js';

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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

      <!-- Mein Konto -->
      <div class="settings-section">
        <div class="settings-section-title">Mein Konto</div>
      </div>

      <div class="card">
        <div class="form-group">
          <label class="form-label">Name</label>
          <input type="text" class="form-input" id="profile-name" value="${escHtml(window.__currentUser?.name || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">E-Mail</label>
          <input type="email" class="form-input" id="profile-email" value="${escHtml(window.__currentUser?.email || '')}">
        </div>
        <div id="profile-error" style="color:var(--danger);font-size:13px;display:none"></div>
        <button class="btn btn-primary btn-sm" id="save-profile-btn">Profil speichern</button>
      </div>

      <div class="card">
        <div class="form-group">
          <label class="form-label">Aktuelles Passwort</label>
          <div class="password-wrapper">
            <input type="password" class="form-input" id="pw-current" placeholder="••••••••" autocomplete="current-password">
            <button type="button" class="password-toggle" title="Passwort anzeigen/verstecken">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Neues Passwort (mind. 8 Zeichen)</label>
          <div class="password-wrapper">
            <input type="password" class="form-input" id="pw-new" placeholder="••••••••" autocomplete="new-password">
            <button type="button" class="password-toggle" title="Passwort anzeigen/verstecken">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Neues Passwort bestätigen</label>
          <div class="password-wrapper">
            <input type="password" class="form-input" id="pw-confirm" placeholder="••••••••" autocomplete="new-password">
            <button type="button" class="password-toggle" title="Passwort anzeigen/verstecken">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
        </div>
        <div id="pw-error" style="color:var(--danger);font-size:13px;display:none"></div>
        <button class="btn btn-primary btn-sm" id="change-pw-btn">Passwort ändern</button>
      </div>

    </div>
  `;

  initPasswordToggles(container);

  // Profile
  document.getElementById('save-profile-btn').addEventListener('click', async () => {
    const errEl = document.getElementById('profile-error');
    errEl.style.display = 'none';
    try {
      const result = await api.auth.updateProfile({
        name: document.getElementById('profile-name').value.trim(),
        email: document.getElementById('profile-email').value.trim()
      });
      window.__currentUser = { ...window.__currentUser, name: result.name, email: result.email };
      const nameEl = document.getElementById('sidebar-user-name');
      if (nameEl) nameEl.textContent = result.name;
      toastSuccess('Profil gespeichert');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = '';
    }
  });

  // Password change
  document.getElementById('change-pw-btn').addEventListener('click', async () => {
    const errEl = document.getElementById('pw-error');
    errEl.style.display = 'none';
    const newPw = document.getElementById('pw-new').value;
    const confirmPw = document.getElementById('pw-confirm').value;
    if (newPw !== confirmPw) {
      errEl.textContent = 'Die neuen Passwörter stimmen nicht überein';
      errEl.style.display = '';
      return;
    }
    try {
      await api.auth.changePassword({
        currentPassword: document.getElementById('pw-current').value,
        newPassword: newPw
      });
      document.getElementById('pw-current').value = '';
      document.getElementById('pw-new').value = '';
      document.getElementById('pw-confirm').value = '';
      toastSuccess('Passwort geändert');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = '';
    }
  });

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

