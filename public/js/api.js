// ─── Nexus API Client ─────────────────────────────────────────────────────

const API_BASE = '/api';

async function apiFetch(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
    body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const e = new Error(err.error || `HTTP ${res.status}`);
    e.status = res.status;
    e.code = err.code;
    e.body = err;
    throw e;
  }

  const contentType = res.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) return res.json();
  if (contentType.includes('application/pdf')) return res.blob();
  return res.text();
}

// ─── Presentations ─────────────────────────────────────────────────────────

async function* readSseStream(url, body, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.error || `HTTP ${res.status}`);
    e.status = res.status;
    e.code = err.code;
    e.body = err;
    throw e;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try { yield JSON.parse(line.slice(6)); } catch {}
      }
    }
  }
}

export const api = {
  presentations: {
    list: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/presentations${qs ? '?' + qs : ''}`);
    },
    get: (id) => apiFetch(`/presentations/${id}`),
    create: (data) => apiFetch('/presentations', { method: 'POST', body: data }),
    update: (id, data) => apiFetch(`/presentations/${id}`, { method: 'PUT', body: data }),
    delete: (id) => apiFetch(`/presentations/${id}`, { method: 'DELETE' }),
    share: (id) => apiFetch(`/presentations/${id}/share`, { method: 'POST' }),
    unshare: (id) => apiFetch(`/presentations/${id}/share`, { method: 'DELETE' }),
    exportPdf: (id) => apiFetch(`/presentations/${id}/export/pdf`),
    exportHtml: async (id, title) => {
      const res = await fetch(`${API_BASE}/presentations/${id}/export/html`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${title || 'presentation'}.html`;
      a.click(); URL.revokeObjectURL(url);
    },
    restoreVersion: (id, versionId) => apiFetch(`/presentations/${id}/restore/${versionId}`, { method: 'POST' }),
    updateContent: (id, data) => apiFetch(`/presentations/${id}/content`, { method: 'PUT', body: data }),
    deleteSlide: (id, slideIndex) => apiFetch(`/presentations/${id}/slides/${slideIndex}`, { method: 'DELETE' }),
    duplicateSlide: (id, slideIndex) => apiFetch(`/presentations/${id}/slides/${slideIndex}/duplicate`, { method: 'POST' })
  },

  // ─── Images (Creative Studio) — backed by /api/creations?type=image ──────
  images: {
    status: () => apiFetch('/creations/status'),
    list: () => apiFetch('/creations?type=image'),
    get: (id) => apiFetch(`/creations/${id}`),
    create: (data = {}) => apiFetch('/creations', { method: 'POST', body: { type: 'image', ...data } }),
    update: (id, data) => apiFetch(`/creations/${id}`, { method: 'PUT', body: data }),
    delete: (id) => apiFetch(`/creations/${id}`, { method: 'DELETE' }),
    share: (id) => apiFetch(`/creations/${id}/share`, { method: 'POST' }),
    unshare: (id) => apiFetch(`/creations/${id}/share`, { method: 'DELETE' }),
    setCover: (id, assetId) => apiFetch(`/creations/${id}/cover`, { method: 'PUT', body: { assetId } }),
    favorite: (id, assetId, on) => apiFetch(`/creations/${id}/assets/${assetId}/favorite`, { method: 'PUT', body: { on } }),
    deleteAsset: (id, assetId) => apiFetch(`/creations/${id}/assets/${assetId}`, { method: 'DELETE' }),

    // Synchronous generation wrapped as a single-yield async generator so the
    // generationManager (built for SSE) drives it unchanged. Emits one {type:'done'}.
    generate: async function* (id, prompt, opts = {}, signal) {
      const res = await fetch(`${API_BASE}/creations/${id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, ...opts }),
        signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const e = new Error(err.error || `HTTP ${res.status}`);
        e.status = res.status; e.code = err.code; e.body = err;
        throw e;
      }
      const data = await res.json();
      yield { type: 'done', assets: data.assets || [] };
    },
  },

  // ─── Generic creations (story/voice/music) — /api/creations ─────────────
  creations: {
    status: () => apiFetch('/creations/status'),
    list: (type) => apiFetch(`/creations${type ? '?type=' + type : ''}`),
    get: (id) => apiFetch(`/creations/${id}`),
    create: (type, data = {}) => apiFetch('/creations', { method: 'POST', body: { type, ...data } }),
    update: (id, data) => apiFetch(`/creations/${id}`, { method: 'PUT', body: data }),
    delete: (id) => apiFetch(`/creations/${id}`, { method: 'DELETE' }),
    share: (id) => apiFetch(`/creations/${id}/share`, { method: 'POST' }),
    unshare: (id) => apiFetch(`/creations/${id}/share`, { method: 'DELETE' }),
    deleteAsset: (id, assetId) => apiFetch(`/creations/${id}/assets/${assetId}`, { method: 'DELETE' }),
    // Synchronous generation wrapped as a single-yield generator (drives genManager).
    generate: async function* (id, body = {}, signal) {
      const res = await fetch(`${API_BASE}/creations/${id}/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const e = new Error(err.error || `HTTP ${res.status}`);
        e.status = res.status; e.code = err.code; e.body = err;
        throw e;
      }
      const data = await res.json();
      yield { type: 'done', ...data };
    },
  },

  templates: {
    list: () => apiFetch('/templates'),
    get: (id) => apiFetch(`/templates/${id}`),
    create: (data) => apiFetch('/templates', { method: 'POST', body: data }),
    update: (id, data) => apiFetch(`/templates/${id}`, { method: 'PUT', body: data }),
    delete: (id) => apiFetch(`/templates/${id}`, { method: 'DELETE' }),
    share: (id, isPublic) => apiFetch(`/templates/${id}/share`, { method: 'PUT', body: { isPublic } }),
    analyzeFromPptx: async (file) => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE}/templates/from-pptx`, { method: 'POST', body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    }
  },

  ai: {
    status: () => apiFetch('/ai/status'),
    plan: (id, prompt, attachments = [], previousPlan = null) => apiFetch(`/ai/plan/${id}`, { method: 'POST', body: { prompt, attachments, previousPlan } }),
    analyze: (id) => apiFetch(`/ai/analyze/${id}`, { method: 'POST' }),
    suggest: (id, focusArea) => apiFetch(`/ai/suggest/${id}`, { method: 'POST', body: { focusArea } }),

    upload: async (file) => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE}/ai/upload`, { method: 'POST', body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    },

    // Streaming generation - returns AsyncGenerator
    generate: async function* (presentationId, prompt, attachments = [], signal, plan = null) {
      yield* readSseStream(`${API_BASE}/ai/generate/${presentationId}`, { prompt, attachments, plan }, signal);
    },

    editSlide: async function* (presentationId, slideIndex, prompt, signal) {
      yield* readSseStream(`${API_BASE}/ai/edit-slide/${presentationId}`, { slideIndex, prompt }, signal);
    },

    insertSlide: async function* (presentationId, afterIndex, prompt, signal, plan = null) {
      yield* readSseStream(`${API_BASE}/ai/insert-slide/${presentationId}`, { afterIndex, prompt, plan }, signal);
    }
  },

  settings: {
    get: () => apiFetch('/settings'),
    update: (data) => apiFetch('/settings', { method: 'PUT', body: data })
  },

  admin: {
    aiSettings: {
      get: () => apiFetch('/admin/ai-settings'),
      update: (data) => apiFetch('/admin/ai-settings', { method: 'PUT', body: data })
    },
    emailSettings: {
      get: () => apiFetch('/admin/email-settings'),
      update: (data) => apiFetch('/admin/email-settings', { method: 'PUT', body: data })
    },
    stripeSettings: {
      get: () => apiFetch('/admin/stripe-settings'),
      update: (data) => apiFetch('/admin/stripe-settings', { method: 'PUT', body: data })
    },
    setUserPlan: (userId, plan) => apiFetch(`/admin/users/${userId}/plan`, { method: 'PUT', body: { plan } }),
  },

  billing: {
    me: () => apiFetch('/billing/me'),
    checkout: (plan) => apiFetch('/billing/checkout', { method: 'POST', body: { plan } }),
    portal: () => apiFetch('/billing/portal', { method: 'POST' }),
  },

  auth: {
    setupNeeded: () => apiFetch('/auth/setup-needed'),
    setup: (data) => apiFetch('/auth/setup', { method: 'POST', body: data }),
    login: (data) => apiFetch('/auth/login', { method: 'POST', body: data }),
    register: (data) => apiFetch('/auth/register', { method: 'POST', body: data }),
    forgotPassword: (data) => apiFetch('/auth/forgot-password', { method: 'POST', body: data }),
    resetPassword: (data) => apiFetch('/auth/reset-password', { method: 'POST', body: data }),
    resendVerification: (data) => apiFetch('/auth/resend-verification', { method: 'POST', body: data }),
    logout: () => apiFetch('/auth/logout', { method: 'POST' }),
    me: () => apiFetch('/auth/me'),
    updateProfile: (data) => apiFetch('/auth/me', { method: 'PUT', body: data }),
    changePassword: (data) => apiFetch('/auth/me/password', { method: 'PUT', body: data }),
    users: {
      list: () => apiFetch('/auth/users'),
      create: (data) => apiFetch('/auth/users', { method: 'POST', body: data }),
      update: (id, data) => apiFetch(`/auth/users/${id}`, { method: 'PUT', body: data }),
      delete: (id) => apiFetch(`/auth/users/${id}`, { method: 'DELETE' }),
      resetPassword: (id, password) => apiFetch(`/auth/users/${id}/password`, { method: 'PUT', body: { password } }),
      changeRole: (id, role) => apiFetch(`/auth/users/${id}/role`, { method: 'PUT', body: { role } }),
      toggleActive: (id) => apiFetch(`/auth/users/${id}/active`, { method: 'PUT' }),
    }
  },

  shares: {
    list: (presentationId) => apiFetch(`/presentations/${presentationId}/user-shares`),
    set: (presentationId, userId, permission) => apiFetch(`/presentations/${presentationId}/user-shares/${userId}`, { method: 'PUT', body: { permission } }),
    remove: (presentationId, userId) => apiFetch(`/presentations/${presentationId}/user-shares/${userId}`, { method: 'DELETE' }),
  }
};
