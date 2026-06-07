// ─── Global Generation Manager ────────────────────────────────────────────
// Manages SSE generation jobs that survive view navigation.
// Emits window events: genmanager:progress, genmanager:done, genmanager:error

import { api } from './api.js';

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

class GenerationManager {
  constructor() {
    this._jobs = new Map();
    this._container = null;
  }

  _ensureContainer() {
    if (this._container && document.body.contains(this._container)) return;
    this._container = document.createElement('div');
    this._container.id = 'gen-toast-stack';
    this._container.className = 'gen-toast-stack';
    document.body.appendChild(this._container);
  }

  // Start a generation job.
  // config: { presentationId, title, label, type, module, openHref, doneLabel, meta, apiCall }
  // module: 'presentation' (default) | 'image' — controls the done-card link/label.
  // apiCall: (signal) => AsyncIterator<SSE event>
  // Returns jobId
  start({ presentationId, title, label, type = 'generate', module = 'presentation', openHref = null, doneLabel = null, meta = {}, apiCall }) {
    this._ensureContainer();

    const id = crypto.randomUUID();
    const controller = new AbortController();

    const job = {
      id, presentationId, title, label, type, module, openHref, doneLabel, meta,
      status: 'running',
      chars: 0,
      liveHtml: '',
      slideCount: null,
      newIndex: null,
      assets: null,
      error: null,
      controller,
      cardEl: null,
    };

    this._jobs.set(id, job);
    job.cardEl = this._createCard(job);
    this._container.appendChild(job.cardEl);

    this._run(job, apiCall).catch(() => {});
    return id;
  }

  cancel(jobId) {
    const job = this._jobs.get(jobId);
    if (job?.status === 'running') {
      job.controller.abort();
    }
  }

  getJob(jobId) {
    return this._jobs.get(jobId);
  }

  getActiveForPresentation(presentationId) {
    return [...this._jobs.values()].filter(
      j => j.presentationId === presentationId && j.status === 'running'
    );
  }

  // Hide or show the floating toast card for a job.
  // Call with hidden=true when a studio view is watching the job directly,
  // restore with hidden=false when the user navigates away.
  setCardVisible(jobId, visible) {
    const job = this._jobs.get(jobId);
    if (!job?.cardEl) return;
    job.cardEl.style.display = visible ? '' : 'none';
  }

  async _run(job, apiCall) {
    try {
      for await (const event of apiCall(job.controller.signal)) {
        if (event.type === 'chunk') {
          job.chars += event.text.length;
          job.liveHtml += event.text;
          this._updateCard(job);
          window.dispatchEvent(new CustomEvent('genmanager:progress', {
            detail: { jobId: job.id, presentationId: job.presentationId, chars: job.chars, liveHtml: job.liveHtml }
          }));
        } else if (event.type === 'progress') {
          // Step-progress from a multi-stage job (e.g. campaign orchestrator).
          job.lastProgress = event;
          window.dispatchEvent(new CustomEvent('genmanager:progress', {
            detail: { jobId: job.id, presentationId: job.presentationId, progress: event }
          }));
        } else if (event.type === 'done') {
          if (event.slide_count != null) job.slideCount = event.slide_count;
          if (event.new_index != null) job.newIndex = event.new_index;
          if (event.assets != null) job.assets = event.assets;
          if (event.manifest != null) job.manifest = event.manifest;
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
        // 'start' and other event types are ignored (no-op).
      }
      job.status = 'done';
      this._updateCard(job);
      window.dispatchEvent(new CustomEvent('genmanager:done', { detail: this._jobDetail(job) }));
      setTimeout(() => this._dismissCard(job), 6000);
    } catch (err) {
      job.status = err.name === 'AbortError' ? 'cancelled' : 'error';
      job.error = err.name === 'AbortError' ? null : err.message;
      // Capture entitlement limit info (402/403) so the UI can show an upgrade prompt.
      if (err.status === 402 || err.status === 403) job.limitInfo = err.body || { code: err.code };
      this._updateCard(job);
      window.dispatchEvent(new CustomEvent('genmanager:error', { detail: this._jobDetail(job) }));
      setTimeout(() => this._dismissCard(job), 8000);
    }
  }

  _jobDetail(job) {
    return {
      jobId: job.id,
      presentationId: job.presentationId,
      title: job.title,
      type: job.type,
      module: job.module,
      meta: job.meta,
      slideCount: job.slideCount,
      newIndex: job.newIndex,
      assets: job.assets,
      manifest: job.manifest || null,
      error: job.error,
      status: job.status,
      limitInfo: job.limitInfo || null,
    };
  }

  _createCard(job) {
    const card = document.createElement('div');
    card.className = 'gen-toast-card';
    card.dataset.jobId = job.id;
    this._renderCard(card, job);
    return card;
  }

  _updateCard(job) {
    if (!job.cardEl) return;
    this._renderCard(job.cardEl, job);
    job.cardEl.className = `gen-toast-card gen-toast-${job.status}`;
  }

  _renderCard(card, job) {
    const titleShort = job.title.length > 26 ? job.title.slice(0, 26) + '…' : job.title;

    let body = '';
    if (job.status === 'running') {
      const chars = job.chars > 0 ? `<span class="gen-toast-chars">${job.chars.toLocaleString()} Zeichen</span>` : '';
      body = `
        <div class="gen-toast-header">
          <span class="gen-toast-title">${esc(titleShort)}</span>
          <button class="gen-toast-x" data-action="cancel" title="Abbrechen">✕</button>
        </div>
        <div class="gen-toast-body">
          <div class="gen-toast-dots"><span></span><span></span><span></span></div>
          <span class="gen-toast-label">${esc(job.label)}</span>
          ${chars}
        </div>`;
    } else if (job.status === 'done') {
      let info;
      if (job.doneLabel) info = job.doneLabel;
      else if (job.module === 'image') info = `${(job.assets?.length ?? 0)} Bild(er) fertig`;
      else info = job.slideCount != null ? `${job.slideCount} Slides fertig` : 'Fertig';
      const href = job.openHref || (job.module === 'image'
        ? `#image-studio/${esc(job.presentationId)}`
        : `#studio/${esc(job.presentationId)}`);
      body = `
        <div class="gen-toast-header gen-toast-header-done">
          <span class="gen-toast-title">✓ ${esc(titleShort)}</span>
          <button class="gen-toast-x" data-action="dismiss" title="Schließen">✕</button>
        </div>
        <div class="gen-toast-body">
          <span class="gen-toast-label">${info}</span>
          <a class="gen-toast-open" href="${href}">Öffnen →</a>
        </div>`;
    } else if (job.status === 'error') {
      body = `
        <div class="gen-toast-header gen-toast-header-error">
          <span class="gen-toast-title">✗ ${esc(titleShort)}</span>
          <button class="gen-toast-x" data-action="dismiss" title="Schließen">✕</button>
        </div>
        <div class="gen-toast-body">
          <span class="gen-toast-label gen-toast-error-msg">${esc(job.error || 'Fehler')}</span>
        </div>`;
    } else {
      body = `
        <div class="gen-toast-header">
          <span class="gen-toast-title gen-toast-muted">Abgebrochen</span>
          <button class="gen-toast-x" data-action="dismiss" title="Schließen">✕</button>
        </div>
        <div class="gen-toast-body">
          <span class="gen-toast-label">${esc(titleShort)}</span>
        </div>`;
    }

    card.innerHTML = body;
    card.querySelector('[data-action="cancel"]')?.addEventListener('click', () => this.cancel(job.id));
    card.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => this._dismissCard(job));
  }

  _dismissCard(job) {
    if (!job.cardEl) return;
    job.cardEl.classList.add('gen-toast-out');
    setTimeout(() => {
      job.cardEl?.remove();
      job.cardEl = null;
      this._jobs.delete(job.id);
    }, 300);
  }
}

export const genManager = new GenerationManager();

// Warn before page unload if jobs are active
window.addEventListener('beforeunload', (e) => {
  const running = [...genManager._jobs.values()].filter(j => j.status === 'running');
  if (running.length > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});
