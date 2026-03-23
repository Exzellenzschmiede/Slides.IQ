'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);

// ─── WebSocket for Live Audience Mode ────────────────────────────────────

const wss = new WebSocket.Server({ server, path: '/ws' });
const rooms = new Map(); // shareToken -> Set<WebSocket>

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://x').searchParams.get('token');
  if (!token) { ws.close(); return; }

  if (!rooms.has(token)) rooms.set(token, new Set());
  rooms.get(token).add(ws);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      // Presenter broadcasts slide changes to all audience members
      if (msg.type === 'slide-change') {
        rooms.get(token)?.forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(msg));
          }
        });
      }
    } catch {}
  });

  ws.on('close', () => {
    rooms.get(token)?.delete(ws);
    if (rooms.get(token)?.size === 0) rooms.delete(token);
  });
});

// ─── Middleware ───────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting for AI generation (expensive)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many AI requests. Please wait.' }
});

// ─── API Routes ───────────────────────────────────────────────────────────

const presentationsRouter = require('./routes/presentations');
const templatesRouter = require('./routes/templates');
const aiRouter = require('./routes/ai');

app.use('/api/presentations', presentationsRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/ai', aiLimiter, aiRouter);

// ─── Framework Migration ───────────────────────────────────────────────────

app.post('/api/admin/migrate-frameworks', (req, res) => {
  const db = require('./database');
  const { injectFramework } = require('./services/claude');

  const rows = db.prepare(
    'SELECT id, title, html_content FROM presentations WHERE html_content IS NOT NULL AND html_content != ""'
  ).all();

  const results = [];
  for (const row of rows) {
    const fixedHtml = injectFramework(row.html_content);
    const slideCount = (fixedHtml.match(/class="slide(?:\s|")/g) || []).length;
    db.prepare(
      'UPDATE presentations SET html_content = ?, slide_count = ?, updated_at = datetime("now") WHERE id = ?'
    ).run(fixedHtml, slideCount, row.id);
    results.push({ id: row.id, title: row.title, slide_count: slideCount });
  }

  res.json({ migrated: results.length, results });
});

// ─── Public presentation view ─────────────────────────────────────────────

app.get('/view/:token', (req, res) => {
  const db = require('./database');
  const row = db.prepare('SELECT * FROM presentations WHERE share_token = ?').get(req.params.token);
  if (!row || !row.html_content) {
    return res.status(404).send('<!DOCTYPE html><html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0f;color:#e2e8f0"><h2>Präsentation nicht gefunden</h2></body></html>');
  }
  db.prepare('UPDATE presentations SET view_count = view_count + 1 WHERE id = ?').run(row.id);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(row.html_content);
});

// ─── Settings API ─────────────────────────────────────────────────────────

app.get('/api/settings', (req, res) => {
  const db = require('./database');
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)]));
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  const db = require('./database');
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const updateMany = db.transaction((data) => {
    for (const [key, value] of Object.entries(data)) {
      upsert.run(key, JSON.stringify(value));
    }
  });
  updateMany(req.body);
  res.json({ ok: true });
});

// Slide Library
app.get('/api/slide-library', (req, res) => {
  const db = require('./database');
  const rows = db.prepare('SELECT * FROM slide_library ORDER BY created_at DESC').all();
  res.json(rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') })));
});

// ─── SPA fallback ─────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Error handler ────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║      ◈  SLIDES.IQ — AI STUDIO  ◈     ║
║   http://localhost:${PORT}              ║
╚═══════════════════════════════════════╝
  `);
});

module.exports = app;
