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
const { requireCanGenerateImage, requireFeature } = require('../middleware/entitlements');
const imageGenerator = require('../services/imageGenerator');
const assetStore = require('../services/assetStore');

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

const NO_KEY_MSG = (provider) =>
  `Kein API-Key für ${provider} konfiguriert. Bitte hinterlege ihn im Admin-Bereich.`;

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
    width: a.width,
    height: a.height,
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
  if (!['image'].includes(type)) return res.status(400).json({ error: 'Nicht unterstützter Typ' });
  const id = uuid();
  db.prepare(`
    INSERT INTO creations (id, type, title, user_id)
    VALUES (?, ?, ?, ?)
  `).run(id, type, (title && title.trim()) || 'Neues Bildprojekt', req.session.userId);
  const row = db.prepare('SELECT * FROM creations WHERE id = ?').get(id);
  res.status(201).json(serializeCreation(row, { withAssets: true }));
});

// ─── Get one ─────────────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  if (!assertOwner(req, res)) return;
  const row = db.prepare('SELECT * FROM creations WHERE id = ?').get(req.params.id);
  res.json(serializeCreation(row, { withAssets: true }));
});

// ─── Generate images (synchronous; the expensive call) ──────────────────────

router.post('/:id/generate',
  imageLimiter,
  requireFeature('imageStudio'),
  requireCanGenerateImage,
  async (req, res) => {
    if (!assertOwner(req, res)) return;
    const row = db.prepare('SELECT * FROM creations WHERE id = ?').get(req.params.id);

    const { prompt, style, aspect = '1:1', count } = req.body || {};
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt erforderlich' });

    const n = Math.max(1, Math.min(parseInt(count, 10) || 1, 4));
    const { provider, model, apiKey } = getImageProviderSettings();
    if (!apiKey) return res.status(400).json({ error: NO_KEY_MSG(provider) });

    const size = imageGenerator.sizeForAspect(aspect);
    // Style is folded into the prompt so it survives across providers.
    const effectivePrompt = style ? `${prompt.trim()}\n\nStil: ${style}.` : prompt.trim();

    try {
      const result = await imageGenerator.generateImage({
        provider, apiKey, model, prompt: effectivePrompt, size, n,
      });

      // Persist assets (files + rows), appended after any existing assets.
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

      // Append to conversation + versions (mirror presentations).
      const conversation = JSON.parse(row.conversation || '[]');
      conversation.push({ role: 'user', content: prompt.trim() });
      conversation.push({ role: 'assistant', content: `${savedAssets.length} Bild(er) generiert`, assetIds: savedAssets.map(a => a.id) });

      const versions = JSON.parse(row.versions || '[]');
      versions.unshift({
        id: uuid(),
        timestamp: new Date().toISOString(),
        prompt: prompt.trim(),
        assetIds: savedAssets.map(a => a.id),
        label: `Batch ${versions.length + 1}`,
      });

      const newCover = row.cover_asset_id || savedAssets[0]?.id || null;
      db.prepare(`
        UPDATE creations
        SET prompt = ?, provider = ?, model = ?, parameters = ?, conversation = ?, versions = ?,
            cover_asset_id = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        prompt.trim(), result.provider, result.model,
        JSON.stringify({ style: style || null, aspect, count: n, size }),
        JSON.stringify(conversation.slice(-40)),
        JSON.stringify(versions.slice(0, 20)),
        newCover, row.id
      );

      ent.incrementUsage(req.session.userId, 'image_generations'); // count only on success
      res.json({ assets: savedAssets });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

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
