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

      <!-- Plan & Billing -->
      <div class="settings-section">
        <div class="settings-section-title">${t('settings.billingSection')}</div>
      </div>
      <div class="card" id="billing-card">
        <div style="color:var(--text-muted);font-size:14px">${t('common.loading') || 'Lädt…'}</div>
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
    window.applyStaticI18n?.();
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

  // ─── Plan & Billing ───────────────────────────────────────────────────────

  // React to the Stripe Checkout redirect (#settings?billing=success|cancel).
  const billingFlag = (location.hash.split('?')[1] || '').match(/billing=(success|cancel)/)?.[1];
  if (billingFlag === 'success') {
    const { toastSuccess } = await import('../components/toast.js');
    toastSuccess(t('billing.checkoutSuccess'));
    history.replaceState(null, '', '#settings');
  } else if (billingFlag === 'cancel') {
    history.replaceState(null, '', '#settings');
  }

  async function loadBilling(retries = 0) {
    const card = document.getElementById('billing-card');
    if (!card) return;
    let info;
    try { info = await api.billing.me(); } catch (err) { card.innerHTML = `<div style="color:var(--text-muted);font-size:14px">${escHtml(err.message)}</div>`; return; }

    // After a successful checkout the webhook may lag — poll a few times.
    if (billingFlag === 'success' && info.plan.id === 'free' && retries < 4) {
      setTimeout(() => loadBilling(retries + 1), 1500);
    }

    const fmtLimit = (n) => n === -1 ? (t('billing.unlimited') || '∞') : n;
    const bar = (used, limit) => {
      if (limit === -1) return '';
      const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
      const col = pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--accent)';
      return `<div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;margin-top:6px"><div style="height:100%;width:${pct}%;background:${col}"></div></div>`;
    };

    const statusBadge = info.status && info.status !== 'active'
      ? `<span style="font-size:12px;color:var(--warning);margin-left:8px">${escHtml(info.status)}</span>` : '';
    const renews = info.periodEnd
      ? `<div style="font-size:12px;color:var(--text-dim);margin-top:4px">${info.cancelAtPeriodEnd ? t('billing.cancelsOn') : t('billing.renewsOn')} ${new Date(info.periodEnd).toLocaleDateString()}</div>`
      : '';

    // Upgrade options: plans above current that have checkout.
    const order = { free: 0, pro: 1, business: 2 };
    const upgrades = (info.plans || []).filter(p => p.hasCheckout && order[p.id] > order[info.plan.id]);

    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:13px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em">${t('billing.currentPlan')}</div>
          <div style="font-size:22px;font-weight:700">${escHtml(info.plan.name)}${statusBadge}</div>
          ${renews}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${upgrades.map(p => `<button class="btn btn-primary btn-sm" data-upgrade="${p.id}">${t('billing.upgradeTo').replace('{{plan}}', escHtml(p.name))}</button>`).join('')}
          ${info.stripeCustomerId ? `<button class="btn btn-ghost btn-sm" id="billing-portal-btn">${t('billing.manageSubscription')}</button>` : ''}
        </div>
      </div>
      <div style="margin-top:20px;display:flex;flex-direction:column;gap:16px">
        <div>
          <div style="display:flex;justify-content:space-between;font-size:13px"><span>${t('billing.usageGenerations')}</span><span style="color:var(--text-muted)">${info.usage.aiGenerations} / ${fmtLimit(info.plan.limits.aiGenerationsPerMonth)}</span></div>
          ${bar(info.usage.aiGenerations, info.plan.limits.aiGenerationsPerMonth)}
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;font-size:13px"><span>${t('billing.usagePresentations')}</span><span style="color:var(--text-muted)">${info.usage.presentations} / ${fmtLimit(info.plan.limits.maxPresentations)}</span></div>
          ${bar(info.usage.presentations, info.plan.limits.maxPresentations)}
        </div>
      </div>
    `;

    card.querySelectorAll('[data-upgrade]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try { const { url } = await api.billing.checkout(btn.dataset.upgrade); window.location = url; }
        catch (err) { toastError(err.message); btn.disabled = false; }
      });
    });
    document.getElementById('billing-portal-btn')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { const { url } = await api.billing.portal(); window.location = url; }
      catch (err) { toastError(err.message); e.target.disabled = false; }
    });
  }

  loadBilling();

}
