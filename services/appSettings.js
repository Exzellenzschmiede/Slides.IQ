'use strict';

// ─── Global application settings (admin-managed) ───────────────────────────
// Email (SMTP) and Stripe configuration live in the `settings` table under the
// global scope (user_id = ''), managed from the Admin panel — NOT from .env.
//
// For backward-compatibility during migration, an unset field falls back to the
// corresponding environment variable, so existing deployments keep working
// until an admin saves values in the panel. Once saved, the DB always wins and
// the .env entries can be removed.

const db = require('../database');

function readGroup(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ? AND user_id = ''").get(key);
  try { return row ? JSON.parse(row.value) : {}; } catch { return {}; }
}

function writeGroup(key, obj) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value, user_id) VALUES (?, ?, '')")
    .run(key, JSON.stringify(obj));
}

// First non-empty value among the candidates ('' / null / undefined are skipped).
function pick(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
}

// ─── Base URL (used for email links & Stripe redirects) ────────────────────

function getBaseUrl() {
  const s = readGroup('email');
  return pick(s.baseUrl, process.env.BASE_URL, 'http://localhost:3000');
}

// ─── Email / SMTP ──────────────────────────────────────────────────────────

function getEmailSettings() {
  const s = readGroup('email');
  const secure = s.secure !== undefined
    ? !!s.secure
    : String(process.env.SMTP_SECURE).toLowerCase() === 'true';
  return {
    host: pick(s.host, process.env.SMTP_HOST),
    port: parseInt(pick(s.port, process.env.SMTP_PORT, '25'), 10) || 25,
    secure,
    from: pick(s.from, process.env.SMTP_FROM, 'Slides.IQ <noreply@exzellenzschmiede.de>'),
    user: pick(s.user, process.env.SMTP_USER),
    pass: pick(s.pass, process.env.SMTP_PASS),
    baseUrl: pick(s.baseUrl, process.env.BASE_URL, 'http://localhost:3000'),
  };
}

function setEmailSettings(input = {}) {
  const cur = readGroup('email');
  const next = {
    host: input.host ?? cur.host ?? '',
    port: input.port !== undefined && input.port !== '' ? (parseInt(input.port, 10) || 25) : (cur.port ?? 25),
    secure: input.secure !== undefined ? !!input.secure : (cur.secure ?? false),
    from: input.from ?? cur.from ?? '',
    user: input.user ?? cur.user ?? '',
    pass: input.pass ?? cur.pass ?? '',
    baseUrl: input.baseUrl ?? cur.baseUrl ?? '',
  };
  writeGroup('email', next);
  return next;
}

// ─── Stripe ──────────────────────────────────────────────────────────────

const STRIPE_FIELDS = ['secretKey', 'webhookSecret', 'pricePro', 'priceProAnnual', 'priceBusiness', 'priceBusinessAnnual'];
const STRIPE_ENV = {
  secretKey: 'STRIPE_SECRET_KEY',
  webhookSecret: 'STRIPE_WEBHOOK_SECRET',
  pricePro: 'STRIPE_PRICE_PRO',
  priceProAnnual: 'STRIPE_PRICE_PRO_ANNUAL',
  priceBusiness: 'STRIPE_PRICE_BUSINESS',
  priceBusinessAnnual: 'STRIPE_PRICE_BUSINESS_ANNUAL',
};

function getStripeSettings() {
  const s = readGroup('stripe');
  const out = {};
  for (const f of STRIPE_FIELDS) out[f] = pick(s[f], process.env[STRIPE_ENV[f]]);
  return out;
}

function setStripeSettings(input = {}) {
  const cur = readGroup('stripe');
  const next = {};
  for (const f of STRIPE_FIELDS) next[f] = input[f] ?? cur[f] ?? '';
  writeGroup('stripe', next);
  return next;
}

module.exports = {
  getBaseUrl,
  getEmailSettings, setEmailSettings,
  getStripeSettings, setStripeSettings,
};
