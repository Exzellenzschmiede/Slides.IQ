'use strict';

// ─── Single-use, expiring auth tokens (email verify & password reset) ──────
// The RAW token (256-bit, URL-safe) is only ever placed in the emailed link.
// The DB stores only its SHA-256 hash, so a DB leak does not yield usable links.

const crypto = require('crypto');
const db = require('../database');

const TTL = {
  verify: 24 * 60 * 60, // 24h
  reset: 60 * 60,       // 1h
};

function hash(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

const delByUserType = db.prepare('DELETE FROM auth_tokens WHERE user_id = ? AND type = ?');
const insertToken = db.prepare(
  "INSERT INTO auth_tokens (token, user_id, type, expires_at) VALUES (?, ?, ?, datetime('now', ?))"
);
const selectToken = db.prepare('SELECT user_id, type, expires_at, used_at FROM auth_tokens WHERE token = ?');
const markUsed = db.prepare("UPDATE auth_tokens SET used_at = datetime('now') WHERE token = ?");

// Issue a fresh token of `type` for a user. Invalidates older unused tokens of
// the same type so only the latest emailed link works. Returns the raw token.
function issueToken(userId, type, ttlSeconds = TTL[type] || 3600) {
  const raw = crypto.randomBytes(32).toString('base64url');
  const issue = db.transaction(() => {
    delByUserType.run(userId, type);
    insertToken.run(hash(raw), userId, type, `+${Math.round(ttlSeconds)} seconds`);
  });
  issue();
  return raw;
}

// Validate + consume a token. Returns { userId } if valid & unused & unexpired,
// otherwise null. Marking-used happens atomically inside a transaction.
function consumeToken(raw, type) {
  if (!raw || typeof raw !== 'string') return null;
  const key = hash(raw);
  const consume = db.transaction(() => {
    const row = selectToken.get(key);
    if (!row || row.type !== type || row.used_at) return null;
    const expired = db.prepare("SELECT (expires_at < datetime('now')) AS e FROM auth_tokens WHERE token = ?").get(key);
    if (!expired || expired.e) return null;
    markUsed.run(key);
    return { userId: row.user_id };
  });
  return consume();
}

module.exports = { issueToken, consumeToken, TTL };
