'use strict';

const express = require('express');
const { v4: uuid } = require('uuid');
const multer = require('multer');
const db = require('../database');
const { parsePptxForTemplate } = require('../services/fileParser');
const { analyzeTemplateFromPptx } = require('../services/claude');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function parseTemplate(row) {
  if (!row) return null;
  return { ...row, theme: JSON.parse(row.theme || '{}'), is_public: !!row.is_public };
}

function canEdit(row, session) {
  if (row.owner_id === null) return session.role === 'admin';
  return row.owner_id === session.userId || session.role === 'admin';
}

// GET / — system templates + own templates + public templates of others
router.get('/', (req, res) => {
  const userId = req.session.userId;
  const rows = db.prepare(`
    SELECT *,
      CASE
        WHEN owner_id IS NULL THEN 'system'
        WHEN owner_id = ?     THEN 'own'
        ELSE 'shared'
      END AS scope
    FROM templates
    WHERE owner_id IS NULL
       OR owner_id = ?
       OR is_public = 1
    ORDER BY
      CASE WHEN owner_id IS NULL THEN 0 WHEN owner_id = ? THEN 1 ELSE 2 END ASC,
      created_at ASC
  `).all(userId, userId, userId);
  res.json(rows.map(parseTemplate));
});

router.get('/:id', (req, res) => {
  const userId = req.session.userId;
  const row = db.prepare(`
    SELECT *, CASE WHEN owner_id IS NULL THEN 'system' WHEN owner_id = ? THEN 'own' ELSE 'shared' END AS scope
    FROM templates WHERE id = ?
  `).get(userId, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.owner_id !== null && row.owner_id !== userId && !row.is_public && req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  res.json(parseTemplate(row));
});

router.post('/', (req, res) => {
  const { name, description, system_prompt, theme } = req.body;
  if (!name || !system_prompt) return res.status(400).json({ error: 'name and system_prompt required' });

  const id = uuid();
  db.prepare(`
    INSERT INTO templates (id, name, description, system_prompt, theme, owner_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, description || '', system_prompt, JSON.stringify(theme || {}), req.session.userId);

  const row = db.prepare(`
    SELECT *, 'own' AS scope FROM templates WHERE id = ?
  `).get(id);
  res.status(201).json(parseTemplate(row));
});

router.put('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!canEdit(row, req.session)) return res.status(403).json({ error: 'Keine Berechtigung' });

  const { name, description, system_prompt, theme } = req.body;
  db.prepare(`
    UPDATE templates SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      system_prompt = COALESCE(?, system_prompt),
      theme = COALESCE(?, theme),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name || null,
    description !== undefined ? description : null,
    system_prompt || null,
    theme ? JSON.stringify(theme) : null,
    req.params.id
  );

  const userId = req.session.userId;
  const updated = db.prepare(`
    SELECT *, CASE WHEN owner_id IS NULL THEN 'system' WHEN owner_id = ? THEN 'own' ELSE 'shared' END AS scope
    FROM templates WHERE id = ?
  `).get(userId, req.params.id);
  res.json(parseTemplate(updated));
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.owner_id === null) return res.status(403).json({ error: 'Standard-Templates können nicht gelöscht werden' });
  if (!canEdit(row, req.session)) return res.status(403).json({ error: 'Keine Berechtigung' });

  db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// PUT /:id/share — toggle is_public (owner or admin)
router.put('/:id/share', (req, res) => {
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.owner_id === null) return res.status(403).json({ error: 'Standard-Templates können nicht geteilt werden' });
  if (!canEdit(row, req.session)) return res.status(403).json({ error: 'Keine Berechtigung' });

  const isPublic = req.body.isPublic ? 1 : 0;
  db.prepare('UPDATE templates SET is_public = ? WHERE id = ?').run(isPublic, req.params.id);
  res.json({ ok: true, isPublic: !!isPublic });
});

// POST /from-pptx — analyze PPTX, return suggestion (does not save)
router.post('/from-pptx', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Datei zu groß (max. 50 MB)' });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });
  const name = req.file.originalname || '';
  if (!name.toLowerCase().endsWith('.pptx')) {
    return res.status(400).json({ error: 'Nur .pptx Dateien werden unterstützt' });
  }
  try {
    const pptxData   = parsePptxForTemplate(req.file.buffer);
    const suggestion = await analyzeTemplateFromPptx(pptxData);
    res.json(suggestion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
