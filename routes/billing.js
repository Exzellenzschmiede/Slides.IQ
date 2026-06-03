'use strict';

// ─── Billing: Stripe Checkout, Customer Portal & webhook ───────────────────
// Exports { router, webhookHandler }. The webhook needs the RAW body for
// signature verification and is mounted separately in server.js BEFORE the
// global express.json(); the authed router (checkout/portal/me) is mounted
// after session middleware.

const express = require('express');
const db = require('../database');
const stripe = require('../services/stripe');
const { getPlan, planForPriceId, publicPlans } = require('../services/plans');
const ent = require('../services/entitlements');

const router = express.Router();
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// ─── Subscription upsert helper ────────────────────────────────────────────
const upsertSub = db.prepare(`
  INSERT INTO subscriptions
    (user_id, plan, status, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_end, cancel_at_period_end, updated_at)
  VALUES (@user_id, @plan, @status, @stripe_customer_id, @stripe_subscription_id, @stripe_price_id, @current_period_end, @cancel_at_period_end, datetime('now'))
  ON CONFLICT(user_id) DO UPDATE SET
    plan = excluded.plan,
    status = excluded.status,
    stripe_customer_id = COALESCE(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
    stripe_subscription_id = excluded.stripe_subscription_id,
    stripe_price_id = excluded.stripe_price_id,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    updated_at = datetime('now')
`);

function syncFromSubscription(userId, sub) {
  const priceId = sub.items?.data?.[0]?.price?.id || null;
  upsertSub.run({
    user_id: userId,
    plan: planForPriceId(priceId),
    status: sub.status,
    stripe_customer_id: sub.customer,
    stripe_subscription_id: sub.id,
    stripe_price_id: priceId,
    current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end ? 1 : 0,
  });
}

// ─── GET /api/billing/me ───────────────────────────────────────────────────
router.get('/me', (req, res) => {
  res.json({ ...ent.getEntitlements(req.session.userId), plans: publicPlans() });
});

// ─── POST /api/billing/checkout { plan } ───────────────────────────────────
router.post('/checkout', async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Zahlungen sind nicht konfiguriert.' });
  const planId = req.body.plan;
  const plan = getPlan(planId);
  if (!plan.stripePriceId || plan.id === 'free') return res.status(400).json({ error: 'Ungültiger Tarif.' });

  const userId = req.session.userId;
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);

  // Ensure a Stripe customer exists for this user.
  let sub = ent.getSubscription(userId);
  let customerId = sub?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user?.email, metadata: { userId } });
    customerId = customer.id;
    upsertSub.run({
      user_id: userId, plan: sub?.plan || 'free', status: sub?.status || 'active',
      stripe_customer_id: customerId, stripe_subscription_id: sub?.stripe_subscription_id || null,
      stripe_price_id: sub?.stripe_price_id || null, current_period_end: sub?.current_period_end || null,
      cancel_at_period_end: sub?.cancel_at_period_end || 0,
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    client_reference_id: userId,
    subscription_data: { metadata: { userId } },
    success_url: `${BASE_URL}/app#settings?billing=success`,
    cancel_url: `${BASE_URL}/app#settings?billing=cancel`,
    allow_promotion_codes: true,
  });
  res.json({ url: session.url });
});

// ─── POST /api/billing/portal ──────────────────────────────────────────────
router.post('/portal', async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Zahlungen sind nicht konfiguriert.' });
  const sub = ent.getSubscription(req.session.userId);
  if (!sub?.stripe_customer_id) return res.status(400).json({ error: 'Kein Abo vorhanden.' });
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${BASE_URL}/app#settings`,
  });
  res.json({ url: session.url });
});

// ─── Webhook handler (raw body, no auth) ───────────────────────────────────
const markEvent = db.prepare("INSERT OR IGNORE INTO settings (key, value, user_id) VALUES (?, '1', '')");

function userIdForCustomer(customerId) {
  const row = db.prepare('SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?').get(customerId);
  return row?.user_id || null;
}

function webhookHandler(req, res) {
  if (!stripe) return res.status(400).end();
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe] webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    db.transaction(() => {
      // Idempotency: skip if this event id was already processed.
      const ins = markEvent.run(`webhook:${event.id}`);
      if (ins.changes === 0) return;

      const obj = event.data.object;
      switch (event.type) {
        case 'checkout.session.completed': {
          // Only bind customer/subscription ids — the subscription.* events
          // (which may arrive before or after) own plan/status/price so we must
          // NOT overwrite them with placeholders here.
          const userId = obj.client_reference_id || obj.metadata?.userId;
          if (userId) {
            db.prepare('INSERT OR IGNORE INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id) VALUES (?, ?, ?)')
              .run(userId, obj.customer, obj.subscription || null);
            db.prepare("UPDATE subscriptions SET stripe_customer_id = ?, stripe_subscription_id = COALESCE(?, stripe_subscription_id), updated_at = datetime('now') WHERE user_id = ?")
              .run(obj.customer, obj.subscription || null, userId);
          }
          break;
        }
        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          const userId = obj.metadata?.userId || userIdForCustomer(obj.customer);
          if (userId) syncFromSubscription(userId, obj);
          break;
        }
        case 'customer.subscription.deleted': {
          const userId = obj.metadata?.userId || userIdForCustomer(obj.customer);
          if (userId) {
            db.prepare("UPDATE subscriptions SET plan='free', status='canceled', stripe_subscription_id=NULL, stripe_price_id=NULL, updated_at=datetime('now') WHERE user_id = ?").run(userId);
          }
          break;
        }
        case 'invoice.payment_failed': {
          const userId = userIdForCustomer(obj.customer);
          if (userId) db.prepare("UPDATE subscriptions SET status='past_due', updated_at=datetime('now') WHERE user_id = ?").run(userId);
          break;
        }
        case 'invoice.paid': {
          const userId = userIdForCustomer(obj.customer);
          if (userId) db.prepare("UPDATE subscriptions SET status='active', updated_at=datetime('now') WHERE user_id = ?").run(userId);
          break;
        }
      }
    })();
  } catch (err) {
    console.error('[stripe] webhook handler error:', err.message);
    // Return 200 anyway so Stripe doesn't hammer retries for a non-signature error;
    // the idempotency marker is rolled back with the transaction so a manual
    // resend can reprocess.
  }

  res.json({ received: true });
}

module.exports = { router, webhookHandler };
