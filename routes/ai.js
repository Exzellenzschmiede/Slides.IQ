'use strict';

const express = require('express');
const multer  = require('multer');
const db = require('../database');
const { generatePresentation, analyzeNarrativeArc, suggestImprovements } = require('../services/claude');
const { parseFile } = require('../services/fileParser');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB per file
});

// ─── File upload + extraction ─────────────────────────────────────────────

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });

  try {
    const result = await parseFile(req.file.buffer, req.file.mimetype, req.file.originalname);
    // Trim very large text documents to keep request sizes manageable
    if (result.type === 'text' && result.content.length > 50000) {
      result.content = result.content.substring(0, 50000) + '\n\n[… Inhalt gekürzt]';
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Generate / Update presentation via AI (streaming SSE) ────────────────

router.post('/generate/:presentationId', async (req, res) => {
  const { prompt, save_version = true, attachments = [] } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.presentationId);
  if (!row) return res.status(404).json({ error: 'Presentation not found' });

  // Get template system prompt
  let templateSystemPrompt = null;
  if (row.template_id) {
    const template = db.prepare('SELECT system_prompt FROM templates WHERE id = ?').get(row.template_id);
    if (template) templateSystemPrompt = template.system_prompt;
  }

  const brand = JSON.parse(row.brand || '{}');
  const conversation = JSON.parse(row.conversation || '[]');

  // Read model from settings
  const settingsRow = db.prepare("SELECT value FROM settings WHERE key = 'preferences'").get();
  const prefs = settingsRow ? JSON.parse(settingsRow.value) : {};
  const model = prefs.mainModel || 'claude-opus-4-5';

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (res.flush) res.flush();
  };

  try {
    send({ type: 'start' });

    let streamedText = '';

    const fullHtml = await generatePresentation(
      { prompt, conversation, templateSystemPrompt, brand, attachments, model },
      (chunk) => {
        streamedText += chunk;
        send({ type: 'chunk', text: chunk });
      }
    );

    // Update conversation history
    const attachmentNote = attachments.length
      ? ` [Anhänge: ${attachments.map(a => a.name).join(', ')}]`
      : '';
    const newConversation = [
      ...conversation,
      { role: 'user', content: prompt + attachmentNote },
      { role: 'assistant', content: fullHtml }
    ].slice(-20); // keep last 20 messages

    // Count slides — only match class="slide" and class="slide active", not class="slide-content" etc.
    const slideCount = (fullHtml.match(/class="slide(?:\s|")/g) || []).length;

    // Save version if content existed
    let versions = JSON.parse(row.versions || '[]');
    if (save_version && row.html_content) {
      versions.unshift({
        id: require('uuid').v4(),
        timestamp: new Date().toISOString(),
        html_content: row.html_content,
        label: `v${versions.length + 1} — ${new Date().toLocaleString('de', { dateStyle: 'short', timeStyle: 'short' })}`
      });
      versions = versions.slice(0, 20);
    }

    // Persist
    db.prepare(`
      UPDATE presentations SET
        html_content = ?,
        conversation = ?,
        versions = ?,
        slide_count = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(fullHtml, JSON.stringify(newConversation), JSON.stringify(versions), slideCount, row.id);

    send({ type: 'done', slide_count: slideCount });
    res.end();
  } catch (err) {
    console.error('Generation error:', err);
    send({ type: 'error', message: err.message });
    res.end();
  }
});

// ─── Analyze narrative arc ────────────────────────────────────────────────

router.post('/analyze/:presentationId', async (req, res) => {
  const row = db.prepare('SELECT html_content FROM presentations WHERE id = ?').get(req.params.presentationId);
  if (!row || !row.html_content) return res.status(404).json({ error: 'No content' });

  try {
    const analysis = await analyzeNarrativeArc(row.html_content);
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Suggest improvements ─────────────────────────────────────────────────

router.post('/suggest/:presentationId', async (req, res) => {
  const { focusArea } = req.body;
  const row = db.prepare('SELECT html_content FROM presentations WHERE id = ?').get(req.params.presentationId);
  if (!row || !row.html_content) return res.status(404).json({ error: 'No content' });

  try {
    const suggestions = await suggestImprovements(row.html_content, focusArea);
    res.json(suggestions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Check API key ────────────────────────────────────────────────────────

router.get('/status', (req, res) => {
  const settingsRow = db.prepare("SELECT value FROM settings WHERE key = 'preferences'").get();
  const prefs = settingsRow ? JSON.parse(settingsRow.value) : {};
  res.json({
    hasApiKey: !!process.env.ANTHROPIC_API_KEY,
    model: prefs.mainModel || 'claude-opus-4-5'
  });
});

module.exports = router;
