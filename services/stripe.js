'use strict';

// Stripe client singleton. Returns null if no key is configured, so the app
// still boots in environments without Stripe (billing endpoints then 400).

const Stripe = require('stripe');

const key = process.env.STRIPE_SECRET_KEY;
const stripe = key ? new Stripe(key) : null;

module.exports = stripe;
