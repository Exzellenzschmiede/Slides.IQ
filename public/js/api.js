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
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const contentType = res.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) return res.json();
  if (contentType.includes('application/pdf')) return res.blob();
  return res.text();
}

// ─── Presentations ─────────────────────────────────────────────────────────

async function* readSseStream(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
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

  templates: {
    list: () => apiFetch('/templates'),
    get: (id) => apiFetch(`/templates/${id}`),
    create: (data) => apiFetch('/templates', { method: 'POST', body: data }),
    update: (id, data) => apiFetch(`/templates/${id}`, { method: 'PUT', body: data }),
    delete: (id) => apiFetch(`/templates/${id}`, { method: 'DELETE' }),
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
    generate: async function* (presentationId, prompt, attachments = []) {
      yield* readSseStream(`${API_BASE}/ai/generate/${presentationId}`, { prompt, attachments });
    },

    editSlide: async function* (presentationId, slideIndex, prompt) {
      yield* readSseStream(`${API_BASE}/ai/edit-slide/${presentationId}`, { slideIndex, prompt });
    },

    insertSlide: async function* (presentationId, afterIndex, prompt) {
      yield* readSseStream(`${API_BASE}/ai/insert-slide/${presentationId}`, { afterIndex, prompt });
    }
  },

  settings: {
    get: () => apiFetch('/settings'),
    update: (data) => apiFetch('/settings', { method: 'PUT', body: data })
  }
};
