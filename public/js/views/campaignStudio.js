// ─── Campaign Studio — the Orchestrator ────────────────────────────────────
// One brief → a coordinated campaign (brand → deck → images → copy → voice).

import { api } from '../api.js';
import { navigate } from '../router.js';
import { showConfirmModal } from '../components/modal.js';
import { toastSuccess, toastError } from '../components/toast.js';
import { genManager } from '../generationManager.js';
import { t } from '../i18n.js';

let creation = null;
let isGenerating = false;
const STEPS = ['brand', 'deck', 'images', 'copy', 'voice'];
let stepState = {};
let _watchingJobIds = [];
let _navAwayHandler = null;
let _doneListener = null, _errorListener = null, _progressListener = null;

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _watchJob(jobId) {
  genManager.setCardVisible(jobId, false);
  _watchingJobIds.push(jobId);
  if (_navAwayHandler) return;
  const handler = () => { _watchingJobIds.forEach(id => genManager.setCardVisible(id, true)); _watchingJobIds = []; _navAwayHandler = null; window.removeEventListener('hashchange', handler); };
  _navAwayHandler = handler;
  window.addEventListener('hashchange', handler);
}

export async function renderCampaignStudio(container, { id }) {
  if (!id) { navigate('campaigns'); return; }
  isGenerating = false;
  _watchingJobIds = [];
  if (_navAwayHandler) { window.removeEventListener('hashchange', _navAwayHandler); _navAwayHandler = null; }

  creation = await api.creations.get(id);

  container.classList.add('studio-mode');
  container.innerHTML = `
  <div class="studio-wrapper">
    <div class="studio-header" style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <button class="studio-back-btn" onclick="window.history.back()" title="${t('imageStudio.back')}">←</button>
      <div style="flex:1;min-width:0">
        <div class="presentation-card-title" style="font-size:18px">${escHtml(creation.title)}</div>
        <div class="text-xs text-muted">${t('campaignStudio.libTitle')}</div>
      </div>
      <div class="studio-dropdown">
        <button class="btn btn-ghost btn-sm studio-dropdown-trigger">⋯</button>
        <div class="studio-dropdown-menu">
          <button class="studio-dropdown-item" id="btn-delete">${t('imageStudio.delete')}</button>
        </div>
      </div>
    </div>
    <div id="campaign-body"></div>
  </div>`;

  bindHeader();
  bindGenEvents();
  renderState();

  const active = genManager.getActiveForPresentation(creation.id);
  if (active.length) { isGenerating = true; STEPS.forEach(s => stepState[s] = stepState[s] || 'pending'); active.forEach(j => _watchJob(j.id)); renderStepper(); }

  const seed = sessionStorage.getItem('campaignStudioSeedPrompt');
  if (seed) { sessionStorage.removeItem('campaignStudioSeedPrompt'); const i = document.getElementById('campaign-brief'); if (i) i.value = seed; }
}

function hasResult() {
  return !!(creation.parameters && creation.parameters.brand);
}

function renderState() {
  if (isGenerating) { renderStepper(); return; }
  if (hasResult()) { renderBoard(); return; }
  renderBriefForm();
}

// ── Brief form ──
function renderBriefForm() {
  const body = document.getElementById('campaign-body');
  const chips = (t('campaignStudio.welcomeChips') || []).map(c => `<button class="question-chip" data-seed="${escHtml(c)}">${escHtml(c)}</button>`).join('');
  body.innerHTML = `
    <div class="card" style="max-width:720px;margin:0 auto">
      <div style="font-size:15px;font-weight:600;margin-bottom:6px">${t('campaignStudio.welcome')}</div>
      <div class="question-chips" style="margin-bottom:14px">${chips}</div>
      <textarea class="form-input" id="campaign-brief" rows="4" placeholder="${t('campaignStudio.briefPlaceholder')}"></textarea>
      <button class="btn btn-primary" id="campaign-generate" style="margin-top:14px">✦ ${t('campaignStudio.generateBtn')}</button>
    </div>`;
  body.querySelectorAll('[data-seed]').forEach(b => b.addEventListener('click', () => { const i = document.getElementById('campaign-brief'); i.value = b.dataset.seed; i.focus(); }));
  document.getElementById('campaign-generate').addEventListener('click', () => {
    generate(document.getElementById('campaign-brief').value);
  });
}

// ── Stepper ──
function renderStepper() {
  const body = document.getElementById('campaign-body');
  const icon = (st) => st === 'done' ? '✓' : st === 'failed' ? '✕' : st === 'running' ? '<span class="gen-dots"><span></span><span></span><span></span></span>' : '○';
  body.innerHTML = `
    <div class="card" style="max-width:640px;margin:0 auto">
      <div style="font-size:15px;font-weight:600;margin-bottom:16px">${t('campaignStudio.generating')}</div>
      <div class="campaign-stepper">
        ${STEPS.map(s => {
          const st = stepState[s] || 'pending';
          return `<div class="campaign-step campaign-step-${st}">
            <span class="campaign-step-icon">${icon(st)}</span>
            <span class="campaign-step-label">${t('campaignStudio.steps.' + s)}</span>
            <span class="campaign-step-status">${t('campaignStudio.stepStatus.' + st)}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

// ── Board ──
async function renderBoard() {
  const body = document.getElementById('campaign-body');
  const brand = creation.parameters.brand || {};
  const artifacts = creation.parameters.artifacts || {};
  const p = brand.palette || {};
  const anyFailed = Object.values(artifacts).some(a => a && a.status === 'failed');

  body.innerHTML = `
    <div class="campaign-board">
      <div class="campaign-brand-header card" style="--c-primary:${escHtml(p.primary || '#7c3aed')};--c-accent:${escHtml(p.accent || '#06b6d4')};--c-bg:${escHtml(p.bg || '#05070f')}">
        <div class="campaign-brand-name">${escHtml(brand.name || '')}</div>
        <div class="campaign-brand-tagline">${escHtml(brand.tagline || '')}</div>
        <div class="campaign-brand-meta">
          <div class="campaign-swatches">
            <span class="campaign-swatch" style="background:${escHtml(p.primary || '')}" title="${escHtml(p.primary || '')}"></span>
            <span class="campaign-swatch" style="background:${escHtml(p.accent || '')}" title="${escHtml(p.accent || '')}"></span>
            <span class="campaign-swatch" style="background:${escHtml(p.bg || '')}" title="${escHtml(p.bg || '')}"></span>
          </div>
          ${brand.font ? `<span class="campaign-chip">${t('campaignStudio.font')}: ${escHtml(brand.font)}</span>` : ''}
          ${brand.tone ? `<span class="campaign-chip">${t('campaignStudio.tone')}: ${escHtml(brand.tone)}</span>` : ''}
          ${brand.audience ? `<span class="campaign-chip">${t('campaignStudio.audience')}: ${escHtml(brand.audience)}</span>` : ''}
        </div>
        ${(brand.keyMessages && brand.keyMessages.length) ? `<div class="campaign-keymsgs">${brand.keyMessages.map(m => `<span class="campaign-chip">${escHtml(m)}</span>`).join('')}</div>` : ''}
      </div>

      ${anyFailed ? `<div class="campaign-partial">${t('campaignStudio.partialNotice')}</div>` : ''}

      <div id="campaign-deck"></div>
      <div id="campaign-images"></div>
      <div id="campaign-copy"></div>
      <div id="campaign-voice"></div>
    </div>`;

  renderDeck(artifacts.deck);
  renderImages(artifacts.images);
  renderCopy(artifacts.copy);
  renderVoice(artifacts.voice);
}

function sectionFailed(host, headingKey, art) {
  host.innerHTML = `<div class="campaign-section card"><div class="campaign-section-head">${t(headingKey)}</div>
    <div class="text-sm text-muted">${escHtml(art?.error || t('campaignStudio.errorGenerate', { msg: '—' }))}</div></div>`;
}

function renderDeck(art) {
  const host = document.getElementById('campaign-deck');
  if (!art || art.status !== 'done') { if (art) sectionFailed(host, 'campaignStudio.deckHeading', art); return; }
  host.innerHTML = `
    <div class="campaign-section card">
      <div class="campaign-section-head">${t('campaignStudio.deckHeading')}
        <a class="btn btn-ghost btn-sm" href="#studio/${escHtml(art.artifactId)}" style="margin-left:auto">${t('campaignStudio.openInStudio')} →</a>
      </div>
      <div class="campaign-deck-frame">
        <iframe src="/api/presentations/${escHtml(art.artifactId)}/content-preview" sandbox="allow-scripts allow-same-origin" loading="lazy"></iframe>
      </div>
    </div>`;
}

async function renderImages(art) {
  const host = document.getElementById('campaign-images');
  if (!art || art.status !== 'done') { if (art) sectionFailed(host, 'campaignStudio.imagesHeading', art); return; }
  let child;
  try { child = await api.creations.get(art.artifactId); } catch { return; }
  const assets = (child.assets || []);
  host.innerHTML = `
    <div class="campaign-section card">
      <div class="campaign-section-head">${t('campaignStudio.imagesHeading')}
        <a class="btn btn-ghost btn-sm" href="#image-studio/${escHtml(art.artifactId)}" style="margin-left:auto">${t('campaignStudio.openInStudio')} →</a>
      </div>
      <div class="campaign-image-grid">
        ${assets.map(a => `<a href="#image-studio/${escHtml(art.artifactId)}" class="campaign-image-tile"><img src="${a.url}" loading="lazy" alt=""></a>`).join('')}
      </div>
    </div>`;
}

async function renderCopy(art) {
  const host = document.getElementById('campaign-copy');
  if (!art || art.status !== 'done') { if (art) sectionFailed(host, 'campaignStudio.copyHeading', art); return; }
  let child;
  try { child = await api.creations.get(art.artifactId); } catch { return; }
  const text = (child.parameters && child.parameters.content) || '';
  host.innerHTML = `
    <div class="campaign-section card">
      <div class="campaign-section-head">${t('campaignStudio.copyHeading')}
        <a class="btn btn-ghost btn-sm" href="#story-studio/${escHtml(art.artifactId)}" style="margin-left:auto">${t('campaignStudio.openInStudio')} →</a>
      </div>
      <div class="campaign-copy-text">${escHtml(text).replace(/\n/g, '<br>')}</div>
    </div>`;
}

async function renderVoice(art) {
  const host = document.getElementById('campaign-voice');
  if (!art || art.status !== 'done') { if (art) sectionFailed(host, 'campaignStudio.voiceHeading', art); return; }
  let child;
  try { child = await api.creations.get(art.artifactId); } catch { return; }
  const asset = (child.assets || [])[0];
  host.innerHTML = `
    <div class="campaign-section card">
      <div class="campaign-section-head">${t('campaignStudio.voiceHeading')}
        <a class="btn btn-ghost btn-sm" href="#voice-studio/${escHtml(art.artifactId)}" style="margin-left:auto">${t('campaignStudio.openInStudio')} →</a>
      </div>
      ${asset ? `<audio controls preload="none" src="${asset.url}" style="width:100%"></audio>` : ''}
    </div>`;
}

// ── Generation ──
function generate(brief) {
  if (isGenerating) return;
  brief = (brief || '').trim();
  if (!brief) return;
  isGenerating = true;
  stepState = {}; STEPS.forEach(s => stepState[s] = 'pending');
  renderStepper();
  const jobId = genManager.start({
    presentationId: creation.id, module: 'campaign', title: creation.title,
    label: t('campaignStudio.generating'), type: 'campaign',
    openHref: `#campaign-studio/${creation.id}`, doneLabel: t('campaignStudio.doneLabel'),
    apiCall: (signal) => api.creations.orchestrate(creation.id, { brief }, signal),
  });
  _watchJob(jobId);
}

function bindGenEvents() {
  if (_progressListener) window.removeEventListener('genmanager:progress', _progressListener);
  if (_doneListener) window.removeEventListener('genmanager:done', _doneListener);
  if (_errorListener) window.removeEventListener('genmanager:error', _errorListener);

  _progressListener = (e) => {
    if (e.detail.presentationId !== creation?.id || !e.detail.progress) return;
    const pr = e.detail.progress;
    if (pr.step) { stepState[pr.step] = pr.status; renderStepper(); }
  };
  _doneListener = async (e) => {
    if (e.detail.presentationId !== creation?.id) return;
    isGenerating = false;
    try { creation = await api.creations.get(creation.id); } catch (_) {}
    renderState();
  };
  _errorListener = (e) => {
    if (e.detail.presentationId !== creation?.id) return;
    isGenerating = false;
    const info = e.detail.limitInfo;
    if (info && (info.code === 'feature_locked' || String(info.code || '').includes('quota'))) { toastError(e.detail.error || '?'); navigate('settings'); }
    else { toastError(t('campaignStudio.errorGenerate', { msg: e.detail.error || '?' })); renderState(); }
  };
  window.addEventListener('genmanager:progress', _progressListener);
  window.addEventListener('genmanager:done', _doneListener);
  window.addEventListener('genmanager:error', _errorListener);
}

function bindHeader() {
  document.querySelectorAll('.studio-dropdown-trigger').forEach(tr => tr.addEventListener('click', (e) => {
    e.stopPropagation(); const d = tr.closest('.studio-dropdown');
    document.querySelectorAll('.studio-dropdown.open').forEach(x => { if (x !== d) x.classList.remove('open'); });
    d.classList.toggle('open');
  }));
  document.addEventListener('click', () => document.querySelectorAll('.studio-dropdown.open').forEach(d => d.classList.remove('open')));
  document.getElementById('btn-delete')?.addEventListener('click', () => {
    showConfirmModal(t('campaignStudio.confirmDelete'), t('campaignStudio.confirmDeleteMsg'), {
      confirmLabel: t('common.delete', { defaultValue: 'Löschen' }), danger: true,
      onConfirm: async () => { try { await api.creations.delete(creation.id); toastSuccess(t('campaignStudio.deleted')); navigate('campaigns'); } catch (err) { toastError(err.message); } },
    });
  });
}
