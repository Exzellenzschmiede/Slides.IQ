// ─── Modal System ─────────────────────────────────────────────────────────

// Confirmation dialog — replaces browser confirm()
export function showConfirmModal(title, message, { confirmLabel = 'Bestätigen', cancelLabel = 'Abbrechen', danger = false, onConfirm, onCancel } = {}) {
  showModal(title, `
    <p style="color:var(--text-muted);font-size:14px;line-height:1.6;margin-bottom:20px">${message}</p>
    <div class="flex gap-8" style="justify-content:flex-end">
      <button class="btn btn-ghost btn-sm" id="modal-cancel-btn">${cancelLabel}</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm" id="modal-confirm-btn">${confirmLabel}</button>
    </div>
  `);
  document.getElementById('modal-confirm-btn').addEventListener('click', () => { closeModal(); onConfirm?.(); });
  document.getElementById('modal-cancel-btn').addEventListener('click', () => { closeModal(); onCancel?.(); });
}

export function showModal(title, content, subtitle = '') {
  const overlay = document.getElementById('modal-overlay');
  const body = document.getElementById('modal-body');

  body.innerHTML = `
    <h2 class="modal-title">${title}</h2>
    ${subtitle ? `<p class="modal-subtitle">${subtitle}</p>` : ''}
    ${content}
  `;

  overlay.classList.remove('hidden');
}

export function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// Initialize modal close handlers
export function initModal() {
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}
