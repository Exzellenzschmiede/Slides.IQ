'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ─── Setup (first admin, only when no users exist) ────────────────────────

router.get('/setup-needed', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get();
  res.json({ needed: count.c === 0 });
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

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });

  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.name = user.name;
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
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

// ─── Admin: User list ─────────────────────────────────────────────────────

router.get('/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, email, name, role, created_at FROM users ORDER BY created_at ASC').all();
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

// ─── Admin: Delete user ───────────────────────────────────────────────────

router.delete('/users/:id', requireAdmin, (req, res) => {
  if (req.params.id === req.session.userId) return res.status(400).json({ error: 'Eigenen Account kann man nicht löschen' });
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'User nicht gefunden' });
  res.json({ ok: true });
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
