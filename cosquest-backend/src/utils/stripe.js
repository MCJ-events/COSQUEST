// The one place the backend talks to Stripe.
//
//   STRIPE_SECRET_KEY      sk_test_... (sandbox) or sk_live_...  - Render only
//   STRIPE_WEBHOOK_SECRET  whsec_...  - Render only
//   APP_WEB_URL            where Stripe sends people back (https://cosquest.vercel.app)
//
// Card details never reach this server: people pay on Stripe's own page
// (Checkout). Calls retry on network errors (maxNetworkRetries) and carry
// idempotency keys, so a retry never charges or refunds twice.
//
// Tests (NODE_ENV=test without STRIPE_SECRET_KEY) get an in-memory fake with
// the same calls, and webhooks are signed with the real library and
// STRIPE_WEBHOOK_SECRET (default whsec_test), so the signature check is real.
const crypto = require('crypto');

// Currencies with 2 decimals (amount * 100 in Stripe). Others are refused.
const SUPPORTED = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'];

let client = null;
let fake = null;

const useFake = () => process.env.NODE_ENV === 'test' && !process.env.STRIPE_SECRET_KEY;

function isConfigured() {
  return useFake() || Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}

function notConfigured() {
  return Object.assign(new Error('Payments are not set up yet. Please try again later.'), { status: 503, code: 'payments_unavailable' });
}

function stripe() {
  if (useFake()) return (fake ||= createFake());
  if (!process.env.STRIPE_SECRET_KEY) throw notConfigured();
  if (!client) {
    const Stripe = require('stripe');
    client = new Stripe(process.env.STRIPE_SECRET_KEY, {
      maxNetworkRetries: 2,
      timeout: 20000,
      appInfo: { name: 'CosQuest tickets' },
    });
  }
  return client;
}

function webhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || (process.env.NODE_ENV === 'test' ? 'whsec_test' : '');
  if (!secret) throw notConfigured();
  return secret;
}

/** Verifies Stripe's signature on the RAW body. Throws when it doesn't match. */
function constructEvent(rawBody, signature) {
  const Stripe = require('stripe');
  const verifier = client || new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_signature_only');
  return verifier.webhooks.constructEvent(rawBody, signature, webhookSecret(), 300);
}

/** Whole units -> Stripe's minor units (cents). */
function toMinor(amount, currency) {
  if (!SUPPORTED.includes(String(currency).toUpperCase())) {
    throw Object.assign(new Error(`${currency} isn't supported for card payments.`), { status: 400 });
  }
  return Math.round(Number(amount) * 100);
}

function appWebUrl() {
  return (process.env.APP_WEB_URL || 'https://cosquest.vercel.app').replace(/\/+$/, '');
}

// ---------- the test fake ----------
function createFake() {
  const sessions = new Map();
  const keys = new Map();
  const refunds = [];
  const id = (prefix) => `${prefix}_test_${crypto.randomBytes(8).toString('hex')}`;
  const once = (opts, make) => {
    const key = opts?.idempotencyKey;
    if (key && keys.has(key)) return keys.get(key);
    const value = make();
    if (key) keys.set(key, value);
    return value;
  };
  return {
    _sessions: sessions,
    _refunds: refunds,
    /** Test helper: the person paid on Stripe's page. */
    _pay(sessionId) {
      const s = sessions.get(sessionId);
      Object.assign(s, { status: 'complete', payment_status: 'paid', payment_intent: s.payment_intent || id('pi') });
      return s;
    },
    _failNext: false,
    checkout: {
      sessions: {
        create: async (params, opts) => {
          if (fake._failNext) {
            fake._failNext = false;
            throw Object.assign(new Error('Network error (fake)'), { type: 'StripeConnectionError' });
          }
          return once(opts, () => {
            const line = params.line_items[0];
            const s = {
              id: id('cs'),
              object: 'checkout.session',
              url: `https://checkout.stripe.test/pay/${crypto.randomBytes(6).toString('hex')}`,
              status: 'open',
              payment_status: 'unpaid',
              amount_total: line.price_data.unit_amount * line.quantity,
              currency: line.price_data.currency,
              metadata: params.metadata,
              client_reference_id: params.client_reference_id,
              expires_at: params.expires_at,
              payment_intent: null,
            };
            sessions.set(s.id, s);
            return s;
          });
        },
        retrieve: async (sessionId) => {
          const s = sessions.get(sessionId);
          if (!s) throw Object.assign(new Error('No such session'), { statusCode: 404 });
          return s;
        },
        expire: async (sessionId) => {
          const s = sessions.get(sessionId);
          if (s.status === 'open') s.status = 'expired';
          return s;
        },
      },
    },
    refunds: {
      create: async (params, opts) =>
        once(opts, () => {
          const r = { id: id('re'), object: 'refund', status: 'succeeded', payment_intent: params.payment_intent, amount: params.amount };
          refunds.push(r);
          return r;
        }),
    },
  };
}

module.exports = { stripe, isConfigured, constructEvent, toMinor, appWebUrl, SUPPORTED, _fake: () => (useFake() ? (fake ||= createFake()) : null) };
