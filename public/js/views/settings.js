// ─── Settings View ────────────────────────────────────────────────────────

import { api } from '../api.js';
import { toastError } from '../components/toast.js';
import { initPasswordToggles } from '../utils/passwordToggle.js';
import { t, setLanguage } from '../i18n.js';
import { rerenderCurrentView } from '../router.js';

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
      { value: 'mistral-large-3',       label: 'Mistral Large 3 (stärkste)' },
      { value: 'mistral-medium-3-5',    label: 'Mistral Medium 3.5' },
      { value: 'mistral-small-2603',    label: 'Mistral Small 4 (schnell)' },
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

function buildProviderSection(prefs) {
  const activeProvider = prefs.aiProvider || 'anthropic';
  const aiProviders = prefs.aiProviders || {};

  const tabs = PROVIDERS.map(p => `
    <button class="provider-tab${p.id === activeProvider ? ' active' : ''}" data-provider="${p.id}">
      <span class="provider-tab-logo">${p.logo}</span> ${p.label}
    </button>`).join('');

  const panels = PROVIDERS.map(p => {
    const cfg = aiProviders[p.id] || {};
    const selectedModel = cfg.model || p.models[0].value;
    const apiKey = cfg.apiKey || '';
    return `
      <div id="provider-panel-${p.id}" class="provider-panel${p.id !== activeProvider ? ' hidden' : ''}">
        <div class="form-group" style="margin-top:16px">
          <label class="form-label">Aktiver Anbieter</label>
          <div style="display:flex;align-items:center;gap:10px">
            <input type="radio" name="pref-ai-provider" id="pref-ai-provider-${p.id}" value="${p.id}" ${p.id === activeProvider ? 'checked' : ''} style="accent-color:var(--primary)">
            <label for="pref-ai-provider-${p.id}" style="font-size:13px;cursor:pointer">${p.logo} ${p.label} als aktiven Anbieter verwenden</label>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">API-Key</label>
          <div class="password-wrapper">
            <input type="password" class="form-input" id="provider-key-${p.id}" value="${escHtml(apiKey)}" placeholder="${p.keyPlaceholder}" autocomplete="off">
            <button type="button" class="password-toggle" title="Anzeigen/Verbergen">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
          <div class="text-xs text-muted" style="margin-top:5px">Key abrufen: ${p.keyHint}</div>
        </div>
        <div class="form-group">
          <label class="form-label">Modell</label>
          <select class="form-select" id="provider-model-${p.id}">
            ${p.models.map(m => `<option value="${m.value}" ${selectedModel === m.value ? 'selected' : ''}>${m.label}</option>`).join('')}
          </select>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="provider-tabs">${tabs}</div>
    ${panels}
  `;
}

function readProviderSettings() {
  const result = {};
  for (const p of PROVIDERS) {
    result[p.id] = {
      apiKey: document.getElementById(`provider-key-${p.id}`)?.value || '',
      model: document.getElementById(`provider-model-${p.id}`)?.value || p.models[0].value,
    };
  }
  return result;
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
        <p class="view-subtitle" id="settings-status" style="transition:color .3s">${t('settings.subtitle')}</p>
      </div>
    </div>

    <div class="settings-grid">

      <!-- AI Provider -->
      <div class="settings-section">
        <div class="settings-section-title">KI-Anbieter</div>
        <div class="settings-section-desc">Wähle Anbieter, API-Key und Modell</div>
      </div>
      <div class="card" style="grid-column:span 2">
        ${buildProviderSection(prefs)}
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
            mainModel: document.getElementById('pref-model')?.value || 'claude-sonnet-4-6',
            aiProvider: document.querySelector('input[name="pref-ai-provider"]:checked')?.value || 'anthropic',
            aiProviders: readProviderSettings()
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

  // Wire provider tabs
  document.querySelectorAll('.provider-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.provider-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.provider-panel').forEach(p => p.classList.add('hidden'));
      tab.classList.add('active');
      document.getElementById('provider-panel-' + tab.dataset.provider)?.classList.remove('hidden');
    });
  });

  // Wire up all auto-save inputs (everything except password fields)
  const autoSaveIds = [
    'brand-name', 'brand-primary-text', 'brand-accent-text',
    'brand-font', 'brand-style', 'brand-tagline', 'brand-tone',
    'profile-name', 'profile-email', 'pref-lang',
    'provider-model-anthropic', 'provider-key-anthropic',
    'provider-model-openai', 'provider-key-openai',
    'provider-model-mistral', 'provider-key-mistral',
    'provider-model-gemini', 'provider-key-gemini',
  ];

  // Wire radio buttons for active provider
  container.querySelectorAll('input[name="pref-ai-provider"]').forEach(radio => {
    radio.addEventListener('change', scheduleSave);
  });

  autoSaveIds.forEach(id => {
    document.getElementById(id)?.addEventListener('input', scheduleSave);
    document.getElementById(id)?.addEventListener('change', scheduleSave);
  });

  // Color picker syncs + also triggers auto-save
  ['primary', 'accent'].forEach(type => {
    const picker = document.getElementById(`brand-${type}`);
    const text = document.getElementById(`brand-${type}-text`);
    picker?.addEventListener('input', () => {
      if (text) text.value = picker.value;
      scheduleSave();
    });
    text?.addEventListener('input', () => {
      if (/^#[0-9a-f]{6}$/i.test(text.value)) picker.value = text.value;
    });
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
