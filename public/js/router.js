// ─── Simple Hash Router ───────────────────────────────────────────────────

const routes = {};
let currentView = null;
let _renderFn = null;

export function registerView(name, renderFn) {
  routes[name] = renderFn;
}

export function navigate(view, params = {}) {
  const hash = params.id ? `#${view}/${params.id}` : `#${view}`;
  window.location.hash = hash;
}

export function parseRoute() {
  const hash = window.location.hash.slice(1) || 'dashboard';
  const parts = hash.split('/');
  return { view: parts[0], id: parts[1] || null };
}

export function rerenderCurrentView() {
  if (_renderFn) _renderFn();
}

export function initRouter(container) {
  async function render() {
    const { view, id } = parseRoute();

    // Update nav — studio is a sub-view of dashboard ("Meine Slides")
    const activeNav = view === 'studio' ? 'dashboard' : view;
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === activeNav);
    });

    // Render view
    const renderFn = routes[view] || routes['dashboard'];
    if (renderFn) {
      container.innerHTML = '<div class="loading-screen"><div class="loading-orb"></div></div>';
      try {
        await renderFn(container, { id });
      } catch (err) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">⚠</div>
            <div class="empty-state-title">Fehler beim Laden</div>
            <div class="empty-state-desc">${err.message}</div>
          </div>
        `;
        console.error(err);
      }
    }
  }

  _renderFn = render;
  window.addEventListener('hashchange', render);
  render();
}
