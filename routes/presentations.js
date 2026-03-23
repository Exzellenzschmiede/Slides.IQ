'use strict';

const express = require('express');
const { v4: uuid } = require('uuid');
const QRCode = require('qrcode');
const db = require('../database');
const { exportPdf, exportSlideImages } = require('../services/pdf');

const router = express.Router();

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
  // Match only standalone class="slide" or class="slide active" — not class="slide-content" etc.
  const matches = html.match(/class="slide(?:\s+[^"]*)?"/g);
  if (!matches) return 0;
  return matches.filter(m => /class="slide(\s|")/.test(m)).length;
}

// ─── List ─────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const { search, tag } = req.query;
  let query = 'SELECT id, title, description, slide_count, tags, created_at, updated_at, share_token, view_count FROM presentations';
  const params = [];

  if (search) {
    query += ' WHERE (title LIKE ? OR description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY updated_at DESC';

  const rows = db.prepare(query).all(...params);
  const result = rows.map(r => ({
    ...r,
    tags: JSON.parse(r.tags || '[]')
  })).filter(r => !tag || r.tags.includes(tag));

  res.json(result);
});

// ─── Create ───────────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  const { title, description, template_id, tags } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });

  const id = uuid();
  db.prepare(`
    INSERT INTO presentations (id, title, description, template_id, tags)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, title, description || '', template_id || null, JSON.stringify(tags || []));

  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(id);
  res.status(201).json(parsePresentation(row));
});

// ─── Get one ─────────────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(parsePresentation(row));
});

// ─── Update ───────────────────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  const { title, description, tags, brand } = req.body;
  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  db.prepare(`
    UPDATE presentations SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      tags = COALESCE(?, tags),
      brand = COALESCE(?, brand),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title || null,
    description || null,
    tags ? JSON.stringify(tags) : null,
    brand ? JSON.stringify(brand) : null,
    req.params.id
  );

  res.json(parsePresentation(db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id)));
});

// ─── Update HTML content ──────────────────────────────────────────────────

router.put('/:id/content', (req, res) => {
  const { html_content, conversation, save_version } = req.body;
  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  let versions = JSON.parse(row.versions || '[]');

  // Save version before updating
  if (save_version && row.html_content) {
    versions.unshift({
      id: uuid(),
      timestamp: new Date().toISOString(),
      html_content: row.html_content,
      label: `Version ${versions.length + 1}`
    });
    // Keep max 20 versions
    versions = versions.slice(0, 20);
  }

  const slideCount = countSlides(html_content);

  db.prepare(`
    UPDATE presentations SET
      html_content = ?,
      conversation = ?,
      versions = ?,
      slide_count = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    html_content,
    conversation ? JSON.stringify(conversation) : row.conversation,
    JSON.stringify(versions),
    slideCount,
    req.params.id
  );

  res.json({ ok: true, slide_count: slideCount });
});

// ─── Restore version ──────────────────────────────────────────────────────

router.post('/:id/restore/:versionId', (req, res) => {
  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const versions = JSON.parse(row.versions || '[]');
  const version = versions.find(v => v.id === req.params.versionId);
  if (!version) return res.status(404).json({ error: 'Version not found' });

  // Save current as version before restoring
  versions.unshift({
    id: uuid(),
    timestamp: new Date().toISOString(),
    html_content: row.html_content,
    label: `(vor Restore) ${new Date().toLocaleString('de')}`
  });

  db.prepare(`
    UPDATE presentations SET html_content = ?, versions = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(version.html_content, JSON.stringify(versions.slice(0, 20)), req.params.id);

  res.json({ ok: true });
});

// ─── Delete ───────────────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM presentations WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ─── Share / QR Code ─────────────────────────────────────────────────────

router.post('/:id/share', async (req, res) => {
  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  let token = row.share_token;
  if (!token) {
    token = uuid().replace(/-/g, '').substring(0, 12);
    db.prepare('UPDATE presentations SET share_token = ? WHERE id = ?').run(token, req.params.id);
  }

  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const shareUrl = `${baseUrl}/view/${token}`;

  const qrDataUrl = await QRCode.toDataURL(shareUrl, {
    width: 256,
    margin: 2,
    color: { dark: '#7c3aed', light: '#ffffff' }
  });

  res.json({ token, shareUrl, qrDataUrl });
});

router.delete('/:id/share', (req, res) => {
  db.prepare('UPDATE presentations SET share_token = NULL WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── PDF Export ───────────────────────────────────────────────────────────

router.get('/:id/export/pdf', async (req, res) => {
  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!row.html_content) return res.status(400).json({ error: 'No content yet' });

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

// ─── HTML Package Export ──────────────────────────────────────────────────

router.get('/:id/export/html', (req, res) => {
  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!row.html_content) return res.status(400).json({ error: 'No content yet' });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.title)}.html"`);
  res.send(row.html_content);
});

// ─── Slide Library: save a slide ─────────────────────────────────────────

router.post('/:id/slides/save', (req, res) => {
  const { slideIndex, title, tags } = req.body;
  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.id);
  if (!row || !row.html_content) return res.status(404).json({ error: 'Not found' });

  // Extract slide HTML (simple regex extraction)
  const slideMatches = row.html_content.match(/<div class="slide[^"]*"[^>]*>[\s\S]*?(?=<div class="slide|$)/g);
  if (!slideMatches || slideIndex >= slideMatches.length) {
    return res.status(400).json({ error: 'Slide not found' });
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO slide_library (id, title, html_content, tags, source_presentation_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, title || `Slide ${slideIndex + 1}`, slideMatches[slideIndex], JSON.stringify(tags || []), req.params.id);

  res.status(201).json({ id });
});

// ─── Public view (track analytics) ──────────────────────────────────────

router.get('/view/:token', (req, res) => {
  const row = db.prepare('SELECT * FROM presentations WHERE share_token = ?').get(req.params.token);
  if (!row) return res.status(404).send('Presentation not found');

  db.prepare('UPDATE presentations SET view_count = view_count + 1 WHERE id = ?').run(row.id);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(row.html_content || '<h1>No content yet</h1>');
});

module.exports = router;
