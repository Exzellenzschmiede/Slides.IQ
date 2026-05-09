'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const BetterSqliteStore = require('better-sqlite3-session-store')(session);
const Database = require('better-sqlite3');

const { requireAuth, requireAdmin } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);

// ─── WebSocket for Live Audience Mode ────────────────────────────────────

const wss = new WebSocket.Server({ server, path: '/ws' });
const rooms = new Map();

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://x').searchParams.get('token');
  if (!token) { ws.close(); return; }

  if (!rooms.has(token)) rooms.set(token, new Set());
  rooms.get(token).add(ws);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
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

app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));

const sessionDb = new Database('./data/sessions.db');
app.use(session({
  store: new BetterSqliteStore({ client: sessionDb }),
  secret: process.env.SESSION_SECRET || 'slides-iq-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

// ─── Rate limiting ────────────────────────────────────────────────────────

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many AI requests. Please wait.' }
});

// ─── Auth Routes (public) ─────────────────────────────────────────────────

app.use('/api/auth', require('./routes/auth'));

// ─── Protected API Routes ─────────────────────────────────────────────────

app.use('/api/presentations', requireAuth, require('./routes/presentations'));
app.use('/api/templates', requireAuth, require('./routes/templates'));
app.use('/api/ai', requireAuth, aiLimiter, require('./routes/ai'));

// ─── Settings API (user-scoped) ───────────────────────────────────────────

app.get('/api/settings', requireAuth, (req, res) => {
  const db = require('./database');
  const userId = req.session.userId;
  const rows = db.prepare('SELECT key, value FROM settings WHERE user_id = ?').all(userId);
  // Fall back to global settings (user_id = '') for keys not yet set by user
  const globalRows = db.prepare("SELECT key, value FROM settings WHERE user_id = ''").all();
  const global = Object.fromEntries(globalRows.map(r => [r.key, JSON.parse(r.value)]));
  const user = Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)]));
  res.json({ ...global, ...user });
});

app.put('/api/settings', requireAuth, (req, res) => {
  const db = require('./database');
  const userId = req.session.userId;
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value, user_id) VALUES (?, ?, ?)');
  const updateMany = db.transaction((data) => {
    for (const [key, value] of Object.entries(data)) {
      upsert.run(key, JSON.stringify(value), userId);
    }
  });
  updateMany(req.body);
  res.json({ ok: true });
});

// ─── Admin: Global AI settings ────────────────────────────────────────────

app.get('/api/admin/ai-settings', requireAdmin, (req, res) => {
  const db = require('./database');
  const row = db.prepare("SELECT value FROM settings WHERE key = 'preferences' AND user_id = ''").get();
  const prefs = row ? JSON.parse(row.value) : {};
  res.json({
    aiProvider: prefs.aiProvider || 'anthropic',
    aiProviders: prefs.aiProviders || {}
  });
});

app.put('/api/admin/ai-settings', requireAdmin, (req, res) => {
  const db = require('./database');
  const { aiProvider, aiProviders } = req.body;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'preferences' AND user_id = ''").get();
  const prefs = row ? JSON.parse(row.value) : {};
  prefs.aiProvider = aiProvider || prefs.aiProvider || 'anthropic';
  if (aiProviders) prefs.aiProviders = aiProviders;
  db.prepare("INSERT OR REPLACE INTO settings (key, value, user_id) VALUES ('preferences', ?, '')").run(JSON.stringify(prefs));
  res.json({ ok: true });
});

// ─── Admin: Framework migration ───────────────────────────────────────────

app.post('/api/admin/migrate-frameworks', requireAdmin, (req, res) => {
  const db = require('./database');
  const { injectFramework } = require('./services/claude');
  const rows = db.prepare('SELECT id, title, html_content FROM presentations WHERE html_content IS NOT NULL AND html_content != ""').all();
  const results = [];
  for (const row of rows) {
    const fixedHtml = injectFramework(row.html_content);
    const slideCount = (fixedHtml.match(/class="slide(?:\s|")/g) || []).length;
    db.prepare('UPDATE presentations SET html_content = ?, slide_count = ?, updated_at = datetime("now") WHERE id = ?').run(fixedHtml, slideCount, row.id);
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

// ─── SPA fallback ─────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Error handler ────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── Startup: re-inject framework into all existing presentations ─────────

(function migrateFrameworks() {
  try {
    const db = require('./database');
    const { injectFramework } = require('./services/claude');
    const rows = db.prepare('SELECT id, html_content FROM presentations WHERE html_content IS NOT NULL AND html_content != ""').all();
    const update = db.prepare('UPDATE presentations SET html_content = ?, slide_count = ?, updated_at = datetime("now") WHERE id = ?');
    let count = 0;
    for (const row of rows) {
      const fixed = injectFramework(row.html_content);
      const slides = (fixed.match(/class="slide(?:\s|")/g) || []).length;
      update.run(fixed, slides, row.id);
      count++;
    }
    if (count) console.log(`[startup] Framework re-injected into ${count} presentation(s)`);
  } catch (e) {
    console.warn('[startup] Framework migration failed:', e.message);
  }
})();

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
