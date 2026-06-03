'use strict';

// ─── Subscription plans ────────────────────────────────────────────────────
// Source of truth for tier limits & features (code, not DB — referenced on the
// hot path and versioned with the app). The DB only stores WHICH plan a user is
// on. Stripe Price IDs come from the environment.
//
// Limit dimensions (per the product decision): monthly AI generations + number
// of stored presentations. Feature flags are a secondary lever. -1 = unlimited.

const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    stripePriceId: null,
    limits: { aiGenerationsPerMonth: 10, maxPresentations: 3 },
    features: { exportPdf: false, exportHtml: true, customBranding: false, liveAudience: false, narrativeAnalysis: false },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    stripePriceId: process.env.STRIPE_PRICE_PRO || null,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_PRO_ANNUAL || null,
    limits: { aiGenerationsPerMonth: 150, maxPresentations: 100 },
    features: { exportPdf: true, exportHtml: true, customBranding: true, liveAudience: true, narrativeAnalysis: true },
  },
  business: {
    id: 'business',
    name: 'Business',
    stripePriceId: process.env.STRIPE_PRICE_BUSINESS || null,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_BUSINESS_ANNUAL || null,
    limits: { aiGenerationsPerMonth: 600, maxPresentations: -1 },
    features: { exportPdf: true, exportHtml: true, customBranding: true, liveAudience: true, narrativeAnalysis: true },
  },
};

const DEFAULT_PLAN = 'free';

function getPlan(planId) {
  return PLANS[planId] || PLANS[DEFAULT_PLAN];
}

// Reverse lookup: Stripe price id → plan id (used by the webhook).
function planForPriceId(priceId) {
  if (!priceId) return DEFAULT_PLAN;
  for (const p of Object.values(PLANS)) {
    if (p.stripePriceId === priceId || p.stripePriceIdAnnual === priceId) return p.id;
  }
  return DEFAULT_PLAN;
}

function isUnlimited(n) {
  return n === -1;
}

// Public, safe-to-expose view of the plans (no internal-only fields).
function publicPlans() {
  return Object.values(PLANS).map((p) => ({
    id: p.id,
    name: p.name,
    limits: p.limits,
    features: p.features,
    hasCheckout: !!p.stripePriceId,
  }));
}

module.exports = { PLANS, DEFAULT_PLAN, getPlan, planForPriceId, isUnlimited, publicPlans };
