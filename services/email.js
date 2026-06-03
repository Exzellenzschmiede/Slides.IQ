'use strict';

// ─── Email service ─────────────────────────────────────────────────────────
// Sends via a Postfix relay on the host (host.docker.internal:25, no auth).
// If SMTP_HOST is unset, falls back to dev mode: the full message incl. the
// link is logged to the console with an [email:dev] prefix — so the whole
// verification/reset flow is testable with zero email infrastructure.

const nodemailer = require('nodemailer');

const FROM = process.env.SMTP_FROM || 'Slides.IQ <noreply@exzellenzschmiede.de>';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

let _transport = null;
function transport() {
  if (_transport) return _transport;
  if (!process.env.SMTP_HOST) return null; // dev mode
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  _transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '25', 10),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: (user && pass) ? { user, pass } : undefined, // Postfix relay: no auth
    tls: { rejectUnauthorized: false }, // trusted local/plaintext relay
  });
  return _transport;
}

function isConfigured() {
  return !!process.env.SMTP_HOST;
}

async function sendMail({ to, subject, html, text }) {
  const tx = transport();
  if (!tx) {
    // Dev fallback: log instead of sending (never throws).
    console.log(`\n[email:dev] → ${to}\n[email:dev] subject: ${subject}\n[email:dev] ${text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n`);
    return { dev: true };
  }
  return tx.sendMail({ from: FROM, to, subject, html, text });
}

// ─── Templates ─────────────────────────────────────────────────────────────

function shell(title, bodyHtml, ctaUrl, ctaLabel) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#05070f;font-family:Inter,Arial,sans-serif;color:#e2e8f0;padding:32px">
  <div style="max-width:520px;margin:0 auto;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:32px">
    <div style="font-weight:800;font-size:20px;margin-bottom:20px">◈ Slides.IQ</div>
    <h1 style="font-size:22px;margin:0 0 14px">${title}</h1>
    <div style="color:rgba(226,232,240,0.7);font-size:15px;line-height:1.6">${bodyHtml}</div>
    <a href="${ctaUrl}" style="display:inline-block;margin-top:24px;background:linear-gradient(135deg,#7c3aed,#06b6d4);color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:12px">${ctaLabel}</a>
    <div style="color:rgba(226,232,240,0.35);font-size:12px;margin-top:24px;word-break:break-all">${ctaUrl}</div>
  </div></body></html>`;
}

const COPY = {
  verify: {
    de: { subject: 'Bestätige deine E-Mail-Adresse', title: 'Willkommen bei Slides.IQ', body: (n) => `Hallo ${n}, bitte bestätige deine E-Mail-Adresse, um dein Konto zu aktivieren.`, cta: 'E-Mail bestätigen' },
    en: { subject: 'Confirm your email address', title: 'Welcome to Slides.IQ', body: (n) => `Hi ${n}, please confirm your email address to activate your account.`, cta: 'Confirm email' },
  },
  reset: {
    de: { subject: 'Passwort zurücksetzen', title: 'Passwort zurücksetzen', body: (n) => `Hallo ${n}, du hast eine Zurücksetzung deines Passworts angefordert. Der Link ist 1 Stunde gültig. Falls du das nicht warst, ignoriere diese E-Mail.`, cta: 'Neues Passwort setzen' },
    en: { subject: 'Reset your password', title: 'Reset your password', body: (n) => `Hi ${n}, you requested a password reset. This link is valid for 1 hour. If this wasn't you, ignore this email.`, cta: 'Set a new password' },
  },
};

function pick(kind, locale) {
  const group = COPY[kind];
  return group[locale] || group.de;
}

function esc(s) {
  return String(s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

async function sendVerificationEmail(to, name, verifyUrl, locale = 'de') {
  const c = pick('verify', locale);
  const safeName = esc(name);
  try {
    await sendMail({ to, subject: c.subject, html: shell(c.title, c.body(safeName), verifyUrl, c.cta), text: `${c.body(name)}\n\n${verifyUrl}` });
  } catch (e) {
    console.warn('[email] verification send failed:', e.message);
  }
}

async function sendPasswordResetEmail(to, name, resetUrl, locale = 'de') {
  const c = pick('reset', locale);
  const safeName = esc(name);
  try {
    await sendMail({ to, subject: c.subject, html: shell(c.title, c.body(safeName), resetUrl, c.cta), text: `${c.body(name)}\n\n${resetUrl}` });
  } catch (e) {
    console.warn('[email] reset send failed:', e.message);
  }
}

module.exports = { isConfigured, sendMail, sendVerificationEmail, sendPasswordResetEmail, BASE_URL };
