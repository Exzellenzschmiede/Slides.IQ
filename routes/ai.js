'use strict';

const express = require('express');
const multer  = require('multer');
const db = require('../database');
const { generatePresentation, generateSingleSlide, planPresentation, analyzeNarrativeArc, suggestImprovements } = require('../services/claude');
const { parseSlidesFromHtml, replaceSlideInHtml, insertSlideInHtml, extractCssFromHtml } = require('../services/slideUtils');
const { parseFile } = require('../services/fileParser');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB per file
});

// ─── Helper: read provider settings from DB (no env fallback) ─────────────────

function getGlobalPrefs() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'preferences' AND user_id = ''").get();
  return row ? JSON.parse(row.value) : {};
}

function getProviderSettings() {
  const prefs = getGlobalPrefs();
  const provider = prefs.aiProvider || 'anthropic';
  const providerPrefs = (prefs.aiProviders || {})[provider] || {};
  const model = providerPrefs.model || prefs.mainModel || 'claude-sonnet-4-6';
  const apiKey = providerPrefs.apiKey || '';
  return { provider, model, apiKey };
}

function getAnthropicKey() {
  const prefs = getGlobalPrefs();
  return prefs.aiProviders?.anthropic?.apiKey || '';
}

const NO_KEY_MSG = (provider) =>
  `Kein API-Key für ${provider} konfiguriert. Bitte hinterlege deinen API-Key in den Einstellungen.`;

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
  const { prompt, save_version = true, attachments = [], plan = null } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.presentationId);
  if (!row) return res.status(404).json({ error: 'Presentation not found' });

  const { provider, model, apiKey } = getProviderSettings();
  if (!apiKey) return res.status(400).json({ error: NO_KEY_MSG(provider) });

  // Get template system prompt + theme
  let templateSystemPrompt = null;
  let templateTheme = null;
  if (row.template_id) {
    const template = db.prepare('SELECT system_prompt, theme FROM templates WHERE id = ?').get(row.template_id);
    if (template) {
      templateSystemPrompt = template.system_prompt;
      templateTheme = JSON.parse(template.theme || '{}');
    }
  }

  const conversation = JSON.parse(row.conversation || '[]');

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

    const { html: fullHtml, stopReason } = await generatePresentation(
      { prompt, plan, conversation, templateSystemPrompt, templateTheme, attachments, model, provider, apiKey },
      (chunk) => {
        streamedText += chunk;
        send({ type: 'chunk', text: chunk });
      }
    );

    if (stopReason === 'max_tokens') {
      send({ type: 'warning', message: 'Das Ausgabelimit wurde erreicht — die Präsentation wurde automatisch vervollständigt. Wähle ein leistungsfähigeres Modell oder bitte um weniger Slides für bessere Ergebnisse.' });
    }

    // Count slides — only match class="slide" and class="slide active", not class="slide-content" etc.
    const slideCount = (fullHtml.match(/class="slide(?:\s|")/g) || []).length;

    // Update conversation history
    const attachmentNote = attachments.length
      ? ` [Anhänge: ${attachments.map(a => a.name).join(', ')}]`
      : '';
    const attachmentDisplay = attachments.length
      ? ` 📎 ${attachments.map(a => a.name).join(', ')}`
      : '';
    const userDisplay = plan?.summary
      ? `${prompt}${attachmentDisplay} → ${plan.summary}`
      : `${prompt}${attachmentDisplay}`;
    const newConversation = [
      ...conversation,
      { role: 'user', content: prompt + attachmentNote, display: userDisplay },
      { role: 'assistant', content: fullHtml, display: `✓ ${slideCount} Slide${slideCount !== 1 ? 's' : ''} erstellt.` }
    ].slice(-20); // keep last 20 messages

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

// ─── Edit a single slide via AI (streaming SSE) ───────────────────────────

router.post('/edit-slide/:presentationId', async (req, res) => {
  const { prompt, slideIndex } = req.body;
  if (!prompt || slideIndex === undefined) return res.status(400).json({ error: 'prompt and slideIndex required' });

  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.presentationId);
  if (!row || !row.html_content) return res.status(404).json({ error: 'Not found' });

  const { provider, model, apiKey } = getProviderSettings();
  if (!apiKey) return res.status(400).json({ error: NO_KEY_MSG(provider) });

  const slides = parseSlidesFromHtml(row.html_content);
  if (slideIndex < 0 || slideIndex >= slides.length) return res.status(400).json({ error: 'Invalid slideIndex' });

  const cssContext = extractCssFromHtml(row.html_content);
  const surroundingSlides = slides
    .filter((_, i) => Math.abs(i - slideIndex) <= 2 && i !== slideIndex)
    .map(s => s.html);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data) => { res.write(`data: ${JSON.stringify(data)}\n\n`); if (res.flush) res.flush(); };

  try {
    send({ type: 'start' });

    const { slideHtml } = await generateSingleSlide(
      { prompt, slideHtml: slides[slideIndex].html, cssContext, surroundingSlides, model, provider, apiKey, mode: 'edit' },
      (chunk) => send({ type: 'chunk', text: chunk })
    );

    const newHtml = replaceSlideInHtml(row.html_content, slideIndex, slideHtml);
    const slideCount = (newHtml.match(/class="slide(?:\s|")/g) || []).length;

    let versions = JSON.parse(row.versions || '[]');
    versions.unshift({
      id: require('uuid').v4(),
      timestamp: new Date().toISOString(),
      html_content: row.html_content,
      label: `v${versions.length + 1} — ${new Date().toLocaleString('de', { dateStyle: 'short', timeStyle: 'short' })}`
    });

    const existingConvEdit = JSON.parse(row.conversation || '[]');
    const newConvEdit = [
      ...existingConvEdit,
      { role: 'user', content: prompt, display: `[Slide ${slideIndex + 1}] ${prompt}` },
      { role: 'assistant', content: `[Folie ${slideIndex + 1} bearbeitet]`, display: `✓ Slide ${slideIndex + 1} aktualisiert.` }
    ].slice(-20);

    db.prepare(`UPDATE presentations SET html_content = ?, versions = ?, slide_count = ?, conversation = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(newHtml, JSON.stringify(versions.slice(0, 20)), slideCount, JSON.stringify(newConvEdit), row.id);

    send({ type: 'done', slide_count: slideCount });
    res.end();
  } catch (err) {
    console.error('Edit slide error:', err);
    send({ type: 'error', message: err.message });
    res.end();
  }
});

// ─── Insert a new slide via AI (streaming SSE) ────────────────────────────

router.post('/insert-slide/:presentationId', async (req, res) => {
  const { prompt, afterIndex } = req.body;
  if (!prompt || afterIndex === undefined) return res.status(400).json({ error: 'prompt and afterIndex required' });

  const row = db.prepare('SELECT * FROM presentations WHERE id = ?').get(req.params.presentationId);
  if (!row || !row.html_content) return res.status(404).json({ error: 'Not found' });

  const { provider, model, apiKey } = getProviderSettings();
  if (!apiKey) return res.status(400).json({ error: NO_KEY_MSG(provider) });

  const slides = parseSlidesFromHtml(row.html_content);
  const cssContext = extractCssFromHtml(row.html_content);
  const surroundingSlides = slides
    .filter((_, i) => Math.abs(i - afterIndex) <= 2)
    .map(s => s.html);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data) => { res.write(`data: ${JSON.stringify(data)}\n\n`); if (res.flush) res.flush(); };

  try {
    send({ type: 'start' });

    const { slideHtml } = await generateSingleSlide(
      { prompt, slideHtml: '', cssContext, surroundingSlides, model, provider, apiKey, mode: 'insert' },
      (chunk) => send({ type: 'chunk', text: chunk })
    );

    const newHtml = insertSlideInHtml(row.html_content, afterIndex, slideHtml);
    const slideCount = (newHtml.match(/class="slide(?:\s|")/g) || []).length;

    let versions = JSON.parse(row.versions || '[]');
    versions.unshift({
      id: require('uuid').v4(),
      timestamp: new Date().toISOString(),
      html_content: row.html_content,
      label: `v${versions.length + 1} — ${new Date().toLocaleString('de', { dateStyle: 'short', timeStyle: 'short' })}`
    });

    // Update conversation so history reflects the insert
    const existingConv = JSON.parse(row.conversation || '[]');
    const newConvInsert = [
      ...existingConv,
      { role: 'user', content: prompt, display: prompt },
      { role: 'assistant', content: `[Folie nach Position ${afterIndex + 1} eingefügt]`, display: `✓ Folie ${afterIndex + 2} eingefügt (${slideCount} Slides gesamt).` }
    ].slice(-20);

    db.prepare(`UPDATE presentations SET html_content = ?, versions = ?, slide_count = ?, conversation = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(newHtml, JSON.stringify(versions.slice(0, 20)), slideCount, JSON.stringify(newConvInsert), row.id);

    send({ type: 'done', slide_count: slideCount, new_index: afterIndex + 1 });
    res.end();
  } catch (err) {
    console.error('Insert slide error:', err);
    send({ type: 'error', message: err.message });
    res.end();
  }
});

// ─── Plan a presentation (non-streaming) ─────────────────────────────────

router.post('/plan/:presentationId', async (req, res) => {
  const { prompt, attachments = [] } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const { provider, model, apiKey } = getProviderSettings();
  if (!apiKey) return res.status(400).json({ error: NO_KEY_MSG(provider) });

  // Get current slide count and conversation history for context
  const row = db.prepare('SELECT slide_count, conversation FROM presentations WHERE id = ?').get(req.params.presentationId);
  const existingSlideCount = row?.slide_count || 0;
  const conversation = JSON.parse(row?.conversation || '[]');

  try {
    const plan = await planPresentation({ prompt, attachments, existingSlideCount, conversation, model, provider, apiKey });
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Analyze narrative arc ────────────────────────────────────────────────

router.post('/analyze/:presentationId', async (req, res) => {
  const row = db.prepare('SELECT html_content FROM presentations WHERE id = ?').get(req.params.presentationId);
  if (!row || !row.html_content) return res.status(404).json({ error: 'No content' });

  const anthropicKey = getAnthropicKey();
  if (!anthropicKey) return res.status(400).json({ error: 'Narrative-Analyse erfordert einen Anthropic API-Key in den Einstellungen.' });

  try {
    const analysis = await analyzeNarrativeArc(row.html_content, anthropicKey);
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

  const anthropicKey = getAnthropicKey();
  if (!anthropicKey) return res.status(400).json({ error: 'KI-Verbesserungsvorschläge erfordern einen Anthropic API-Key in den Einstellungen.' });

  try {
    const suggestions = await suggestImprovements(row.html_content, focusArea, anthropicKey);
    res.json(suggestions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Check API key / provider status ─────────────────────────────────────────

router.get('/status', (req, res) => {
  const { provider, model, apiKey } = getProviderSettings();
  res.json({ hasApiKey: !!apiKey, provider, model });
});

module.exports = router;
