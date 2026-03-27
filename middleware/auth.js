'use strict';

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Nicht angemeldet' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Nicht angemeldet' });
  }
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
