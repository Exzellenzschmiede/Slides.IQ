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

// Stripe webhook needs the RAW body for signature verification — must be
// registered BEFORE the global express.json() parser.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), require('./routes/billing').webhookHandler);

app.use(express.json({ limit: '50mb' }));

// Fail fast in production if the session secret is missing/default.
if (process.env.NODE_ENV === 'production' &&
    (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'slides-iq-secret-change-me')) {
  console.error('FATAL: SESSION_SECRET must be set to a strong unique value in production.');
  process.exit(1);
}

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

// index:false so a bare GET '/' is NOT auto-served as a shell — the public
// marketing landing owns '/', the SPA shell (app.html) is served at '/app'.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ─── Rate limiting ────────────────────────────────────────────────────────

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many AI requests. Please wait.' }
});

// Abuse protection for public auth endpoints (per-IP; trust proxy is set).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Zu viele Versuche. Bitte später erneut versuchen.' }
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  message: { error: 'Zu viele Versuche. Bitte später erneut versuchen.' }
});

// ─── Auth Routes (public) ─────────────────────────────────────────────────

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', registerLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/auth/resend-verification', registerLimiter);
app.use('/api/auth', require('./routes/auth'));

// ─── Protected API Routes ─────────────────────────────────────────────────

app.use('/api/presentations', requireAuth, require('./routes/presentations'));
app.use('/api/templates', requireAuth, require('./routes/templates'));
app.use('/api/ai', requireAuth, aiLimiter, require('./routes/ai'));
app.use('/api/creations', requireAuth, require('./routes/creations'));
app.use('/api/billing', requireAuth, require('./routes/billing').router);

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
    aiProviders: prefs.aiProviders || {},
    imageProvider: prefs.imageProvider || 'openai',
    imageProviders: prefs.imageProviders || {},
    audioProvider: prefs.audioProvider || 'elevenlabs',
    audioProviders: prefs.audioProviders || {}
  });
});

app.put('/api/admin/ai-settings', requireAdmin, (req, res) => {
  const db = require('./database');
  const { aiProvider, aiProviders, imageProvider, imageProviders, audioProvider, audioProviders } = req.body;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'preferences' AND user_id = ''").get();
  const prefs = row ? JSON.parse(row.value) : {};
  prefs.aiProvider = aiProvider || prefs.aiProvider || 'anthropic';
  if (aiProviders) prefs.aiProviders = aiProviders;
  if (imageProvider) prefs.imageProvider = imageProvider;
  if (imageProviders) prefs.imageProviders = imageProviders;
  if (audioProvider) prefs.audioProvider = audioProvider;
  if (audioProviders) prefs.audioProviders = audioProviders;
  db.prepare("INSERT OR REPLACE INTO settings (key, value, user_id) VALUES ('preferences', ?, '')").run(JSON.stringify(prefs));
  res.json({ ok: true });
});

// ─── Admin: Global email (SMTP) settings ──────────────────────────────────

app.get('/api/admin/email-settings', requireAdmin, (req, res) => {
  const { getEmailSettings } = require('./services/appSettings');
  res.json(getEmailSettings());
});

app.put('/api/admin/email-settings', requireAdmin, (req, res) => {
  const { setEmailSettings } = require('./services/appSettings');
  res.json(setEmailSettings(req.body || {}));
});

// ─── Admin: Global Stripe settings ─────────────────────────────────────────

app.get('/api/admin/stripe-settings', requireAdmin, (req, res) => {
  const { getStripeSettings } = require('./services/appSettings');
  res.json(getStripeSettings());
});

app.put('/api/admin/stripe-settings', requireAdmin, (req, res) => {
  const { setStripeSettings } = require('./services/appSettings');
  res.json(setStripeSettings(req.body || {}));
});

// ─── Admin: per-user plan override ────────────────────────────────────────

app.put('/api/admin/users/:id/plan', requireAdmin, (req, res) => {
  const db = require('./database');
  const { plan } = req.body; // 'free' | 'pro' | 'business' | null (clear override)
  if (plan && !['free', 'pro', 'business'].includes(plan)) {
    return res.status(400).json({ error: 'Ungültiger Tarif' });
  }
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
  db.prepare(`
    INSERT INTO subscriptions (user_id, admin_override_plan, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET admin_override_plan = excluded.admin_override_plan, updated_at = datetime('now')
  `).run(req.params.id, plan || null);
  res.json({ ok: true, plan: plan || null });
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

// ─── Public creation (image) share ─────────────────────────────────────────
// A gallery page for a shared image creation, plus per-asset streaming.

app.get('/view/creation/:token', (req, res) => {
  const db = require('./database');
  const row = db.prepare('SELECT * FROM creations WHERE share_token = ?').get(req.params.token);
  if (!row) {
    return res.status(404).send('<!DOCTYPE html><html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#05070f;color:#e2e8f0"><h2>Nicht gefunden</h2></body></html>');
  }
  const assets = db.prepare('SELECT id FROM creation_assets WHERE creation_id = ? ORDER BY position ASC, created_at ASC').all(row.id);
  db.prepare('UPDATE creations SET view_count = view_count + 1 WHERE id = ?').run(row.id);
  const imgs = assets.map(a =>
    `<img src="/view/creation/${req.params.token}/${a.id}" alt="" loading="lazy">`
  ).join('');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${row.title.replace(/</g, '&lt;')} — glowwee</title>
<style>*{box-sizing:border-box;margin:0}body{font-family:Inter,system-ui,sans-serif;background:#05070f;color:#e2e8f0;padding:32px}h1{font-size:22px;margin-bottom:24px;background:linear-gradient(135deg,#9d5cf0,#22d3ee);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}img{width:100%;border-radius:16px;border:1px solid rgba(255,255,255,.08);display:block}
.footer{margin-top:32px;font-size:12px;color:rgba(226,232,240,.4)}</style></head>
<body><h1>${row.title.replace(/</g, '&lt;')}</h1><div class="grid">${imgs || '<p>Noch keine Bilder.</p>'}</div><div class="footer">Erstellt mit glowwee Creative Studio</div></body></html>`);
});

app.get('/view/creation/:token/:assetId', (req, res) => {
  const db = require('./database');
  const assetStore = require('./services/assetStore');
  const row = db.prepare('SELECT id FROM creations WHERE share_token = ?').get(req.params.token);
  if (!row) return res.status(404).send('Not found');
  const asset = db.prepare('SELECT * FROM creation_assets WHERE id = ? AND creation_id = ?').get(req.params.assetId, row.id);
  if (!asset) return res.status(404).send('Not found');
  let abs;
  try { abs = assetStore.absolutePath(asset.file_path); } catch { return res.status(400).send('Bad path'); }
  res.setHeader('Content-Type', asset.mime_type);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(abs);
});

// ─── Public marketing site ────────────────────────────────────────────────
// '/' and '/pricing' serve the standalone marketing landing. Legal and auth
// helper pages are added by their respective workstreams once the files exist.

const sendPublic = (file) => (req, res) => res.sendFile(path.join(__dirname, 'public', file));

app.get('/', sendPublic('landing.html'));
app.get('/pricing', sendPublic('landing.html'));
app.get('/impressum', sendPublic('legal/impressum.html'));
app.get('/datenschutz', sendPublic('legal/datenschutz.html'));

// ─── Authenticated SPA shell (hash-routed) ────────────────────────────────

app.get(['/app', '/app/*'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// ─── Fallback: unknown paths go to the marketing home ─────────────────────

app.get('*', (req, res) => res.redirect('/'));

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
    const rows = db.prepare("SELECT id, html_content FROM presentations WHERE html_content IS NOT NULL AND html_content != ''").all();
    const update = db.prepare("UPDATE presentations SET html_content = ?, slide_count = ?, updated_at = datetime('now') WHERE id = ?");
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
║      ◈  GLOWWEE — AI STUDIO  ◈     ║
║   http://localhost:${PORT}              ║
╚═══════════════════════════════════════╝
  `);
});

module.exports = app;
