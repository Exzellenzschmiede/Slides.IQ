// ─── Slide Library View ───────────────────────────────────────────────────

import { api } from '../api.js';

export async function renderLibrary(container) {
  const slides = await api.slideLibrary.list();

  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Slide Library</h1>
        <p class="view-subtitle">Gespeicherte Einzelslides für die Wiederverwendung</p>
      </div>
    </div>

    ${slides.length === 0 ? `
      <div class="empty-state">
        <div class="empty-state-icon">◈</div>
        <div class="empty-state-title">Library leer</div>
        <div class="empty-state-desc">
          Öffne eine Präsentation im AI Studio und speichere einzelne Slides
          über das Kontextmenü in der Library.
        </div>
      </div>
    ` : `
      <div class="presentations-grid">
        ${slides.map(s => `
          <div class="card card-glow" style="display:flex;flex-direction:column;gap:12px">
            <div style="height:120px;background:var(--bg-input);border-radius:8px;overflow:hidden;position:relative">
              <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:32px">◈</div>
            </div>
            <div>
              <div style="font-size:14px;font-weight:600;margin-bottom:4px">${s.title}</div>
              <div class="text-xs text-muted">${new Date(s.created_at).toLocaleDateString('de')}</div>
              <div class="flex gap-8 mt-8" style="flex-wrap:wrap">
                ${(s.tags || []).map(t => `<span class="tag">${t}</span>`).join('')}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}
