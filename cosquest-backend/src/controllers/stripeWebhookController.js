// POST /api/stripe/webhook - Stripe tells us what happened to a payment.
// Mounted in server.js BEFORE express.json(): the signature is over the raw
// bytes Stripe sent (see Emmanuel's note in the handoff).
//
//   1. The signature is checked (STRIPE_WEBHOOK_SECRET); anything else -> 400.
//   2. Each event id is handled once (StripeEvent); a repeat -> 200, skipped
//      (409, so Stripe retries, while the first delivery is still running).
//   3. If handling fails, the event record is removed and we answer 500, so
//      Stripe retries (for up to 3 days). Every step below is safe to repeat.
const StripeEvent = require('../models/StripeEvent');
const Order = require('../models/Order');
const payments = require('../utils/stripe');
const tickets = require('../utils/tickets');

async function orderForSession(session) {
  const id = session.client_reference_id || session.metadata?.orderId;
  return (id && (await Order.findById(id).catch(() => null))) || Order.findOne({ 'stripe.checkoutSessionId': session.id });
}

async function handle(event) {
  const object = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (object.payment_status !== 'paid' && object.payment_status !== 'no_payment_required') return null; // a delayed method: wait for async_payment_succeeded
      const order = await orderForSession(object);
      if (!order) return null;
      await tickets.fulfil(order, { paymentIntentId: object.payment_intent, amountTotal: object.amount_total, currency: object.currency, via: event.type });
      return order._id;
    }
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed': {
      const order = await orderForSession(object);
      if (order) await tickets.releaseHold(order, 'expired', event.type);
      return order?._id || null;
    }
    // Paid in the app's payment sheet (also arrives for Stripe's page; fulfil runs once).
    case 'payment_intent.succeeded': {
      const order = (object.metadata?.orderId && (await Order.findById(object.metadata.orderId).catch(() => null))) || (await Order.findOne({ 'stripe.paymentIntentId': object.id }));
      if (!order) return null;
      await tickets.fulfil(order, { paymentIntentId: object.id, amountTotal: object.amount_received || object.amount, currency: object.currency, via: event.type });
      return order._id;
    }
    case 'payment_intent.canceled': {
      // Only the payment sheet's own PaymentIntent: Stripe's page puts the
      // order id on its payments too, and its own events close it.
      const order = await Order.findOne({ 'stripe.paymentIntentId': object.id, method: 'sheet', status: 'pending' });
      if (order) await tickets.releaseHold(order, 'expired', event.type);
      return order?._id || null;
    }
    case 'payment_intent.payment_failed': {
      // The person can try another card (Stripe's page or the payment sheet) until it expires.
      const orderId = object.metadata?.orderId;
      if (orderId) await Order.updateOne({ _id: orderId }, { $push: { history: { at: new Date(), event: 'card_declined', detail: object.last_payment_error?.message?.slice(0, 200) || '' } } });
      return orderId || null;
    }
    case 'charge.refunded': {
      // Stripe sends this for partial refunds too: only a full refund gives
      // the ticket back (a partial one, made in the dashboard, keeps it).
      if (!object.refunded) {
        const partial = object.payment_intent
          ? await Order.findOneAndUpdate({ 'stripe.paymentIntentId': object.payment_intent }, { $push: { history: { at: new Date(), event: 'partial_refund', detail: `${object.amount_refunded} of ${object.amount}` } } })
          : null;
        return partial?._id || null;
      }
      const order = object.payment_intent ? await tickets.markRefundedFromStripe(object.payment_intent) : null;
      return order?._id || null;
    }
    default:
      return null;
  }
}

async function receive(req, res) {
  let event;
  try {
    event = payments.constructEvent(req.body, req.headers['stripe-signature']);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid signature.' });
  }
  try {
    await StripeEvent.create({ _id: event.id, type: event.type, done: false });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const seen = await StripeEvent.findById(event.id).lean();
    if (!seen || seen.done !== false) return res.json({ received: true, duplicate: true });
    // Another delivery of this event is still being handled. A 200 here would
    // tell Stripe it's done, and if that one then failed it would never come
    // back, so ask Stripe to retry. A claim left by a crash is taken over
    // after 5 minutes.
    const takenOver = await StripeEvent.findOneAndUpdate({ _id: event.id, done: false, createdAt: { $lte: new Date(Date.now() - 5 * 60 * 1000) } }, { $set: { createdAt: new Date() } });
    if (!takenOver) return res.status(409).json({ error: 'Already being handled. Will retry.' });
  }
  try {
    const orderId = await handle(event);
    await StripeEvent.updateOne({ _id: event.id }, { $set: { done: true, ...(orderId ? { order: orderId } : {}) } });
    return res.json({ received: true });
  } catch (error) {
    console.error(`[stripe] ${event.type} ${event.id} failed:`, error.message);
    await StripeEvent.deleteOne({ _id: event.id }).catch(() => {});
    return res.status(500).json({ error: 'Will retry.' });
  }
}

module.exports = { receive, handle };
