// ─── Settings View ────────────────────────────────────────────────────────

import { api } from '../api.js';
import { toastError } from '../components/toast.js';
import { initPasswordToggles } from '../utils/passwordToggle.js';
import { t, setLanguage } from '../i18n.js';
import { rerenderCurrentView } from '../router.js';

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


export async function renderSettings(container) {
  let settings = {};
  try { settings = await api.settings.get(); } catch {}

  const prefs = settings.preferences || {};

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">${t('settings.title')}</h1>
        <p class="view-subtitle" id="settings-status" style="transition:color .3s">${t('settings.subtitle')}</p>
      </div>
    </div>

    <div class="settings-grid">

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

  // ─── Auto-save ────────────────────────────────────────────────────────────

  const statusEl = document.getElementById('settings-status');
  let saveTimer = null;

  function showStatus(state) {
    if (state === 'saving') {
      statusEl.textContent = t('settings.statusSaving');
      statusEl.style.color = 'var(--text-muted)';
    } else if (state === 'saved') {
      statusEl.textContent = '✓ ' + t('settings.statusSaved');
      statusEl.style.color = 'var(--success)';
      setTimeout(() => {
        if (statusEl) {
          statusEl.textContent = t('settings.subtitle');
          statusEl.style.color = '';
        }
      }, 2500);
    } else if (state === 'error') {
      statusEl.textContent = t('settings.statusError');
      statusEl.style.color = 'var(--danger)';
    }
  }

  async function saveAll() {
    const newLang = document.getElementById('pref-lang').value;
    showStatus('saving');
    try {
      await Promise.all([
        api.settings.update({
          preferences: {
            language: newLang,
          }
        }),
        api.auth.updateProfile({
          name: document.getElementById('profile-name').value.trim(),
          email: document.getElementById('profile-email').value.trim()
        }).then(result => {
          window.__currentUser = { ...window.__currentUser, name: result.name, email: result.email };
          const nameEl = document.getElementById('sidebar-user-name');
          if (nameEl) nameEl.textContent = result.name;
        })
      ]);
      setLanguage(newLang);
      showStatus('saved');
    } catch (err) {
      showStatus('error');
      toastError(err.message);
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveAll, 800);
  }

  // Wire up all auto-save inputs (everything except password fields)
  ['profile-name', 'profile-email', 'pref-lang'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', scheduleSave);
    document.getElementById(id)?.addEventListener('change', scheduleSave);
  });

  // Language: save immediately + re-render so the view itself switches language
  document.getElementById('pref-lang')?.addEventListener('change', async () => {
    clearTimeout(saveTimer);
    setLanguage(document.getElementById('pref-lang').value);
    await saveAll();
    rerenderCurrentView();
  });

  // ─── Password change (manual) ─────────────────────────────────────────────

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
      showStatus('saved');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = '';
    }
  });

}
