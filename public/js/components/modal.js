// ─── Modal System ─────────────────────────────────────────────────────────

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
