'use strict';

// ─── Subscription plans ────────────────────────────────────────────────────
// Source of truth for tier limits & features (code, not DB — referenced on the
// hot path and versioned with the app). The DB only stores WHICH plan a user is
// on. Stripe Price IDs are Admin-managed (services/appSettings) and resolved at
// call time, so changing them in the Admin panel takes effect without a restart.
//
// Limit dimensions (per the product decision): monthly AI generations + number
// of stored presentations. Feature flags are a secondary lever. -1 = unlimited.

const { getStripeSettings } = require('./appSettings');

// Static plan definitions. `priceField` / `priceFieldAnnual` name the Stripe
// settings keys that hold the live Price IDs (null for the free tier).
const PLAN_DEFS = {
  free: {
    id: 'free',
    name: 'Free',
    priceField: null,
    priceFieldAnnual: null,
    limits: { aiGenerationsPerMonth: 10, maxPresentations: 3 },
    features: { exportPdf: false, exportHtml: true, customBranding: false, liveAudience: false, narrativeAnalysis: false },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceField: 'pricePro',
    priceFieldAnnual: 'priceProAnnual',
    limits: { aiGenerationsPerMonth: 150, maxPresentations: 100 },
    features: { exportPdf: true, exportHtml: true, customBranding: true, liveAudience: true, narrativeAnalysis: true },
  },
  business: {
    id: 'business',
    name: 'Business',
    priceField: 'priceBusiness',
    priceFieldAnnual: 'priceBusinessAnnual',
    limits: { aiGenerationsPerMonth: 600, maxPresentations: -1 },
    features: { exportPdf: true, exportHtml: true, customBranding: true, liveAudience: true, narrativeAnalysis: true },
  },
};

const DEFAULT_PLAN = 'free';

// Resolve a plan definition into a concrete plan with live Stripe Price IDs.
function resolvePlan(def, stripeSettings) {
  return {
    id: def.id,
    name: def.name,
    limits: def.limits,
    features: def.features,
    stripePriceId: def.priceField ? (stripeSettings[def.priceField] || null) : null,
    stripePriceIdAnnual: def.priceFieldAnnual ? (stripeSettings[def.priceFieldAnnual] || null) : null,
  };
}

function getPlan(planId) {
  const def = PLAN_DEFS[planId] || PLAN_DEFS[DEFAULT_PLAN];
  return resolvePlan(def, getStripeSettings());
}

// Reverse lookup: Stripe price id → plan id (used by the webhook).
function planForPriceId(priceId) {
  if (!priceId) return DEFAULT_PLAN;
  const s = getStripeSettings();
  for (const def of Object.values(PLAN_DEFS)) {
    const monthly = def.priceField ? s[def.priceField] : null;
    const annual = def.priceFieldAnnual ? s[def.priceFieldAnnual] : null;
    if (priceId === monthly || priceId === annual) return def.id;
  }
  return DEFAULT_PLAN;
}

function isUnlimited(n) {
  return n === -1;
}

// Public, safe-to-expose view of the plans (no internal-only fields).
function publicPlans() {
  const s = getStripeSettings();
  return Object.values(PLAN_DEFS).map((def) => {
    const p = resolvePlan(def, s);
    return {
      id: p.id,
      name: p.name,
      limits: p.limits,
      features: p.features,
      hasCheckout: !!p.stripePriceId,
    };
  });
}

module.exports = { PLAN_DEFS, DEFAULT_PLAN, getPlan, planForPriceId, isUnlimited, publicPlans };
