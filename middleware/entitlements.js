'use strict';

// ─── Entitlement enforcement middleware ────────────────────────────────────
// Emits a consistent machine-readable body so the frontend can show an upgrade
// prompt. 402 = usage/quota limit; 403 = feature locked.

const ent = require('../services/entitlements');
const { getPlan } = require('../services/plans');

// Suggest the next tier up for an upgrade CTA.
const NEXT_TIER = { free: 'pro', pro: 'business', business: 'business' };

function upgradeInfo(currentPlanId) {
  const to = NEXT_TIER[currentPlanId] || 'pro';
  return { to, hasCheckout: !!getPlan(to).stripePriceId };
}

function requireCanGenerate(req, res, next) {
  const r = ent.canGenerate(req.session.userId);
  if (r.ok) return next();
  return res.status(402).json({
    error: `Monatliches Limit an KI-Generierungen erreicht (${r.used}/${r.limit}).`,
    code: r.code, limit: r.limit, used: r.used, plan: r.plan,
    upgrade: upgradeInfo(r.plan),
  });
}

function requireCanCreatePresentation(req, res, next) {
  const r = ent.canCreatePresentation(req.session.userId);
  if (r.ok) return next();
  return res.status(402).json({
    error: `Limit gespeicherter Präsentationen erreicht (${r.used}/${r.limit}).`,
    code: r.code, limit: r.limit, used: r.used, plan: r.plan,
    upgrade: upgradeInfo(r.plan),
  });
}

function requireFeature(flag) {
  return (req, res, next) => {
    if (ent.hasFeature(req.session.userId, flag)) return next();
    const plan = ent.getPlanForUser(req.session.userId);
    return res.status(403).json({
      error: 'Diese Funktion ist in deinem Tarif nicht enthalten.',
      code: 'feature_locked', feature: flag, plan: plan.id,
      upgrade: upgradeInfo(plan.id),
    });
  };
}

module.exports = { requireCanGenerate, requireCanCreatePresentation, requireFeature };
