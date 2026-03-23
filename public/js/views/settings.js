// ─── Settings View ────────────────────────────────────────────────────────

import { api } from '../api.js';
import { toastSuccess, toastError } from '../components/toast.js';

export async function renderSettings(container) {
  let settings = {};
  try { settings = await api.settings.get(); } catch {}

  const brand = settings.brand || {};
  const prefs = settings.preferences || {};

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Einstellungen</h1>
        <p class="view-subtitle">Nexus konfigurieren und Brand Identity festlegen</p>
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
        <div class="text-xs text-muted" style="margin-top:8px">
          Der API Key wird über die Umgebungsvariable <code class="font-mono" style="background:var(--bg-input);padding:2px 6px;border-radius:4px">ANTHROPIC_API_KEY</code> gesetzt.
          Setze ihn in der <code class="font-mono" style="background:var(--bg-input);padding:2px 6px;border-radius:4px">.env</code> Datei oder als Docker-Variable.
        </div>
      </div>

      <!-- Brand Identity -->
      <div class="settings-section">
        <div class="settings-section-title">Brand Identity (Design DNA)</div>
      </div>

      <div class="card">
        <div class="form-group">
          <label class="form-label">Firmen-/Projektname</label>
          <input type="text" class="form-input" id="brand-name" value="${brand.name || ''}" placeholder="Nexus Corp">
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

      <!-- System Info -->
      <div class="settings-section">
        <div class="settings-section-title">System</div>
      </div>
      <div class="card" style="grid-column:span 2">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;font-size:13px">
          <div>
            <div class="form-label">Version</div>
            <div class="font-mono">1.0.0</div>
          </div>
          <div>
            <div class="form-label">Model</div>
            <div class="font-mono" id="model-info">claude-opus-4-5</div>
          </div>
          <div>
            <div class="form-label">Datenbank</div>
            <div class="font-mono">SQLite</div>
          </div>
        </div>
      </div>
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
        language: document.getElementById('pref-lang').value
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
