// ─── Settings View ────────────────────────────────────────────────────────

import { api } from '../api.js';
import { toastSuccess, toastError } from '../components/toast.js';
import { initPasswordToggles } from '../utils/passwordToggle.js';
import { t, setLanguage } from '../i18n.js';
import { rerenderCurrentView } from '../router.js';

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
        <h1 class="view-title">${t('settings.title')}</h1>
        <p class="view-subtitle">${t('settings.subtitle')}</p>
      </div>
      <button class="btn btn-primary" id="save-settings-btn">${t('settings.saveBtn')}</button>
    </div>

    <div class="settings-grid">

      <!-- API -->
      <div class="settings-section">
        <div class="settings-section-title">${t('settings.apiSection')}</div>
      </div>
      <div class="card" style="grid-column:span 2">
        <div class="form-group">
          <label class="form-label">${t('settings.apiKeyStatus')}</label>
          <div id="api-key-status" class="text-sm text-muted">${t('settings.apiKeyChecking')}</div>
        </div>
        <div class="form-group" style="margin-top:16px">
          <label class="form-label">${t('settings.modelLabel')}</label>
          <select class="form-select" id="pref-model">
            ${[
              ['claude-opus-4-6',          t('settings.modelOpus')],
              ['claude-sonnet-4-6',        t('settings.modelSonnet')],
              ['claude-haiku-4-5-20251001', t('settings.modelHaiku')],
            ].map(([v, l]) => `<option value="${v}" ${(prefs.mainModel || 'claude-sonnet-4-6') === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <div class="text-xs text-muted" style="margin-top:6px">${t('settings.modelNote')}</div>
        </div>
      </div>

      <!-- Brand Identity -->
      <div class="settings-section">
        <div class="settings-section-title">${t('settings.brandSection')}</div>
      </div>

      <div class="card">
        <div class="form-group">
          <label class="form-label">${t('settings.brandNameLabel')}</label>
          <input type="text" class="form-input" id="brand-name" value="${brand.name || ''}" placeholder="${t('settings.brandNamePlaceholder')}">
        </div>
        <div class="form-group">
          <label class="form-label">${t('settings.primaryColorLabel')}</label>
          <div class="flex items-center gap-8">
            <input type="color" class="form-input" id="brand-primary" value="${brand.primaryColor || '#7c3aed'}" style="width:60px;height:42px;cursor:pointer">
            <input type="text" class="form-input" id="brand-primary-text" value="${brand.primaryColor || '#7c3aed'}" style="font-family:var(--font-mono);width:120px">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${t('settings.accentColorLabel')}</label>
          <div class="flex items-center gap-8">
            <input type="color" class="form-input" id="brand-accent" value="${brand.accentColor || '#06b6d4'}" style="width:60px;height:42px;cursor:pointer">
            <input type="text" class="form-input" id="brand-accent-text" value="${brand.accentColor || '#06b6d4'}" style="font-family:var(--font-mono);width:120px">
          </div>
        </div>
      </div>

      <div class="card">
        <div class="form-group">
          <label class="form-label">${t('settings.fontLabel')}</label>
          <select class="form-select" id="brand-font">
            ${['Inter', 'Georgia', 'JetBrains Mono', 'Times New Roman', 'Arial', 'Helvetica'].map(f =>
              `<option value="${f}" ${(brand.font || 'Inter') === f ? 'selected' : ''}>${f}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${t('settings.styleLabel')}</label>
          <select class="form-select" id="brand-style">
            ${[
              ['modern',    t('settings.styleModern')],
              ['corporate', t('settings.styleCorporate')],
              ['creative',  t('settings.styleCreative')],
              ['minimal',   t('settings.styleMinimal')],
              ['tech',      t('settings.styleTech')]
            ].map(([v, l]) => `<option value="${v}" ${(brand.style || 'modern') === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${t('settings.taglineLabel')}</label>
          <input type="text" class="form-input" id="brand-tagline" value="${brand.tagline || ''}" placeholder="${t('settings.taglinePlaceholder')}">
        </div>
        <div class="form-group">
          <label class="form-label">${t('settings.toneLabel')}</label>
          <select class="form-select" id="brand-tone">
            ${[
              ['professional', t('settings.toneProfessional')],
              ['inspiring',    t('settings.toneInspiring')],
              ['casual',       t('settings.toneCasual')],
              ['bold',         t('settings.toneBold')],
              ['academic',     t('settings.toneAcademic')]
            ].map(([v, l]) => `<option value="${v}" ${(brand.tone || 'professional') === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- My Account -->
      <div class="settings-section">
        <div class="settings-section-title">${t('settings.accountSection')}</div>
      </div>

      <div class="card">
        <div class="form-group">
          <label class="form-label">${t('settings.nameLabel')}</label>
          <input type="text" class="form-input" id="profile-name" value="${escHtml(window.__currentUser?.name || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">${t('settings.emailLabel')}</label>
          <input type="email" class="form-input" id="profile-email" value="${escHtml(window.__currentUser?.email || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">${t('settings.languageLabel')}</label>
          <select class="form-select" id="pref-lang">
            <option value="en" ${(prefs.language || 'en') === 'en' ? 'selected' : ''}>${t('settings.langEn')}</option>
            <option value="de" ${(prefs.language || 'en') === 'de' ? 'selected' : ''}>${t('settings.langDe')}</option>
            <option value="it" ${(prefs.language || 'en') === 'it' ? 'selected' : ''}>${t('settings.langIt')}</option>
            <option value="nl" ${(prefs.language || 'en') === 'nl' ? 'selected' : ''}>${t('settings.langNl')}</option>
            <option value="pl" ${(prefs.language || 'en') === 'pl' ? 'selected' : ''}>${t('settings.langPl')}</option>
          </select>
        </div>
        <div id="profile-error" style="color:var(--danger);font-size:13px;display:none"></div>
        <button class="btn btn-primary btn-sm" id="save-profile-btn">${t('settings.saveProfileBtn')}</button>
      </div>

      <div class="card">
        <div class="form-group">
          <label class="form-label">${t('settings.currentPwLabel')}</label>
          <div class="password-wrapper">
            <input type="password" class="form-input" id="pw-current" placeholder="••••••••" autocomplete="current-password">
            <button type="button" class="password-toggle" title="${t('settings.currentPwLabel')}">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${t('settings.newPwLabel')}</label>
          <div class="password-wrapper">
            <input type="password" class="form-input" id="pw-new" placeholder="••••••••" autocomplete="new-password">
            <button type="button" class="password-toggle" title="${t('settings.newPwLabel')}">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${t('settings.confirmPwLabel')}</label>
          <div class="password-wrapper">
            <input type="password" class="form-input" id="pw-confirm" placeholder="••••••••" autocomplete="new-password">
            <button type="button" class="password-toggle" title="${t('settings.confirmPwLabel')}">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
        </div>
        <div id="pw-error" style="color:var(--danger);font-size:13px;display:none"></div>
        <button class="btn btn-primary btn-sm" id="change-pw-btn">${t('settings.changePwBtn')}</button>
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
      toastSuccess(t('settings.profileSaved'));
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
      errEl.textContent = t('settings.pwMismatch');
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
      toastSuccess(t('settings.pwChanged'));
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
      el.innerHTML = `<span style="color:var(--success)">${t('settings.apiKeyFound')}</span> · Model: <code class="font-mono">${status.model}</code>`;
      dot?.classList.add('online');
    } else {
      el.innerHTML = `<span style="color:var(--danger)">${t('settings.apiKeyMissing')}</span>`;
      dot?.classList.add('error');
    }
  }).catch(() => {
    const el = document.getElementById('api-key-status');
    if (el) el.textContent = t('settings.apiKeyUnavailable');
  });

  // Save
  document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const newLang = document.getElementById('pref-lang').value;
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
        language: newLang,
        mainModel: document.getElementById('pref-model').value
      }
    };

    try {
      await api.settings.update(data);
      setLanguage(newLang);
      toastSuccess(t('settings.settingsSaved'));
      rerenderCurrentView();
    } catch (err) {
      toastError(t('settings.settingsError', { msg: err.message }));
    }
  });
}
