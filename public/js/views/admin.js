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
      { value: 'claude-opus-4-8',           label: 'Claude Opus 4.8 (stärkste, 1M Kontext)' },
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
      { value: 'mistral-large-latest',    label: 'Mistral Large 3 (stärkste)' },
      { value: 'mistral-medium-latest',   label: 'Mistral Medium 3.5 (empfohlen)' },
      { value: 'mistral-small-latest',    label: 'Mistral Small 4 (schnell)' },
      { value: 'magistral-medium-latest', label: 'Magistral Medium (Reasoning)' },
    ],
    keyPlaceholder: 'Dein Mistral API-Key',
    keyHint: 'console.mistral.ai',
  },
  {
    id: 'gemini', label: 'Google Gemini', logo: '✦',
    models: [
      { value: 'gemini-3.1-pro-preview',  label: 'Gemini 3.1 Pro (stärkste, Reasoning)' },
      { value: 'gemini-3.5-flash',        label: 'Gemini 3.5 Flash (empfohlen)' },
      { value: 'gemini-3.1-flash-lite',   label: 'Gemini 3.1 Flash-Lite (günstig)' },
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
    </div>

    <nav class="admin-tabs">
      <button class="admin-tab active" data-admin-tab="ai">
        <span class="admin-tab-icon">⚙</span> KI-Anbieter
      </button>
      <button class="admin-tab" data-admin-tab="email">
        <span class="admin-tab-icon">✉</span> E-Mail (SMTP)
      </button>
      <button class="admin-tab" data-admin-tab="stripe">
        <span class="admin-tab-icon">💳</span> Stripe
      </button>
      <button class="admin-tab" data-admin-tab="users">
        <span class="admin-tab-icon">👥</span> Benutzerverwaltung
      </button>
    </nav>

    <div id="admin-panel-ai" class="admin-panel active" style="max-width:900px">
      <div class="card" id="ai-settings-card">
        <div class="text-muted text-sm">Lade…</div>
      </div>
    </div>

    <div id="admin-panel-email" class="admin-panel" style="max-width:900px">
      <div class="card" id="email-settings-card">
        <div class="text-muted text-sm">Lade…</div>
      </div>
    </div>

    <div id="admin-panel-stripe" class="admin-panel" style="max-width:900px">
      <div class="card" id="stripe-settings-card">
        <div class="text-muted text-sm">Lade…</div>
      </div>
    </div>

    <div id="admin-panel-users" class="admin-panel" style="max-width:900px">
      <div class="card">
        <div id="user-list" class="text-muted text-sm">${t('admin.loadingUsers')}</div>
      </div>
    </div>
  `;

  container.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      container.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('admin-panel-' + tab.dataset.adminTab)?.classList.add('active');
    });
  });

  loadAiSettings();
  loadEmailSettings();
  loadStripeSettings();
  loadUsers();
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

// ─── Email (SMTP) Settings ─────────────────────────────────────────────────

async function loadEmailSettings() {
  const card = document.getElementById('email-settings-card');
  if (!card) return;
  try {
    const s = await api.admin.emailSettings.get();
    card.innerHTML = `
      <p class="text-muted text-sm" style="margin:0 0 16px">
        SMTP-Zugang für Verifizierungs- und Passwort-Reset-Mails. Ist kein Host gesetzt,
        werden E-Mails nur in der Server-Konsole protokolliert (Dev-Modus).
      </p>
      <div class="form-group">
        <label class="form-label">SMTP-Host</label>
        <input type="text" class="form-input" id="email-host" value="${escHtml(s.host || '')}" placeholder="host.docker.internal" autocomplete="off">
      </div>
      <div style="display:flex;gap:12px">
        <div class="form-group" style="flex:1">
          <label class="form-label">Port</label>
          <input type="number" class="form-input" id="email-port" value="${escHtml(s.port ?? 25)}" placeholder="25">
        </div>
        <div class="form-group" style="flex:2">
          <label class="form-label">Verschlüsselung</label>
          <select class="form-select" id="email-secure">
            <option value="false" ${!s.secure ? 'selected' : ''}>STARTTLS / keine (Port 25/587)</option>
            <option value="true" ${s.secure ? 'selected' : ''}>SSL/TLS (Port 465)</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Absender (From)</label>
        <input type="text" class="form-input" id="email-from" value="${escHtml(s.from || '')}" placeholder="Slides.IQ &lt;noreply@example.com&gt;" autocomplete="off">
      </div>
      <div style="display:flex;gap:12px">
        <div class="form-group" style="flex:1">
          <label class="form-label">SMTP-Benutzer <span class="text-muted text-xs">(optional)</span></label>
          <input type="text" class="form-input" id="email-user" value="${escHtml(s.user || '')}" placeholder="leer = ohne Auth" autocomplete="off">
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label">SMTP-Passwort <span class="text-muted text-xs">(optional)</span></label>
          <div class="password-wrapper">
            <input type="password" class="form-input" id="email-pass" value="${escHtml(s.pass || '')}" placeholder="leer = ohne Auth" autocomplete="off">
            <button type="button" class="password-toggle" title="Anzeigen/Verbergen">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Basis-URL <span class="text-muted text-xs">(für Links in E-Mails &amp; Freigaben)</span></label>
        <input type="text" class="form-input" id="email-baseurl" value="${escHtml(s.baseUrl || '')}" placeholder="https://app.example.com" autocomplete="off">
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
        <button class="btn btn-primary btn-sm" id="email-settings-save">Speichern</button>
        <span id="email-settings-status" style="font-size:13px;color:var(--text-muted)"></span>
      </div>
    `;
    initPasswordToggles(card);
    document.getElementById('email-settings-save').addEventListener('click', saveEmailSettings);
  } catch (err) {
    card.innerHTML = `<p style="color:var(--danger)">${escHtml(err.message)}</p>`;
  }
}

async function saveEmailSettings() {
  const statusEl = document.getElementById('email-settings-status');
  const saveBtn = document.getElementById('email-settings-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Speichert…'; }
  const payload = {
    host: document.getElementById('email-host').value.trim(),
    port: parseInt(document.getElementById('email-port').value, 10) || 25,
    secure: document.getElementById('email-secure').value === 'true',
    from: document.getElementById('email-from').value.trim(),
    user: document.getElementById('email-user').value.trim(),
    pass: document.getElementById('email-pass').value,
    baseUrl: document.getElementById('email-baseurl').value.trim(),
  };
  try {
    await api.admin.emailSettings.update(payload);
    if (statusEl) { statusEl.textContent = '✓ Gespeichert'; statusEl.style.color = 'var(--success)'; }
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2500);
  } catch (err) {
    if (statusEl) { statusEl.textContent = err.message; statusEl.style.color = 'var(--danger)'; }
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Speichern'; }
  }
}

// ─── Stripe Settings ───────────────────────────────────────────────────────

const STRIPE_FIELDS = [
  { id: 'secretKey',           label: 'Secret Key',                 placeholder: 'sk_live_… / sk_test_…', secret: true },
  { id: 'webhookSecret',       label: 'Webhook Signing Secret',     placeholder: 'whsec_…',               secret: true },
  { id: 'pricePro',            label: 'Price ID — Pro (monatlich)', placeholder: 'price_…',               secret: false },
  { id: 'priceProAnnual',      label: 'Price ID — Pro (jährlich)',  placeholder: 'price_… (optional)',    secret: false },
  { id: 'priceBusiness',       label: 'Price ID — Business (monatlich)', placeholder: 'price_…',          secret: false },
  { id: 'priceBusinessAnnual', label: 'Price ID — Business (jährlich)',  placeholder: 'price_… (optional)', secret: false },
];

function stripeFieldHtml(f, value) {
  if (f.secret) {
    return `
      <div class="form-group">
        <label class="form-label">${f.label}</label>
        <div class="password-wrapper">
          <input type="password" class="form-input" id="stripe-${f.id}" value="${escHtml(value || '')}" placeholder="${f.placeholder}" autocomplete="off">
          <button type="button" class="password-toggle" title="Anzeigen/Verbergen">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
      </div>`;
  }
  return `
    <div class="form-group">
      <label class="form-label">${f.label}</label>
      <input type="text" class="form-input" id="stripe-${f.id}" value="${escHtml(value || '')}" placeholder="${f.placeholder}" autocomplete="off">
    </div>`;
}

async function loadStripeSettings() {
  const card = document.getElementById('stripe-settings-card');
  if (!card) return;
  try {
    const s = await api.admin.stripeSettings.get();
    card.innerHTML = `
      <p class="text-muted text-sm" style="margin:0 0 16px">
        Stripe-Schlüssel und Price IDs für Abonnements. Ohne Secret Key sind Zahlungen deaktiviert.
        Der Webhook-Endpoint ist <code>/api/billing/webhook</code>.
      </p>
      ${STRIPE_FIELDS.map(f => stripeFieldHtml(f, s[f.id])).join('')}
      <div style="display:flex;align-items:center;gap:12px;margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
        <button class="btn btn-primary btn-sm" id="stripe-settings-save">Speichern</button>
        <span id="stripe-settings-status" style="font-size:13px;color:var(--text-muted)"></span>
      </div>
    `;
    initPasswordToggles(card);
    document.getElementById('stripe-settings-save').addEventListener('click', saveStripeSettings);
  } catch (err) {
    card.innerHTML = `<p style="color:var(--danger)">${escHtml(err.message)}</p>`;
  }
}

async function saveStripeSettings() {
  const statusEl = document.getElementById('stripe-settings-status');
  const saveBtn = document.getElementById('stripe-settings-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Speichert…'; }
  const payload = {};
  for (const f of STRIPE_FIELDS) {
    payload[f.id] = document.getElementById(`stripe-${f.id}`).value.trim();
  }
  try {
    await api.admin.stripeSettings.update(payload);
    if (statusEl) { statusEl.textContent = '✓ Gespeichert'; statusEl.style.color = 'var(--success)'; }
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2500);
  } catch (err) {
    if (statusEl) { statusEl.textContent = err.message; statusEl.style.color = 'var(--danger)'; }
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Speichern'; }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function generatePassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
  return Array.from({ length: 14 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function pwFieldHtml(inputId) {
  return `
    <div style="display:flex;gap:8px;align-items:stretch">
      <div class="password-wrapper" style="flex:1">
        <input type="password" class="form-input" id="${inputId}" placeholder="••••••••" autocomplete="new-password">
        <button type="button" class="password-toggle" title="Anzeigen/Verbergen">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" id="${inputId}-gen" style="white-space:nowrap;flex-shrink:0">⚙ Generieren</button>
    </div>`;
}

async function loadUsers() {
  const list = document.getElementById('user-list');
  if (!list) return;
  try {
    const users = await api.auth.users.list();

    const thStyle = 'text-align:left;padding:10px 8px;font-size:12px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.06em';

    list.innerHTML = `
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:1px solid var(--border)">
            <th style="${thStyle}">${t('admin.colName')}</th>
            <th style="${thStyle}">${t('admin.colEmail')}</th>
            <th style="${thStyle}">${t('admin.colRole')}</th>
            <th style="${thStyle}">${t('admin.colPlan') || 'Tarif'}</th>
            <th style="${thStyle}">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => {
            const isSelf = u.id === window.__currentUser?.id;
            const activeStyle = u.is_active !== 0
              ? 'background:rgba(34,197,94,.15);color:#4ade80'
              : 'background:rgba(239,68,68,.15);color:#f87171';
            const activeLabel = u.is_active !== 0 ? 'Aktiv' : 'Inaktiv';
            return `
            <tr style="border-bottom:1px solid var(--border);opacity:${u.is_active !== 0 ? '1' : '.6'}" data-uid="${escHtml(u.id)}">
              <td style="padding:10px 8px;font-size:14px">${escHtml(u.name)}</td>
              <td style="padding:10px 8px;font-size:13px;color:var(--text-muted)">${escHtml(u.email)}</td>
              <td style="padding:10px 8px">
                ${!isSelf ? `
                  <button class="btn btn-ghost btn-sm tag" style="font-size:11px;cursor:pointer;${u.role === 'admin' ? 'background:rgba(124,58,237,.2);color:#a78bfa' : ''}" data-action="toggle-role" data-uid="${escHtml(u.id)}" data-role="${escHtml(u.role)}" title="Rolle wechseln">
                    ${escHtml(u.role)} ⇄
                  </button>
                ` : `<span class="tag" style="${u.role === 'admin' ? 'background:rgba(124,58,237,.2);color:#a78bfa' : ''}">${escHtml(u.role)}</span>`}
              </td>
              <td style="padding:10px 8px">
                <select class="form-select" style="font-size:12px;padding:4px 6px" data-action="set-plan" data-uid="${escHtml(u.id)}">
                  ${['free','pro','business'].map(p => `<option value="${p}" ${(u.plan||'free')===p?'selected':''}>${p}</option>`).join('')}
                </select>
              </td>
              <td style="padding:10px 8px">
                <span class="tag" style="${activeStyle}">${activeLabel}</span>
              </td>
              <td style="padding:6px 8px;text-align:right;white-space:nowrap">
                ${!isSelf ? `
                  <button class="btn btn-ghost btn-sm" style="font-size:12px" data-action="edit" data-uid="${escHtml(u.id)}" data-name="${escHtml(u.name)}" data-email="${escHtml(u.email)}" data-role="${escHtml(u.role)}">Bearbeiten</button>
                  <button class="btn btn-ghost btn-sm" style="font-size:12px" data-action="reset-pw" data-uid="${escHtml(u.id)}" data-name="${escHtml(u.name)}">${t('admin.resetPwBtn')}</button>
                  <button class="btn btn-ghost btn-sm" style="font-size:12px" data-action="toggle-active" data-uid="${escHtml(u.id)}" data-name="${escHtml(u.name)}" data-active="${u.is_active}">${u.is_active !== 0 ? 'Deaktivieren' : 'Aktivieren'}</button>
                  <button class="btn btn-ghost btn-sm" style="font-size:12px;color:var(--danger)" data-action="delete" data-uid="${escHtml(u.id)}" data-name="${escHtml(u.name)}">${t('admin.deleteBtn')}</button>
                ` : `<span class="text-muted text-xs">${t('admin.you')}</span>`}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <button class="btn btn-primary btn-sm" id="add-user-btn">+ Benutzer hinzufügen</button>
      </div>
    `;

    list.querySelectorAll('[data-action="toggle-role"]').forEach(btn =>
      btn.addEventListener('click', () => toggleRole(btn.dataset.uid, btn.dataset.role)));
    list.querySelectorAll('[data-action="delete"]').forEach(btn =>
      btn.addEventListener('click', () => deleteUser(btn.dataset.uid, btn.dataset.name)));
    list.querySelectorAll('[data-action="reset-pw"]').forEach(btn =>
      btn.addEventListener('click', () => showResetPasswordForm(btn.dataset.uid, btn.dataset.name)));
    list.querySelectorAll('[data-action="toggle-active"]').forEach(btn =>
      btn.addEventListener('click', () => toggleActive(btn.dataset.uid, btn.dataset.name, btn.dataset.active)));
    list.querySelectorAll('[data-action="edit"]').forEach(btn =>
      btn.addEventListener('click', () => showEditUserForm(btn.dataset.uid, btn.dataset.name, btn.dataset.email, btn.dataset.role)));
    list.querySelectorAll('[data-action="set-plan"]').forEach(sel =>
      sel.addEventListener('change', async () => {
        try { await api.admin.setUserPlan(sel.dataset.uid, sel.value); toastSuccess(t('admin.planChanged') || 'Tarif aktualisiert'); }
        catch (err) { toastError(err.message); loadUsers(); }
      }));
    document.getElementById('add-user-btn')?.addEventListener('click', showAddUserForm);
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

function toggleActive(id, name, currentActive) {
  const activate = currentActive === '0' || currentActive === 0;
  const action = activate ? 'Aktivieren' : 'Deaktivieren';
  showConfirmModal(`${action}: ${name}`, `Benutzer "${escHtml(name)}" wird ${activate ? 'aktiviert' : 'deaktiviert'}.`, {
    confirmLabel: action,
    onConfirm: async () => {
      try {
        await api.auth.users.toggleActive(id);
        toastSuccess(`Benutzer ${activate ? 'aktiviert' : 'deaktiviert'}.`);
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

function showEditUserForm(id, name, email, role) {
  showModal('Benutzer bearbeiten', `
    <div class="form-group">
      <label class="form-label">${t('admin.nameLabel')}</label>
      <input type="text" class="form-input" id="edit-user-name" value="${escHtml(name)}">
    </div>
    <div class="form-group">
      <label class="form-label">${t('admin.emailLabel')}</label>
      <input type="email" class="form-input" id="edit-user-email" value="${escHtml(email)}">
    </div>
    <div class="form-group">
      <label class="form-label">${t('admin.roleLabel')}</label>
      <select class="form-select" id="edit-user-role">
        <option value="user" ${role === 'user' ? 'selected' : ''}>${t('admin.roleUser')}</option>
        <option value="admin" ${role === 'admin' ? 'selected' : ''}>${t('admin.roleAdmin')}</option>
      </select>
    </div>
    <div id="edit-user-error" style="color:var(--danger);font-size:13px;display:none"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" id="edit-user-cancel">${t('common.cancel')}</button>
      <button class="btn btn-primary" id="edit-user-confirm">Speichern</button>
    </div>
  `);

  document.getElementById('edit-user-cancel').addEventListener('click', closeModal);
  document.getElementById('edit-user-confirm').addEventListener('click', async () => {
    const errEl = document.getElementById('edit-user-error');
    errEl.style.display = 'none';
    try {
      await api.auth.users.update(id, {
        name: document.getElementById('edit-user-name').value.trim(),
        email: document.getElementById('edit-user-email').value.trim(),
        role: document.getElementById('edit-user-role').value,
      });
      closeModal();
      toastSuccess('Benutzer gespeichert.');
      loadUsers();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = '';
    }
  });
}

function showResetPasswordForm(id, name) {
  showModal(t('admin.resetPwTitle'), `
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">${t('admin.resetPwFor')} <strong>${escHtml(name)}</strong></p>
    <div class="form-group">
      <label class="form-label">${t('admin.resetPwLabel')}</label>
      ${pwFieldHtml('reset-pw-input')}
    </div>
    <div id="reset-pw-error" style="color:var(--danger);font-size:13px;display:none"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" id="reset-pw-cancel">${t('common.cancel')}</button>
      <button class="btn btn-primary" id="reset-pw-confirm-btn">${t('admin.resetPwSave')}</button>
    </div>
  `);

  initPasswordToggles(document);

  document.getElementById('reset-pw-cancel').addEventListener('click', closeModal);
  document.getElementById('reset-pw-input-gen').addEventListener('click', () => {
    const input = document.getElementById('reset-pw-input');
    input.value = generatePassword();
    input.type = 'text';
  });
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
      ${pwFieldHtml('new-user-password')}
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
      <button class="btn btn-ghost" id="add-user-cancel">${t('admin.cancelBtn')}</button>
      <button class="btn btn-primary" id="create-user-confirm-btn">${t('admin.createBtn')}</button>
    </div>
  `);

  initPasswordToggles(document);

  document.getElementById('add-user-cancel').addEventListener('click', closeModal);
  document.getElementById('new-user-password-gen').addEventListener('click', () => {
    const input = document.getElementById('new-user-password');
    input.value = generatePassword();
    input.type = 'text';
  });
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
