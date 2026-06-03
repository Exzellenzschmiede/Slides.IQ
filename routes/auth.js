'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { issueToken, consumeToken } = require('../services/tokens');
const email = require('../services/email');

const router = express.Router();

// Generic, enumeration-safe response for register/forgot/resend.
const GENERIC_OK = { ok: true, message: 'Falls die Adresse gültig ist, wurde eine E-Mail gesendet.' };

// ─── Setup (first admin, only when no users exist) ────────────────────────

router.get('/setup-needed', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get();
  res.json({ setupNeeded: count.c === 0 });
});

router.post('/setup', async (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (count.c > 0) return res.status(403).json({ error: 'Setup bereits abgeschlossen' });

  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, E-Mail und Passwort erforderlich' });
  if (password.length < 8) return res.status(400).json({ error: 'Passwort mindestens 8 Zeichen' });

  const hash = await bcrypt.hash(password, 12);
  const id = uuid();
  db.prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)').run(id, email.toLowerCase().trim(), hash, name.trim(), 'admin');

  req.session.userId = id;
  req.session.role = 'admin';
  req.session.name = name.trim();
  res.json({ id, email: email.toLowerCase().trim(), name: name.trim(), role: 'admin' });
});

// ─── Login ────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
  if (user.is_active === 0) return res.status(403).json({ error: 'Konto deaktiviert. Bitte wende dich an einen Administrator.' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });

  // Gate unverified self-registered accounts (checked AFTER password so we
  // never reveal verification status to someone without valid credentials).
  if (user.email_verified === 0) {
    return res.status(403).json({ error: 'Bitte bestätige zuerst deine E-Mail-Adresse.', needsVerification: true });
  }

  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.name = user.name;
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

// ─── Self-service registration ─────────────────────────────────────────────

const VERIFY_URL = (raw) => `${email.BASE_URL}/api/auth/verify?token=${raw}`;
const RESET_URL = (raw) => `${email.BASE_URL}/reset-password?token=${raw}`;

router.post('/register', async (req, res) => {
  const { name, email: rawEmail, password } = req.body;
  if (!name || !rawEmail || !password) return res.status(400).json({ error: 'Name, E-Mail und Passwort erforderlich' });
  if (password.length < 8) return res.status(400).json({ error: 'Passwort mindestens 8 Zeichen' });

  // The very first account must be the admin via /setup.
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (count.c === 0) return res.status(403).json({ error: 'Erstes Konto muss über das Setup angelegt werden.' });

  const mail = String(rawEmail).toLowerCase().trim();
  const existing = db.prepare('SELECT id, email_verified FROM users WHERE email = ?').get(mail);

  if (existing) {
    // Enumeration-safe: same generic response. Only re-send if still unverified.
    if (existing.email_verified === 0) {
      const raw = issueToken(existing.id, 'verify');
      await email.sendVerificationEmail(mail, name.trim(), VERIFY_URL(raw), req.body.locale || 'de');
    }
    return res.json({ ...GENERIC_OK, verificationPending: true });
  }

  const hash = await bcrypt.hash(password, 12);
  const id = uuid();
  db.prepare('INSERT INTO users (id, email, password_hash, name, role, email_verified) VALUES (?, ?, ?, ?, ?, 0)')
    .run(id, mail, hash, name.trim(), 'user');

  const raw = issueToken(id, 'verify');
  await email.sendVerificationEmail(mail, name.trim(), VERIFY_URL(raw), req.body.locale || 'de');
  res.json({ ...GENERIC_OK, verificationPending: true });
});

// ─── Verify email (clicked from email → redirect into the app) ─────────────

router.get('/verify', (req, res) => {
  const result = consumeToken(req.query.token, 'verify');
  if (!result) return res.redirect('/app?verified=0');
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(result.userId);
  res.redirect('/app?verified=1');
});

// ─── Resend verification ───────────────────────────────────────────────────

router.post('/resend-verification', async (req, res) => {
  const mail = String(req.body.email || '').toLowerCase().trim();
  if (mail) {
    const user = db.prepare('SELECT id, name, email_verified FROM users WHERE email = ?').get(mail);
    if (user && user.email_verified === 0) {
      const raw = issueToken(user.id, 'verify');
      await email.sendVerificationEmail(mail, user.name, VERIFY_URL(raw), req.body.locale || 'de');
    }
  }
  res.json(GENERIC_OK);
});

// ─── Forgot password ───────────────────────────────────────────────────────

router.post('/forgot-password', async (req, res) => {
  const mail = String(req.body.email || '').toLowerCase().trim();
  if (mail) {
    const user = db.prepare('SELECT id, name, is_active FROM users WHERE email = ?').get(mail);
    if (user && user.is_active !== 0) {
      const raw = issueToken(user.id, 'reset');
      await email.sendPasswordResetEmail(mail, user.name, RESET_URL(raw), req.body.locale || 'de');
    }
  }
  res.json(GENERIC_OK);
});

// ─── Reset password ────────────────────────────────────────────────────────

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: 'Passwort mindestens 8 Zeichen' });
  const result = consumeToken(token, 'reset');
  if (!result) return res.status(400).json({ error: 'Link ungültig oder abgelaufen' });

  const hash = await bcrypt.hash(password, 12);
  // Clicking a reset link proves email ownership → also mark verified.
  db.prepare('UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?').run(hash, result.userId);
  res.json({ ok: true });
});

// ─── Logout ───────────────────────────────────────────────────────────────

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ─── Me ───────────────────────────────────────────────────────────────────

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Nicht angemeldet' });
  res.json(user);
});

// ─── Update own profile ───────────────────────────────────────────────────

router.put('/me', requireAuth, (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name und E-Mail erforderlich' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.toLowerCase().trim(), req.session.userId);
  if (existing) return res.status(409).json({ error: 'E-Mail bereits vergeben' });

  db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(name.trim(), email.toLowerCase().trim(), req.session.userId);
  req.session.name = name.trim();
  res.json({ ok: true, name: name.trim(), email: email.toLowerCase().trim() });
});

// ─── Change own password ──────────────────────────────────────────────────

router.put('/me/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Aktuelles und neues Passwort erforderlich' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Neues Passwort mindestens 8 Zeichen' });

  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.userId);
  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Aktuelles Passwort falsch' });

  const hash = await bcrypt.hash(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.session.userId);
  res.json({ ok: true });
});

// ─── Admin: User list ─────────────────────────────────────────────────────

router.get('/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, email, name, role, is_active, created_at FROM users ORDER BY created_at ASC').all();
  res.json(users);
});

// ─── Admin: Create user ───────────────────────────────────────────────────

router.post('/users', requireAdmin, async (req, res) => {
  const { name, email, password, role = 'user' } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, E-Mail und Passwort erforderlich' });
  if (password.length < 8) return res.status(400).json({ error: 'Passwort mindestens 8 Zeichen' });
  if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Ungültige Rolle' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'E-Mail bereits vergeben' });

  const hash = await bcrypt.hash(password, 12);
  const id = uuid();
  db.prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)').run(id, email.toLowerCase().trim(), hash, name.trim(), role);
  res.status(201).json({ id, email: email.toLowerCase().trim(), name: name.trim(), role });
});

// ─── Admin: Edit user (name + email) ─────────────────────────────────────

router.put('/users/:id', requireAdmin, async (req, res) => {
  const { name, email, role } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name und E-Mail erforderlich' });
  if (role && !['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Ungültige Rolle' });
  const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.toLowerCase().trim(), req.params.id);
  if (existing) return res.status(409).json({ error: 'E-Mail bereits vergeben' });
  const updates = role
    ? db.prepare('UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?').run(name.trim(), email.toLowerCase().trim(), role, req.params.id)
    : db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(name.trim(), email.toLowerCase().trim(), req.params.id);
  if (updates.changes === 0) return res.status(404).json({ error: 'User nicht gefunden' });
  res.json({ ok: true });
});

// ─── Admin: Toggle active ─────────────────────────────────────────────────

router.put('/users/:id/active', requireAdmin, (req, res) => {
  if (req.params.id === req.session.userId) return res.status(400).json({ error: 'Eigenen Account kann man nicht deaktivieren' });
  const user = db.prepare('SELECT is_active FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
  const newState = user.is_active === 0 ? 1 : 0;
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(newState, req.params.id);
  res.json({ ok: true, is_active: newState });
});

// ─── Admin: Delete user ───────────────────────────────────────────────────

router.delete('/users/:id', requireAdmin, (req, res) => {
  if (req.params.id === req.session.userId) return res.status(400).json({ error: 'Eigenen Account kann man nicht löschen' });
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'User nicht gefunden' });
  res.json({ ok: true });
});

// ─── Admin: Change role ───────────────────────────────────────────────────

router.put('/users/:id/role', requireAdmin, (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Ungültige Rolle' });
  if (req.params.id === req.session.userId) return res.status(400).json({ error: 'Eigene Rolle kann nicht geändert werden' });
  const result = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'User nicht gefunden' });
  res.json({ ok: true, role });
});

// ─── Admin: Reset password ────────────────────────────────────────────────

router.put('/users/:id/password', requireAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: 'Passwort mindestens 8 Zeichen' });
  const hash = await bcrypt.hash(password, 12);
  const result = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'User nicht gefunden' });
  res.json({ ok: true });
});

module.exports = router;
