'use strict';

// Stripe client factory. The secret key is read from the Admin-managed settings
// (services/appSettings, with .env as a migration fallback). Returns null when
// no key is configured, so the app still boots without Stripe (billing
// endpoints then return 400). The client is cached and rebuilt when the key
// changes, so updating the key in the Admin panel takes effect without a restart.

const Stripe = require('stripe');
const { getStripeSettings } = require('./appSettings');

let _client = null;
let _key = null;

function getStripe() {
  const { secretKey } = getStripeSettings();
  if (!secretKey) { _client = null; _key = null; return null; }
  if (_client && _key === secretKey) return _client;
  _client = new Stripe(secretKey);
  _key = secretKey;
  return _client;
}

module.exports = { getStripe };
