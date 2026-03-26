'use strict';

const express = require('express');
const { v4: uuid } = require('uuid');
const multer = require('multer');
const db = require('../database');
const { parsePptxForTemplate } = require('../services/fileParser');
const { analyzeTemplateFromPptx } = require('../services/claude');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

function parseTemplate(row) {
  if (!row) return null;
  return { ...row, theme: JSON.parse(row.theme || '{}') };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM templates ORDER BY created_at ASC').all();
  res.json(rows.map(parseTemplate));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(parseTemplate(row));
});

router.post('/', (req, res) => {
  const { name, description, system_prompt, theme } = req.body;
  if (!name || !system_prompt) return res.status(400).json({ error: 'name and system_prompt required' });

  const id = uuid();
  db.prepare(`
    INSERT INTO templates (id, name, description, system_prompt, theme)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name, description || '', system_prompt, JSON.stringify(theme || {}));

  res.status(201).json(parseTemplate(db.prepare('SELECT * FROM templates WHERE id = ?').get(id)));
});

router.put('/:id', (req, res) => {
  const { name, description, system_prompt, theme } = req.body;
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

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
    description || null,
    system_prompt || null,
    theme ? JSON.stringify(theme) : null,
    req.params.id
  );

  res.json(parseTemplate(db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Analyze PPTX and return template suggestion (does not save)
router.post('/from-pptx', upload.single('file'), async (req, res) => {
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

// Slide Library
router.get('/slide-library', (req, res) => {
  const rows = db.prepare('SELECT * FROM slide_library ORDER BY created_at DESC').all();
  res.json(rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') })));
});

module.exports = router;
