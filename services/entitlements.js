'use strict';

// ─── Entitlements & usage metering ─────────────────────────────────────────
// Synchronous (better-sqlite3). Resolves a user's effective plan, current usage
// and remaining quota, and provides the enforcement helpers used by middleware.

const db = require('../database');
const { getPlan, DEFAULT_PLAN, isUnlimited } = require('./plans');

// Calendar-month period key. Reset is implicit: a new month = new key = count 0.
function currentPeriod() {
  return new Date().toISOString().slice(0, 7); // 'YYYY-MM'
}

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

const getSub = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?');
const countPresentations = db.prepare('SELECT COUNT(*) AS c FROM presentations WHERE user_id = ?');
const getCounter = db.prepare('SELECT count FROM usage_counters WHERE user_id = ? AND period = ? AND metric = ?');
const upsertCounter = db.prepare(`
  INSERT INTO usage_counters (user_id, period, metric, count, updated_at)
  VALUES (?, ?, ?, ?, datetime('now'))
  ON CONFLICT(user_id, period, metric)
    DO UPDATE SET count = count + excluded.count, updated_at = datetime('now')
`);

function getSubscription(userId) {
  return getSub.get(userId) || null;
}

// Effective plan id: admin override wins; otherwise the stored plan only counts
// while the subscription status is active/trialing, else falls back to Free.
function getEffectivePlanId(userId) {
  const sub = getSubscription(userId);
  if (!sub) return DEFAULT_PLAN;
  if (sub.admin_override_plan) return sub.admin_override_plan;
  if (ACTIVE_STATUSES.has(sub.status)) return sub.plan || DEFAULT_PLAN;
  return DEFAULT_PLAN;
}

function getPlanForUser(userId) {
  return getPlan(getEffectivePlanId(userId));
}

function getUsage(userId) {
  const gen = getCounter.get(userId, currentPeriod(), 'ai_generations');
  const img = getCounter.get(userId, currentPeriod(), 'image_generations');
  const aud = getCounter.get(userId, currentPeriod(), 'audio_generations');
  const pres = countPresentations.get(userId);
  return {
    aiGenerations: gen ? gen.count : 0,
    imageGenerations: img ? img.count : 0,
    audioGenerations: aud ? aud.count : 0,
    presentations: pres ? pres.c : 0,
  };
}

function incrementUsage(userId, metric = 'ai_generations', n = 1) {
  upsertCounter.run(userId, currentPeriod(), metric, n);
}

function getEntitlements(userId) {
  const plan = getPlanForUser(userId);
  const sub = getSubscription(userId);
  const usage = getUsage(userId);
  const imageLimit = plan.limits.imageGenerationsPerMonth ?? 0;
  const audioLimit = plan.limits.audioGenerationsPerMonth ?? 0;
  const remaining = {
    aiGenerations: isUnlimited(plan.limits.aiGenerationsPerMonth)
      ? -1 : Math.max(0, plan.limits.aiGenerationsPerMonth - usage.aiGenerations),
    presentations: isUnlimited(plan.limits.maxPresentations)
      ? -1 : Math.max(0, plan.limits.maxPresentations - usage.presentations),
    imageGenerations: isUnlimited(imageLimit)
      ? -1 : Math.max(0, imageLimit - usage.imageGenerations),
    audioGenerations: isUnlimited(audioLimit)
      ? -1 : Math.max(0, audioLimit - usage.audioGenerations),
  };
  return {
    plan: { id: plan.id, name: plan.name, limits: plan.limits, features: plan.features },
    usage,
    remaining,
    status: sub ? sub.status : 'active',
    periodEnd: sub ? sub.current_period_end : null,
    cancelAtPeriodEnd: sub ? !!sub.cancel_at_period_end : false,
    stripeCustomerId: sub ? sub.stripe_customer_id : null,
  };
}

// ─── Enforcement helpers (return {ok} or {ok:false, ...}) ──────────────────

function canGenerate(userId) {
  const plan = getPlanForUser(userId);
  const limit = plan.limits.aiGenerationsPerMonth;
  if (isUnlimited(limit)) return { ok: true };
  const used = getUsage(userId).aiGenerations;
  if (used < limit) return { ok: true };
  return { ok: false, reason: 'ai_quota', code: 'ai_quota_exceeded', limit, used, plan: plan.id };
}

function canCreatePresentation(userId) {
  const plan = getPlanForUser(userId);
  const limit = plan.limits.maxPresentations;
  if (isUnlimited(limit)) return { ok: true };
  const used = getUsage(userId).presentations;
  if (used < limit) return { ok: true };
  return { ok: false, reason: 'presentation_limit', code: 'presentation_limit_exceeded', limit, used, plan: plan.id };
}

function canGenerateImage(userId) {
  const plan = getPlanForUser(userId);
  const limit = plan.limits.imageGenerationsPerMonth ?? 0;
  if (isUnlimited(limit)) return { ok: true };
  const used = getUsage(userId).imageGenerations;
  if (used < limit) return { ok: true };
  return { ok: false, reason: 'image_quota', code: 'image_quota_exceeded', limit, used, plan: plan.id };
}

function canGenerateAudio(userId) {
  const plan = getPlanForUser(userId);
  const limit = plan.limits.audioGenerationsPerMonth ?? 0;
  if (isUnlimited(limit)) return { ok: true };
  const used = getUsage(userId).audioGenerations;
  if (used < limit) return { ok: true };
  return { ok: false, reason: 'audio_quota', code: 'audio_quota_exceeded', limit, used, plan: plan.id };
}

function hasFeature(userId, flag) {
  return !!getPlanForUser(userId).features[flag];
}

module.exports = {
  currentPeriod,
  getSubscription,
  getEffectivePlanId,
  getPlanForUser,
  getUsage,
  incrementUsage,
  getEntitlements,
  canGenerate,
  canCreatePresentation,
  canGenerateImage,
  canGenerateAudio,
  hasFeature,
};
