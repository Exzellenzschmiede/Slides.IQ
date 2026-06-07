'use strict';

const express = require('express');
const { v4: uuid } = require('uuid');
const QRCode = require('qrcode');
const db = require('../database');
const { exportPdf } = require('../services/pdf');
const { getBaseUrl } = require('../services/appSettings');
const { requireCanCreatePresentation, requireFeature } = require('../middleware/entitlements');

const router = express.Router();

// ─── Permission helpers ───────────────────────────────────────────────────

const LEVELS = { read: 1, write: 2, delete: 3 };

function getAccess(presentationId, userId) {
  const pres = db.prepare('SELECT user_id FROM presentations WHERE id = ?').get(presentationId);
  if (!pres) return null;
  if (pres.user_id === userId) return 'owner';
  const share = db.prepare('SELECT permission FROM presentation_shares WHERE presentation_id = ? AND user_id = ?').get(presentationId, userId);
  return share ? share.permission : null;
}

function canDo(access, required) {
  if (!access) return false;
  if (access === 'owner') return true;
  return (LEVELS[access] || 0) >= (LEVELS[required] || 99);
}

function assertAccess(req, res, required) {
  const access = getAccess(req.params.id, req.session.userId);
  if (!canDo(access, required)) {
    res.status(access === null ? 404 : 403).json({ error: 'Keine Berechtigung' });
    return null;
  }
  return access;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function parsePresentation(row) {
  if (!row) return null;
  return {
    ...row,
    conversation: JSON.parse(row.conversation || '[]'),
    versions: JSON.parse(row.versions || '[]'),
    tags: JSON.parse(row.tags || '[]'),
    brand: JSON.parse(row.brand || '{}')
  };
}

function countSlides(html) {
  if (!html) return 0;
  const matches = html.match(/class="slide(?:\s+[^"]*)?"/g);
  if (!matches) return 0;
  return matches.filter(m => /class="slide(\s|")/.test(m)).length;
}

// ─── List ─────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const { search, tag } = req.query;
  const userId = req.session.userId;

  // Own + shared presentations
  let query = `
    SELECT p.id, p.title, p.description, p.slide_count, p.tags, p.created_at,
           p.updated_at, p.share_token, p.view_count, p.user_id,
           CASE WHEN p.user_id = ? THEN NULL ELSE ps.permission END AS shared_permission,
           u.name AS owner_name
    FROM presentations p
    LEFT JOIN presentation_shares ps ON ps.presentation_id = p.id AND ps.user_id = ?
    LEFT JOIN users u ON u.id = p.user_id
    WHERE (p.user_id = ? OR ps.user_id = ?)
      AND p.campaign_id IS NULL
  `;
  const params = [userId, userId, userId, userId];

  if (search) {
    query += ' AND (p.title LIKE ? OR p.description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY p.updated_at DESC';

  const rows = db.prepare(query).all(...params);
  const result = rows.map(r => ({
    ...r,
    tags: JSON.parse(r.tags || '[]'),
    is_owner: r.user_id === userId,
  })).filter(r => !tag || r.tags.includes(tag));

  res.json(result);
});

// ─── Create ───────────────────────────────────────────────────────────────

router.post('/', requireCanCreatePresentation, (req, res) => {
  const { title, description, template_id, tags } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });

  const id = uuid();
  db.prepare(`
    INSERT INTO presentations (id, title, description, template_id, tags, user_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, title, description || '', template_id || null, JSON.stringify(tags || []), req.session.userId);

  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(id);
  res.status(201).json(parsePresentation(row));
});

// ─── Get one ─────────────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  if (!assertAccess(req, res, 'read')) return;
  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  res.json(parsePresentation(row));
});

// ─── Content preview (iframe) ─────────────────────────────────────────────

router.get('/:id/content-preview', (req, res) => {
  if (!assertAccess(req, res, 'read')) return;
  const row = db.prepare('SELECT html_content FROM presentations WHERE id = ?').get(req.params.id);
  if (!row?.html_content) return res.status(404).send('');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(row.html_content);
});

// ─── Update metadata ─────────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  if (!assertAccess(req, res, 'write')) return;
  const { title, description, tags, brand } = req.body;

  db.prepare(`
    UPDATE presentations SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      tags = COALESCE(?, tags),
      brand = COALESCE(?, brand),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title || null, description || null,
    tags ? JSON.stringify(tags) : null,
    brand ? JSON.stringify(brand) : null,
    req.params.id
  );

  res.json(parsePresentation(db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id)));
});

// ─── Update HTML content ──────────────────────────────────────────────────

router.put('/:id/content', (req, res) => {
  if (!assertAccess(req, res, 'write')) return;
  const { html_content, conversation, save_version } = req.body;
  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);

  let versions = JSON.parse(row.versions || '[]');
  if (save_version && row.html_content) {
    versions.unshift({ id: uuid(), timestamp: new Date().toISOString(), html_content: row.html_content, label: `Version ${versions.length + 1}` });
    versions = versions.slice(0, 20);
  }

  const slideCount = countSlides(html_content);
  db.prepare(`
    UPDATE presentations SET html_content = ?, conversation = ?, versions = ?, slide_count = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(html_content, conversation ? JSON.stringify(conversation) : row.conversation, JSON.stringify(versions), slideCount, req.params.id);

  res.json({ ok: true, slide_count: slideCount });
});

// ─── Restore version ──────────────────────────────────────────────────────

router.post('/:id/restore/:versionId', (req, res) => {
  if (!assertAccess(req, res, 'write')) return;
  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  const versions = JSON.parse(row.versions || '[]');
  const version = versions.find(v => v.id === req.params.versionId);
  if (!version) return res.status(404).json({ error: 'Version not found' });

  versions.unshift({ id: uuid(), timestamp: new Date().toISOString(), html_content: row.html_content, label: `(vor Restore) ${new Date().toLocaleString('de')}` });
  db.prepare('UPDATE presentations SET html_content = ?, versions = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(version.html_content, JSON.stringify(versions.slice(0, 20)), req.params.id);
  res.json({ ok: true });
});

// ─── Delete slide ─────────────────────────────────────────────────────────

router.delete('/:id/slides/:slideIndex', (req, res) => {
  if (!assertAccess(req, res, 'write')) return;
  const slideIndex = parseInt(req.params.slideIndex);
  if (isNaN(slideIndex)) return res.status(400).json({ error: 'Invalid slideIndex' });

  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  if (!row?.html_content) return res.status(404).json({ error: 'Not found' });

  const { deleteSlideInHtml } = require('../services/slideUtils');
  const newHtml = deleteSlideInHtml(row.html_content, slideIndex);
  const slideCount = countSlides(newHtml);

  let versions = JSON.parse(row.versions || '[]');
  versions.unshift({ id: uuid(), timestamp: new Date().toISOString(), html_content: row.html_content, label: `v${versions.length + 1} — ${new Date().toLocaleString('de', { dateStyle: 'short', timeStyle: 'short' })}` });

  db.prepare('UPDATE presentations SET html_content = ?, versions = ?, slide_count = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(newHtml, JSON.stringify(versions.slice(0, 20)), slideCount, req.params.id);
  res.json({ ok: true, slide_count: slideCount });
});

// ─── Duplicate slide ──────────────────────────────────────────────────────

router.post('/:id/slides/:slideIndex/duplicate', (req, res) => {
  if (!assertAccess(req, res, 'write')) return;
  const slideIndex = parseInt(req.params.slideIndex);
  if (isNaN(slideIndex)) return res.status(400).json({ error: 'Invalid slideIndex' });

  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  if (!row?.html_content) return res.status(404).json({ error: 'Not found' });

  const { parseSlidesFromHtml, insertSlideInHtml } = require('../services/slideUtils');
  const slides = parseSlidesFromHtml(row.html_content);
  if (slideIndex < 0 || slideIndex >= slides.length) return res.status(400).json({ error: 'Invalid slideIndex' });

  const dupHtml = slides[slideIndex].html.replace(/class="slide active"/, 'class="slide"');
  const newHtml = insertSlideInHtml(row.html_content, slideIndex, dupHtml);
  const slideCount = countSlides(newHtml);

  db.prepare('UPDATE presentations SET html_content = ?, slide_count = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(newHtml, slideCount, req.params.id);
  res.json({ ok: true, slide_count: slideCount, new_index: slideIndex + 1 });
});

// ─── Delete presentation ──────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  if (!assertAccess(req, res, 'delete')) return;
  db.prepare('DELETE FROM presentations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Public share (link + QR) ─────────────────────────────────────────────

router.post('/:id/share', async (req, res) => {
  if (!assertAccess(req, res, 'write')) return;
  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);

  let token = row.share_token;
  if (!token) {
    token = uuid().replace(/-/g, '').substring(0, 12);
    db.prepare('UPDATE presentations SET share_token = ? WHERE id = ?').run(token, req.params.id);
  }

  const shareUrl = `${getBaseUrl()}/view/${token}`;
  const qrDataUrl = await QRCode.toDataURL(shareUrl, { width: 256, margin: 2, color: { dark: '#7c3aed', light: '#ffffff' } });
  res.json({ token, shareUrl, qrDataUrl });
});

router.delete('/:id/share', (req, res) => {
  if (!assertAccess(req, res, 'write')) return;
  db.prepare('UPDATE presentations SET share_token = NULL WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── User shares ──────────────────────────────────────────────────────────

// List shares for a presentation
router.get('/:id/user-shares', (req, res) => {
  if (!assertAccess(req, res, 'read')) return;
  const shares = db.prepare(`
    SELECT ps.id, ps.permission, ps.created_at, u.id as user_id, u.name, u.email
    FROM presentation_shares ps
    JOIN users u ON u.id = ps.user_id
    WHERE ps.presentation_id = ?
    ORDER BY ps.created_at ASC
  `).all(req.params.id);
  res.json(shares);
});

// Add or update a share
router.put('/:id/user-shares/:userId', (req, res) => {
  const access = assertAccess(req, res, 'write');
  if (!access) return;
  // Only owner can manage shares
  if (access !== 'owner') return res.status(403).json({ error: 'Nur der Eigentümer kann Freigaben verwalten' });

  const { permission } = req.body;
  if (!['read', 'write', 'delete'].includes(permission)) return res.status(400).json({ error: 'Ungültige Berechtigung' });
  if (req.params.userId === req.session.userId) return res.status(400).json({ error: 'Kann nicht mit sich selbst teilen' });

  const targetUser = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
  if (!targetUser) return res.status(404).json({ error: 'User nicht gefunden' });

  db.prepare(`
    INSERT INTO presentation_shares (id, presentation_id, user_id, permission)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(presentation_id, user_id) DO UPDATE SET permission = excluded.permission
  `).run(uuid(), req.params.id, req.params.userId, permission);

  res.json({ ok: true });
});

// Remove a share
router.delete('/:id/user-shares/:userId', (req, res) => {
  const access = assertAccess(req, res, 'write');
  if (!access) return;
  if (access !== 'owner') return res.status(403).json({ error: 'Nur der Eigentümer kann Freigaben verwalten' });

  db.prepare('DELETE FROM presentation_shares WHERE presentation_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
  res.json({ ok: true });
});

// ─── PDF Export ───────────────────────────────────────────────────────────

router.get('/:id/export/pdf', requireFeature('exportPdf'), async (req, res) => {
  if (!assertAccess(req, res, 'read')) return;
  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  if (!row?.html_content) return res.status(400).json({ error: 'No content yet' });

  try {
    const pdfBuffer = await exportPdf(row.html_content, { landscape: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.title)}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: 'PDF export failed: ' + err.message });
  }
});

// ─── HTML Export ──────────────────────────────────────────────────────────

router.get('/:id/export/html', requireFeature('exportHtml'), (req, res) => {
  if (!assertAccess(req, res, 'read')) return;
  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  if (!row?.html_content) return res.status(400).json({ error: 'No content yet' });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.title)}.html"`);
  res.send(row.html_content);
});

module.exports = router;
