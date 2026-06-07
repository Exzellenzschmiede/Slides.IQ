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
  const hash = window.location.hash.slice(1) || 'hub';
  const parts = hash.split('/');
  return { view: parts[0], id: parts[1] || null };
}

// Sub-views map their nav highlight to a top-level library entry.
const NAV_GROUP = {
  studio: 'dashboard',
  'image-studio': 'gallery',
  'story-studio': 'stories',
  'voice-studio': 'voices',
  'music-studio': 'sounds',
  'campaign-studio': 'campaigns',
};

export function rerenderCurrentView() {
  if (_renderFn) _renderFn();
}

export function initRouter(container) {
  async function render() {
    const { view, id } = parseRoute();

    // Update nav — sub-views (studio, image-studio) highlight their library entry.
    const activeNav = NAV_GROUP[view] || view;
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === activeNav);
    });

    // Render view
    container.classList.remove('studio-mode');
    const renderFn = routes[view] || routes['hub'];
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
