'use strict';

// ─── Creations router (Creative Studio) ────────────────────────────────────
// Unified, keyed on `type` (image now; audio/voice/story later). Mounted at
// /api/creations behind requireAuth. Image generation is synchronous (single
// JSON response) — no SSE, since the provider returns all bytes in one call.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { v4: uuid } = require('uuid');
const QRCode = require('qrcode');
const db = require('../database');
const { getBaseUrl } = require('../services/appSettings');
const ent = require('../services/entitlements');
const imageGenerator = require('../services/imageGenerator');
const audioGenerator = require('../services/audioGenerator');
const aiProvider = require('../services/aiProvider');
const assetStore = require('../services/assetStore');

// Supported creation types and the feature flag each requires.
const TYPE_FEATURE = { image: 'imageStudio', story: 'storyStudio', voice: 'audioStudio', music: 'audioStudio' };

const DEFAULT_TITLES = {
  image: 'Neues Bildprojekt', story: 'Neue Story', voice: 'Neues Voiceover', music: 'Neuer Sound',
};

// Upgrade suggestion (mirror middleware/entitlements upgradeInfo).
const NEXT_TIER = { free: 'pro', pro: 'business', business: 'business' };

const router = express.Router();

// Generation is the only expensive endpoint — rate-limit it (10/min, like AI).
const imageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Zu viele Bild-Anfragen. Bitte kurz warten.' },
});

// ─── Provider settings (Admin-managed, never env) ──────────────────────────

function getGlobalPrefs() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'preferences' AND user_id = ''").get();
  return row ? JSON.parse(row.value) : {};
}

function getImageProviderSettings() {
  const prefs = getGlobalPrefs();
  const provider = prefs.imageProvider || 'openai';
  const providerPrefs = (prefs.imageProviders || {})[provider] || {};
  const model = providerPrefs.model || imageGenerator.DEFAULT_IMAGE_MODELS[provider];
  const apiKey = providerPrefs.apiKey || '';
  return { provider, model, apiKey };
}

// Audio provider for Voice / Music studios. Each studio has its own group
// (voice* / music*), falling back to the legacy shared audio* group.
function getAudioProviderSettings(group) {
  const prefs = getGlobalPrefs();
  const provider = prefs[group + 'Provider'] || prefs.audioProvider || 'elevenlabs';
  const cfg = (prefs[group + 'Providers'] || prefs.audioProviders || {})[provider] || {};
  // The unified UI stores the selected model in cfg.model; map it to the
  // provider-specific field the audioGenerator expects.
  return { provider, apiKey: cfg.apiKey || '', voiceId: cfg.voiceId, model: cfg.model, ttsModel: cfg.model || cfg.ttsModel, musicModel: cfg.model || cfg.musicModel };
}

// Text generation provider (Story studio) — its own group, fallback to the
// presentation AI (ai*) group for a smooth migration.
function getTextProviderSettings() {
  const prefs = getGlobalPrefs();
  const provider = prefs.storyProvider || prefs.aiProvider || 'anthropic';
  const cfg = (prefs.storyProviders || prefs.aiProviders || {})[provider] || {};
  const model = cfg.model || aiProvider.DEFAULT_MODELS[provider];
  return { provider, model, apiKey: cfg.apiKey || '' };
}

const NO_KEY_MSG = (provider) =>
  `Kein API-Key für ${provider} konfiguriert. Bitte hinterlege ihn im Admin-Bereich.`;

// Inline entitlement gates (one /generate route serves all types).
function denyFeature(res, userId, type) {
  const flag = TYPE_FEATURE[type];
  if (ent.hasFeature(userId, flag)) return false;
  const plan = ent.getPlanForUser(userId);
  res.status(403).json({
    error: 'Diese Funktion ist in deinem Tarif nicht enthalten.',
    code: 'feature_locked', feature: flag, plan: plan.id,
    upgrade: { to: NEXT_TIER[plan.id] || 'pro' },
  });
  return true;
}

function denyQuota(res, r) {
  if (r.ok) return false;
  res.status(402).json({
    error: `Monatliches Limit erreicht (${r.used}/${r.limit}).`,
    code: r.code, limit: r.limit, used: r.used, plan: r.plan,
    upgrade: { to: NEXT_TIER[r.plan] || 'pro' },
  });
  return true;
}

// ─── Access helpers (v1: owner-only; public access via share_token) ─────────

function getOwner(id) {
  const row = db.prepare('SELECT user_id FROM creations WHERE id = ?').get(id);
  return row ? row.user_id : undefined;
}

// Returns the access level ('owner') or null; sends 404/403 and returns null.
function assertOwner(req, res) {
  const owner = getOwner(req.params.id);
  if (owner === undefined) { res.status(404).json({ error: 'Nicht gefunden' }); return false; }
  if (owner !== req.session.userId) { res.status(403).json({ error: 'Keine Berechtigung' }); return false; }
  return true;
}

// ─── Serialization ──────────────────────────────────────────────────────────

function assetUrl(creationId, assetId) {
  return `/api/creations/${creationId}/assets/${assetId}`;
}

function listAssets(creationId) {
  return db.prepare('SELECT * FROM creation_assets WHERE creation_id = ? ORDER BY position ASC, created_at ASC').all(creationId);
}

function serializeAsset(a, creationId) {
  return {
    id: a.id,
    url: assetUrl(creationId, a.id),
    kind: a.kind,
    width: a.width,
    height: a.height,
    duration_ms: a.duration_ms,
    mime_type: a.mime_type,
    prompt: a.prompt,
    seed: a.seed,
    position: a.position,
    is_favorite: !!a.is_favorite,
    created_at: a.created_at,
  };
}

function serializeCreation(row, { withAssets = false } = {}) {
  if (!row) return null;
  const assets = listAssets(row.id);
  const cover = assets.find(a => a.id === row.cover_asset_id) || assets[0] || null;
  const base = {
    id: row.id,
    type: row.type,
    title: row.title,
    prompt: row.prompt,
    provider: row.provider,
    model: row.model,
    cover_asset_id: row.cover_asset_id,
    cover_url: cover ? assetUrl(row.id, cover.id) : null,
    asset_count: assets.length,
    parameters: JSON.parse(row.parameters || '{}'),
    tags: JSON.parse(row.tags || '[]'),
    share_token: row.share_token,
    view_count: row.view_count,
    user_id: row.user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (withAssets) {
    base.conversation = JSON.parse(row.conversation || '[]');
    base.versions = JSON.parse(row.versions || '[]');
    base.assets = assets.map(a => serializeAsset(a, row.id));
  }
  return base;
}

// ─── Status (mirror /api/ai/status) ─────────────────────────────────────────

router.get('/status', (req, res) => {
  const { provider, model, apiKey } = getImageProviderSettings();
  res.json({ hasApiKey: !!apiKey, provider, model });
});

// ─── List ─────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const { type } = req.query;
  const userId = req.session.userId;
  let query = 'SELECT * FROM creations WHERE user_id = ?';
  const params = [userId];
  if (type) { query += ' AND type = ?'; params.push(type); }
  query += ' ORDER BY updated_at DESC';
  const rows = db.prepare(query).all(...params);
  res.json(rows.map(r => serializeCreation(r)));
});

// ─── Create (empty project) ─────────────────────────────────────────────────

router.post('/', (req, res) => {
  const { type = 'image', title } = req.body || {};
  if (!TYPE_FEATURE[type]) return res.status(400).json({ error: 'Nicht unterstützter Typ' });
  const id = uuid();
  db.prepare(`
    INSERT INTO creations (id, type, title, user_id)
    VALUES (?, ?, ?, ?)
  `).run(id, type, (title && title.trim()) || DEFAULT_TITLES[type], req.session.userId);
  const row = db.prepare('SELECT * FROM creations WHERE id = ?').get(id);
  res.status(201).json(serializeCreation(row, { withAssets: true }));
});

// ─── Get one ─────────────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  if (!assertOwner(req, res)) return;
  const row = db.prepare('SELECT * FROM creations WHERE id = ?').get(req.params.id);
  res.json(serializeCreation(row, { withAssets: true }));
});

// ─── Generate (synchronous; dispatches by creation type) ────────────────────

router.post('/:id/generate', imageLimiter, async (req, res) => {
  if (!assertOwner(req, res)) return;
  const row = db.prepare('SELECT * FROM creations WHERE id = ?').get(req.params.id);
  const userId = req.session.userId;

  if (denyFeature(res, userId, row.type)) return;

  try {
    if (row.type === 'image') return await handleImage(req, res, row, userId);
    if (row.type === 'story') return await handleStory(req, res, row, userId);
    if (row.type === 'voice' || row.type === 'music') return await handleAudio(req, res, row, userId);
    return res.status(400).json({ error: 'Nicht unterstützter Typ' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Append a generation to conversation + versions and persist core fields.
function persistGeneration(row, { prompt, assistantContent, assetIds = [], provider, model, parameters, coverId }) {
  const conversation = JSON.parse(row.conversation || '[]');
  conversation.push({ role: 'user', content: prompt });
  conversation.push({ role: 'assistant', content: assistantContent, assetIds });
  const versions = JSON.parse(row.versions || '[]');
  versions.unshift({ id: uuid(), timestamp: new Date().toISOString(), prompt, assetIds, content: assistantContent, label: `v${versions.length + 1}` });
  db.prepare(`
    UPDATE creations SET prompt = ?, provider = ?, model = ?, parameters = ?, conversation = ?, versions = ?,
      cover_asset_id = COALESCE(cover_asset_id, ?), updated_at = datetime('now') WHERE id = ?
  `).run(prompt, provider, model, JSON.stringify(parameters || {}),
    JSON.stringify(conversation.slice(-40)), JSON.stringify(versions.slice(0, 20)), coverId || null, row.id);
}

async function handleImage(req, res, row, userId) {
  if (denyQuota(res, ent.canGenerateImage(userId))) return;
  const { prompt, style, aspect = '1:1', count } = req.body || {};
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt erforderlich' });
  const n = Math.max(1, Math.min(parseInt(count, 10) || 1, 4));
  const { provider, model, apiKey } = getImageProviderSettings();
  if (!apiKey) return res.status(400).json({ error: NO_KEY_MSG(provider) });

  const size = imageGenerator.sizeForAspect(aspect);
  const effectivePrompt = style ? `${prompt.trim()}\n\nStil: ${style}.` : prompt.trim();
  const result = await imageGenerator.generateImage({ provider, apiKey, model, prompt: effectivePrompt, size, n });

  const existing = db.prepare('SELECT COUNT(*) AS c FROM creation_assets WHERE creation_id = ?').get(row.id).c;
  const insertAsset = db.prepare(`
    INSERT INTO creation_assets (id, creation_id, kind, file_path, mime_type, width, height, bytes, prompt, seed, position)
    VALUES (?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const savedAssets = [];
  result.assets.forEach((a, i) => {
    const { filePath, bytes } = assetStore.saveBuffer(a.buffer, a.mimeType);
    const assetId = uuid();
    insertAsset.run(assetId, row.id, filePath, a.mimeType, a.width, a.height, bytes, effectivePrompt, a.seed, existing + i);
    savedAssets.push({ id: assetId, url: assetUrl(row.id, assetId), width: a.width, height: a.height });
  });
  persistGeneration(row, {
    prompt: prompt.trim(), assistantContent: `${savedAssets.length} Bild(er) generiert`,
    assetIds: savedAssets.map(a => a.id), provider: result.provider, model: result.model,
    parameters: { style: style || null, aspect, count: n, size }, coverId: savedAssets[0]?.id,
  });
  ent.incrementUsage(userId, 'image_generations');
  res.json({ assets: savedAssets });
}

const STORY_SYSTEM = `Du bist ein meisterhafter Autor und Storyteller. Schreibe fesselnde, gut strukturierte Texte in der gewünschten Form (Geschichte, Skript, Blogpost, Werbetext, Gedicht …). Achte auf klare Struktur, lebendige Sprache und den passenden Ton. Gib NUR den Text zurück (Markdown erlaubt), keine Vorrede.`;

async function handleStory(req, res, row, userId) {
  if (denyQuota(res, ent.canGenerate(userId))) return;
  const { prompt, format, tone, length } = req.body || {};
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt erforderlich' });
  const { provider, model, apiKey } = getTextProviderSettings();
  if (!apiKey) return res.status(400).json({ error: NO_KEY_MSG(provider) });

  const directives = [
    format ? `Form: ${format}.` : '',
    tone ? `Ton: ${tone}.` : '',
    length ? `Länge: ${length}.` : '',
  ].filter(Boolean).join(' ');
  const prior = JSON.parse(row.conversation || '[]').slice(-8);
  const messages = [...prior.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: `${directives}\n\n${prompt.trim()}`.trim() }];

  const text = await aiProvider.generateText({ provider, apiKey, model, messages, systemPrompt: STORY_SYSTEM });

  persistGeneration(row, {
    prompt: prompt.trim(), assistantContent: text, provider, model,
    parameters: { format: format || null, tone: tone || null, length: length || null, content: text },
  });
  ent.incrementUsage(userId, 'ai_generations');
  res.json({ content: text });
}

async function handleAudio(req, res, row, userId) {
  if (denyQuota(res, ent.canGenerateAudio(userId))) return;
  const { prompt, mode, durationSeconds, voiceId } = req.body || {};
  const text = (prompt || '').trim();
  if (!text) return res.status(400).json({ error: 'Text/Prompt erforderlich' });

  // voice → TTS; music type carries mode 'music' (default) or 'sound'.
  const genMode = row.type === 'voice' ? 'voice' : (mode === 'sound' ? 'sound' : 'music');
  const { provider, apiKey, voiceId: defVoice, ttsModel, musicModel } = getAudioProviderSettings(row.type === 'voice' ? 'voice' : 'music');
  if (!apiKey) return res.status(400).json({ error: NO_KEY_MSG(provider) });

  const result = await audioGenerator.generateAudio({
    mode: genMode, provider, apiKey, text,
    voiceId: voiceId || defVoice, ttsModel, musicModel,
    durationSeconds: durationSeconds ? parseFloat(durationSeconds) : undefined,
  });

  const existing = db.prepare('SELECT COUNT(*) AS c FROM creation_assets WHERE creation_id = ?').get(row.id).c;
  const { filePath, bytes } = assetStore.saveBuffer(result.buffer, result.mimeType);
  const assetId = uuid();
  db.prepare(`
    INSERT INTO creation_assets (id, creation_id, kind, file_path, mime_type, duration_ms, bytes, prompt, position)
    VALUES (?, ?, 'audio', ?, ?, ?, ?, ?, ?)
  `).run(assetId, row.id, filePath, result.mimeType, result.durationMs, bytes, text, existing);
  const saved = [{ id: assetId, url: assetUrl(row.id, assetId), duration_ms: result.durationMs }];

  persistGeneration(row, {
    prompt: text, assistantContent: `Audio generiert (${genMode})`, assetIds: [assetId],
    provider, model: genMode, parameters: { mode: genMode, durationSeconds: durationSeconds || null, voiceId: voiceId || defVoice }, coverId: assetId,
  });
  ent.incrementUsage(userId, 'audio_generations');
  res.json({ assets: saved });
}

// ─── Update metadata ────────────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  if (!assertOwner(req, res)) return;
  const { title, tags } = req.body || {};
  db.prepare(`
    UPDATE creations
    SET title = COALESCE(?, title), tags = COALESCE(?, tags), updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title != null ? title : null,
    tags != null ? JSON.stringify(tags) : null,
    req.params.id
  );
  const row = db.prepare('SELECT * FROM creations WHERE id = ?').get(req.params.id);
  res.json(serializeCreation(row, { withAssets: true }));
});

// ─── Set cover ──────────────────────────────────────────────────────────────

router.put('/:id/cover', (req, res) => {
  if (!assertOwner(req, res)) return;
  const { assetId } = req.body || {};
  const asset = db.prepare('SELECT id FROM creation_assets WHERE id = ? AND creation_id = ?').get(assetId, req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset nicht gefunden' });
  db.prepare("UPDATE creations SET cover_asset_id = ?, updated_at = datetime('now') WHERE id = ?").run(assetId, req.params.id);
  res.json({ ok: true });
});

// ─── Favorite an asset ───────────────────────────────────────────────────────

router.put('/:id/assets/:assetId/favorite', (req, res) => {
  if (!assertOwner(req, res)) return;
  const { on } = req.body || {};
  const r = db.prepare('UPDATE creation_assets SET is_favorite = ? WHERE id = ? AND creation_id = ?')
    .run(on ? 1 : 0, req.params.assetId, req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Asset nicht gefunden' });
  res.json({ ok: true, is_favorite: !!on });
});

// ─── Delete a single asset ───────────────────────────────────────────────────

router.delete('/:id/assets/:assetId', (req, res) => {
  if (!assertOwner(req, res)) return;
  const asset = db.prepare('SELECT * FROM creation_assets WHERE id = ? AND creation_id = ?').get(req.params.assetId, req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset nicht gefunden' });
  assetStore.deleteFile(asset.file_path);
  db.prepare('DELETE FROM creation_assets WHERE id = ?').run(asset.id);
  // If the cover was deleted, repoint it to the first remaining asset.
  const row = db.prepare('SELECT cover_asset_id FROM creations WHERE id = ?').get(req.params.id);
  if (row && row.cover_asset_id === asset.id) {
    const next = db.prepare('SELECT id FROM creation_assets WHERE creation_id = ? ORDER BY position ASC LIMIT 1').get(req.params.id);
    db.prepare('UPDATE creations SET cover_asset_id = ? WHERE id = ?').run(next ? next.id : null, req.params.id);
  }
  res.json({ ok: true });
});

// ─── Stream an asset (authenticated) ─────────────────────────────────────────

router.get('/:id/assets/:assetId', (req, res) => {
  if (!assertOwner(req, res)) return;
  const asset = db.prepare('SELECT * FROM creation_assets WHERE id = ? AND creation_id = ?').get(req.params.assetId, req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset nicht gefunden' });
  let abs;
  try { abs = assetStore.absolutePath(asset.file_path); } catch { return res.status(400).json({ error: 'Ungültiger Pfad' }); }
  res.setHeader('Content-Type', asset.mime_type);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  if (req.query.download) {
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.assetId}.${assetStore.extForMime(asset.mime_type)}"`);
  }
  res.sendFile(abs);
});

// ─── Public share (link + QR) ────────────────────────────────────────────────

router.post('/:id/share', async (req, res) => {
  if (!assertOwner(req, res)) return;
  const row = db.prepare('SELECT * FROM creations WHERE id = ?').get(req.params.id);
  let token = row.share_token;
  if (!token) {
    token = uuid().replace(/-/g, '').substring(0, 12);
    db.prepare('UPDATE creations SET share_token = ? WHERE id = ?').run(token, req.params.id);
  }
  const shareUrl = `${getBaseUrl()}/view/creation/${token}`;
  let qr = null;
  try { qr = await QRCode.toDataURL(shareUrl); } catch (_) {}
  res.json({ token, shareUrl, qr });
});

router.delete('/:id/share', (req, res) => {
  if (!assertOwner(req, res)) return;
  db.prepare('UPDATE creations SET share_token = NULL WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Delete creation (+ its files) ───────────────────────────────────────────

router.delete('/:id', (req, res) => {
  if (!assertOwner(req, res)) return;
  assetStore.deleteForCreation(req.params.id); // unlink files first
  db.prepare('DELETE FROM creations WHERE id = ?').run(req.params.id); // cascade removes asset rows
  res.json({ ok: true });
});

module.exports = router;
