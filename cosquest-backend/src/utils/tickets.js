// Tickets and payments: the rules in one place.
//
// SAFETY
//  - Prices come from TicketType (our database), never from the app.
//  - Only a SIGNED Stripe webhook (or the reconciler asking Stripe directly)
//    marks an order paid; the amount and currency are checked against the
//    order. The app's "success" page proves nothing.
//  - Seats are held atomically (sold + held < quantity), so the last seat
//    can't be sold twice; a hold lasts 31 minutes (Stripe's minimum session
//    is 30), then the seat goes back on sale.
//  - Every transition is a conditional update (findOneAndUpdate with the
//    expected status), so a repeated webhook, a retry or the reconciler
//    running at the same time can never do the same thing twice.
//  - Stripe calls use idempotency keys (checkout-<order>, refund-<order>).
//
// WHEN THINGS GO WRONG
//  - Network drop after "Get ticket": a retry returns the SAME pending order
//    and Stripe page / payment sheet (one open order per person per quest).
//  - Two ways to pay: Stripe's page (website, method 'checkout') or the
//    payment sheet inside the app (method 'sheet', a PaymentIntent). Both
//    are only marked paid by Stripe's signed webhook or by asking Stripe.
//  - Stripe unreachable when starting: the hold is released, nothing charged.
//  - Paid but the webhook is late/lost: the app's return page asks
//    (syncOrder), and the reconciler (every 2 minutes) asks Stripe about
//    pending orders. Stripe also retries webhooks for 3 days.
//  - Paid after the hold expired: the seat is taken again if one is free,
//    otherwise (sold out, cancelled, ended) the money is refunded at once.
const crypto = require('crypto');
const Quest = require('../models/Quest');
const QuestRegistration = require('../models/QuestRegistration');
const TicketType = require('../models/TicketType');
const Order = require('../models/Order');
const Ticket = require('../models/Ticket');
const Counter = require('../models/Counter');
const notificationModel = require('../models/notificationModel');
const { effectiveStatus } = require('./questStatus');
const { distanceMiles } = require('./quest');
const payments = require('./stripe');
const { checkEligibility } = require('./eligibility');

const HOLD_MS = 31 * 60 * 1000;
const MAX_CHECKOUTS_PER_10_MIN = 8;
// CosQuest tickets are all paid. ALLOW_FREE_TICKETS=1 turns free ones back on.
const freeAllowed = () => process.env.ALLOW_FREE_TICKETS === '1';

const orderLabel = (order) => `ORD-${order.number}`;
const step = (event, detail = '') => ({ at: new Date(), event, detail: String(detail).slice(0, 300) });

function fail(status, message, code, extra) {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}), ...(extra ? { extra } : {}) });
}

function tell(userId, message, data = {}) {
  notificationModel.createForUser(userId, message, { type: 'system', ...data }).catch(() => {});
}

// A phone notification that opens the ticket (data.type 'ticket'). `tell`
// above is in-app only (system notices send no push of their own).
// category: the person's switch for it (push.CATEGORIES).
function pushTicket(userId, ticketId, title, body, category) {
  require('./push').sendToUsers([String(userId)], { title, body, data: { type: 'ticket', ticketId: String(ticketId) }, channel: 'default', category, skipOnline: false }).catch(() => {});
}

const when = (date) => new Date(date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: process.env.REMINDER_TIME_ZONE || 'America/Los_Angeles' });

// ---------- ticket types ----------

/** The quest's default ticket type (from its entry fee and places), made once. */
async function ensureDefaultTicketType(quest) {
  const existing = await TicketType.countDocuments({ quest: quest._id });
  if (existing) return null;
  try {
    return await TicketType.create({
      quest: quest._id,
      name: quest.entryFee?.amount > 0 ? 'General admission' : 'Free entry',
      price: { amount: quest.entryFee?.amount || 0, currency: quest.entryFee?.currency || 'USD' },
      quantity: quest.maxParticipants,
      // People who registered before tickets existed keep their places.
      sold: Math.min(quest.registrationCount || 0, quest.maxParticipants),
      isDefault: true,
    });
  } catch (error) {
    if (error?.code === 11000) return TicketType.findOne({ quest: quest._id, isDefault: true });
    throw error;
  }
}

async function ticketTypesFor(quest, { activeOnly = true } = {}) {
  await ensureDefaultTicketType(quest);
  return TicketType.find({ quest: quest._id, ...(activeOnly ? { active: true } : {}) }).sort({ sortOrder: 1, createdAt: 1 });
}

function ticketTypeJson(tt, now = new Date()) {
  const remaining = Math.max(0, tt.quantity - tt.sold - tt.held);
  const notYet = tt.salesStartAt && tt.salesStartAt > now;
  const over = tt.salesEndAt && tt.salesEndAt <= now;
  return {
    id: String(tt._id),
    name: tt.name,
    description: tt.description,
    price: { amount: tt.price.amount, currency: tt.price.currency },
    free: !tt.price.amount,
    quantity: tt.quantity,
    remaining,
    soldOut: remaining === 0,
    onSale: tt.active && !notYet && !over && remaining > 0 && (tt.price.amount > 0 || freeAllowed()),
    salesStartAt: tt.salesStartAt,
    salesEndAt: tt.salesEndAt,
  };
}

// ---------- holds ----------

async function reserveSeat(ticketTypeId, now = new Date()) {
  return TicketType.findOneAndUpdate(
    {
      _id: ticketTypeId,
      active: true,
      $and: [
        { $or: [{ salesStartAt: null }, { salesStartAt: { $lte: now } }] },
        { $or: [{ salesEndAt: null }, { salesEndAt: { $gt: now } }] },
      ],
      $expr: { $lt: [{ $add: ['$sold', '$held'] }, '$quantity'] },
    },
    { $inc: { held: 1 } },
    { new: true }
  );
}

/** Ends an order's hold (once) and gives the seat back. */
async function releaseHold(order, status, detail) {
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, holding: true, status: 'pending' },
    { $set: { holding: false, status }, $push: { history: step(status, detail) } },
    { new: true }
  );
  if (updated) await TicketType.updateOne({ _id: order.ticketType, held: { $gt: 0 } }, { $inc: { held: -1 } });
  return updated;
}

// ---------- checkout ----------

/**
 * "Be at the venue": while the quest is LIVE, joining needs the phone's
 * position within venueRadiusMeters (plus up to 100 m of GPS accuracy).
 * Tickets for later can be bought anywhere. A phone's GPS can be faked, so
 * the QR check-in at the door is the real proof; this keeps people from
 * joining a live quest from home.
 */
function checkAtVenue(quest, status, position) {
  if (!quest.requireAtVenue || status !== 'live') return;
  const lat = Number(position?.lat);
  const lng = Number(position?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    fail(403, `Be at ${quest.location?.name || 'the venue'} to join: allow location and try again.`, 'location_required');
  }
  const accuracy = Math.min(Math.max(Number(position.accuracy) || 0, 0), 100);
  const distance = distanceMiles(lat, lng, quest.location.lat, quest.location.lng) * 1609.344;
  const allowed = (quest.venueRadiusMeters || 200) + accuracy;
  if (distance > allowed) {
    const away = distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${Math.round(distance)} m`;
    fail(403, `You need to be at ${quest.location?.name || 'the venue'} to join (you're about ${away} away).`, 'not_at_venue', { distanceMeters: Math.round(distance) });
  }
}

// returnTo: where Stripe's page sends the person back: 'app' (the app's
// /tickets/return) or 'web' (the website checkout's /checkout/return).
// ip: the request's address, for the eligibility check (eligibility.js).
async function startCheckout({ user, questId, ticketTypeId, position = null, method = 'checkout', returnTo = 'app', ip = null }) {
  const now = new Date();
  const quest = await Quest.findOne({ _id: questId, isPublished: true });
  if (!quest) fail(404, 'Quest not found.');
  const status = effectiveStatus(quest, now);
  if (status === 'cancelled') fail(409, 'This has been cancelled.');
  if (status === 'completed' || quest.endsAt <= now) fail(409, 'This has already ended.');
  checkAtVenue(quest, status, position);

  const live = await Ticket.findOne({ user: user._id, quest: quest._id, status: { $in: ['valid', 'checked_in'] } });
  if (live) fail(409, 'You already have a ticket for this.', 'has_ticket', { ticketId: String(live._id) });

  // A retry (network drop, double tap) gets the same open checkout back.
  const open = await Order.findOne({ user: user._id, quest: quest._id, status: 'pending' });
  if (open) {
    const sameType = !ticketTypeId || String(open.ticketType) === String(ticketTypeId);
    const fresh = sameType && (open.method || 'checkout') === method && (open.returnTo || 'app') === returnTo && open.holdExpiresAt > new Date(now.getTime() + 60 * 1000);
    if (fresh && method === 'checkout' && open.stripe.checkoutUrl) return { order: open, reused: true };
    if (fresh && method === 'sheet') {
      const clientSecret = await openSheetSecret(open);
      if (clientSecret) return { order: open, reused: true, clientSecret };
    }
    // Otherwise close it (and its Stripe page) before starting again.
    await reconcileOrder(open, { force: true });
    const still = await Order.findById(open._id);
    if (still.status === 'paid') fail(409, 'You already have a ticket for this.', 'has_ticket');
    if (still.status === 'pending') await closePending(still, 'replaced');
  }

  const recent = await Order.countDocuments({ user: user._id, createdAt: { $gte: new Date(now.getTime() - 10 * 60 * 1000) } });
  if (recent >= MAX_CHECKOUTS_PER_10_MIN) fail(429, 'Too many attempts. Please wait a few minutes.', 'too_many_checkouts');

  const types = await ticketTypesFor(quest);
  const type = ticketTypeId ? types.find((tt) => String(tt._id) === String(ticketTypeId)) : types.length === 1 ? types[0] : null;
  if (!type) fail(400, ticketTypeId ? 'That ticket type is not available.' : 'Choose a ticket type.', 'choose_ticket_type');
  // Paid only (unless ALLOW_FREE_TICKETS=1): a quest without a price isn't on sale.
  if (!type.price.amount && !freeAllowed()) fail(409, "Tickets for this aren't on sale yet.", 'not_on_sale');
  // 18+ (and, with live payments, the region) for anything that costs money,
  // here so no way of paying can skip it (the website, the app, older apps).
  if (type.price.amount > 0) {
    const eligible = await checkEligibility(user, { quest, paid: true, ip, position });
    if (!eligible.allowed) fail(403, eligible.message, eligible.code, { reason: eligible.reason });
  }
  if (type.price.amount > 0 && !payments.isConfigured()) fail(503, 'Payments are not set up yet. Please try again later.', 'payments_unavailable');
  if (type.price.amount > 0) payments.toMinor(type.price.amount, type.price.currency); // supported currency?

  const held = await reserveSeat(type._id, now);
  if (!held) fail(409, 'Sold out (or not on sale right now).', 'sold_out');

  let order;
  try {
    order = await Order.create({
      number: await Counter.next('order', 1000),
      user: user._id,
      quest: quest._id,
      ticketType: type._id,
      amount: { amount: type.price.amount, currency: type.price.currency },
      status: 'pending',
      method,
      returnTo,
      holding: true,
      holdExpiresAt: new Date(now.getTime() + HOLD_MS),
      history: [step('created', `${type.name} · ${type.price.amount} ${type.price.currency}`)],
    });
  } catch (error) {
    await TicketType.updateOne({ _id: type._id, held: { $gt: 0 } }, { $inc: { held: -1 } });
    if (error?.code === 11000) {
      // Two taps at once: the other one won; hand that order back.
      const other = await Order.findOne({ user: user._id, quest: quest._id, status: 'pending' });
      if (other && method === 'checkout') return { order: other, reused: true };
      // The payment sheet needs its client secret, which the other tap may
      // still be getting (or the payment is already going through).
      const clientSecret = other && (await openSheetSecret(other));
      if (clientSecret) return { order: other, reused: true, clientSecret };
      if (other) fail(409, 'Your payment is still going through. Please check again in a moment.', 'payment_in_progress');
    }
    throw error;
  }

  // Free: the ticket at once.
  if (!type.price.amount) {
    const done = await fulfil(order, { via: 'free' });
    return { order: done.order, ticket: done.ticket };
  }

  // In the app: a PaymentIntent for Stripe's payment sheet (card, Google Pay).
  if (method === 'sheet') {
    try {
      const pi = await payments.stripe().paymentIntents.create(
        {
          amount: payments.toMinor(type.price.amount, type.price.currency),
          currency: type.price.currency.toLowerCase(),
          automatic_payment_methods: { enabled: true },
          description: `${quest.title} · ${type.name}`.slice(0, 200),
          metadata: { orderId: String(order._id), questId: String(quest._id), userId: String(user._id) },
          ...(user.email ? { receipt_email: user.email } : {}),
        },
        { idempotencyKey: `pi-${order._id}` }
      );
      order = await Order.findByIdAndUpdate(
        order._id,
        { $set: { 'stripe.paymentIntentId': pi.id }, $push: { history: step('payment_sheet_opened', pi.id) } },
        { new: true }
      );
      return { order, clientSecret: pi.client_secret };
    } catch (error) {
      await releaseHold(order, 'failed', `Stripe: ${error.message}`);
      console.error(`[tickets] ${orderLabel(order)}: could not create the payment:`, error.message);
      fail(502, "Couldn't reach the payment service. Nothing was charged. Please try again.", 'payment_service_unreachable');
    }
  }

  try {
    const session = await payments.stripe().checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: type.price.currency.toLowerCase(),
              unit_amount: payments.toMinor(type.price.amount, type.price.currency),
              product_data: { name: `${quest.title} · ${type.name}`.slice(0, 120), description: `${quest.location?.name || ''} · ${quest.startsAt.toUTCString()}`.slice(0, 300) },
            },
          },
        ],
        client_reference_id: String(order._id),
        metadata: { orderId: String(order._id), questId: String(quest._id), userId: String(user._id) },
        payment_intent_data: { metadata: { orderId: String(order._id), questId: String(quest._id), userId: String(user._id) } },
        ...(user.email ? { customer_email: user.email } : {}),
        expires_at: Math.floor(order.holdExpiresAt.getTime() / 1000),
        success_url: `${payments.appWebUrl()}/${returnTo === 'web' ? 'checkout/return' : 'tickets/return'}?order=${order._id}&result=success`,
        cancel_url: `${payments.appWebUrl()}/${returnTo === 'web' ? 'checkout/return' : 'tickets/return'}?order=${order._id}&result=cancelled`,
      },
      { idempotencyKey: `checkout-${order._id}` }
    );
    order = await Order.findByIdAndUpdate(
      order._id,
      { $set: { 'stripe.checkoutSessionId': session.id, 'stripe.checkoutUrl': session.url }, $push: { history: step('checkout_opened', session.id) } },
      { new: true }
    );
    return { order };
  } catch (error) {
    // Nothing was charged: give the seat back.
    await releaseHold(order, 'failed', `Stripe: ${error.message}`);
    console.error(`[tickets] ${orderLabel(order)}: could not open Stripe Checkout:`, error.message);
    fail(502, "Couldn't reach the payment service. Nothing was charged. Please try again.", 'payment_service_unreachable');
  }
}

/** The payment sheet's client secret, while its PaymentIntent can still be paid. */
async function openSheetSecret(order) {
  if ((order.method || 'checkout') !== 'sheet' || !order.stripe.paymentIntentId) return null;
  const pi = await payments.stripe().paymentIntents.retrieve(order.stripe.paymentIntentId).catch(() => null);
  return pi && !['canceled', 'succeeded', 'processing'].includes(pi.status) ? pi.client_secret : null;
}

/** Closes a pending order that will not be paid (expires its Stripe page). */
async function closePending(order, why) {
  if ((order.method || 'checkout') === 'sheet' && order.stripe.paymentIntentId) {
    // Unlike Stripe's page, a PaymentIntent never expires by itself: the seat
    // goes back only once Stripe has cancelled it, or the app could still pay
    // for a seat sold again.
    const id = order.stripe.paymentIntentId;
    const pi = await payments
      .stripe()
      .paymentIntents.cancel(id)
      .catch(() => payments.stripe().paymentIntents.retrieve(id).catch((error) => (error.statusCode === 404 ? { status: 'canceled' } : null)));
    if (pi?.status === 'succeeded') return fulfil(order, { paymentIntentId: pi.id, amountTotal: pi.amount_received || pi.amount, currency: pi.currency, via: 'close_check' });
    // Processing, or Stripe unreachable: the reconciler tries again.
    if (pi?.status !== 'canceled') return order;
    return releaseHold(order, 'expired', why);
  }
  if (order.stripe.checkoutSessionId) {
    try {
      await payments.stripe().checkout.sessions.expire(order.stripe.checkoutSessionId);
    } catch (error) {
      // Already expired or completed: the reconciler / webhook decide.
      const session = await payments.stripe().checkout.sessions.retrieve(order.stripe.checkoutSessionId).catch(() => null);
      if (session?.payment_status === 'paid') return fulfil(order, { paymentIntentId: session.payment_intent, amountTotal: session.amount_total, currency: session.currency, via: 'close_check' });
    }
  }
  return releaseHold(order, 'expired', why);
}

// ---------- fulfilment ----------

/**
 * The order is paid (or free): issue the ticket. Safe to call many times
 * and from several places at once; only the first call does anything.
 */
async function fulfil(order, { paymentIntentId = null, amountTotal = null, currency = null, via = 'webhook' } = {}) {
  const free = !order.amount.amount;
  if (!free) {
    const expected = payments.toMinor(order.amount.amount, order.amount.currency);
    if (amountTotal !== expected || String(currency).toUpperCase() !== order.amount.currency) {
      // Should never happen: refund rather than issue the wrong ticket.
      await Order.updateOne({ _id: order._id }, { $push: { history: step('amount_mismatch', `expected ${expected} ${order.amount.currency}, got ${amountTotal} ${currency}`) } });
      console.error(`[tickets] ${orderLabel(order)}: amount mismatch, refunding`);
      return autoRefund(order._id, paymentIntentId, 'The amount paid did not match the ticket price.');
    }
  }

  // Claim the transition once (pending / expired / failed -> paid).
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, status: { $in: ['pending', 'expired', 'failed'] } },
    {
      $set: { status: free ? 'free' : 'paid', paidAt: new Date(), ...(paymentIntentId ? { 'stripe.paymentIntentId': paymentIntentId } : {}) },
      $push: { history: step(free ? 'free_ticket' : 'paid', via) },
    },
    { new: false }
  );
  if (!claimed) {
    const current = await Order.findById(order._id);
    // An earlier try owed a refund and Stripe didn't take it: try again.
    if (current?.status === 'paid' && current.refundDue) return autoRefund(current._id, paymentIntentId, current.refundDue);
    return { order: current, ticket: await Ticket.findOne({ order: order._id }), already: true };
  }

  const quest = await Quest.findById(claimed.quest);
  const status = quest ? effectiveStatus(quest) : 'cancelled';

  // The seat: still held -> sold; hold already released -> take one if free.
  let seat = false;
  if (claimed.holding) {
    await Order.updateOne({ _id: order._id }, { $set: { holding: false } });
    await TicketType.updateOne({ _id: claimed.ticketType }, { $inc: { held: -1, sold: 1 } });
    seat = true;
  } else {
    seat = Boolean(
      await TicketType.findOneAndUpdate(
        { _id: claimed.ticketType, $expr: { $lt: [{ $add: ['$sold', '$held'] }, '$quantity'] } },
        { $inc: { sold: 1 } }
      )
    );
  }
  if (!seat || status === 'cancelled' || status === 'completed') {
    if (seat) await TicketType.updateOne({ _id: claimed.ticketType, sold: { $gt: 0 } }, { $inc: { sold: -1 } });
    const why = status === 'cancelled' ? 'It was cancelled.' : status === 'completed' ? 'It had already ended.' : 'It sold out before the payment finished.';
    if (free) {
      // Nothing to refund, and no ticket: the free order is not left as "free".
      return { order: await Order.findOneAndUpdate({ _id: order._id }, { $set: { status: 'cancelled' }, $push: { history: step('cancelled', why) } }, { new: true }) };
    }
    return owedRefund(order._id, paymentIntentId, why);
  }

  let ticket;
  try {
    ticket = await Ticket.create({
      code: `CQT-${crypto.randomBytes(16).toString('base64url')}`,
      order: claimed._id,
      user: claimed.user,
      quest: claimed.quest,
      ticketType: claimed.ticketType,
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    // The person already holds a ticket for this quest (another order won).
    await TicketType.updateOne({ _id: claimed.ticketType, sold: { $gt: 0 } }, { $inc: { sold: -1 } });
    const existing = await Ticket.findOne({ order: claimed._id });
    if (existing) return { order: await Order.findById(order._id), ticket: existing, already: true };
    if (free) return { order: await Order.findOneAndUpdate({ _id: order._id }, { $set: { status: 'cancelled' }, $push: { history: step('cancelled', 'already had a ticket') } }, { new: true }) };
    return owedRefund(order._id, paymentIntentId, 'You already had a ticket.');
  }

  // Registration (the home page's "Registered") and the quest's count.
  const before = await QuestRegistration.findOneAndUpdate(
    { quest: claimed.quest, user: claimed.user },
    { $set: { status: 'registered', paymentStatus: free ? 'not_required' : 'paid' } },
    { upsert: true, new: false }
  );
  if (!before || before.status !== 'registered') await Quest.updateOne({ _id: claimed.quest }, { $inc: { registrationCount: 1 } });

  tell(claimed.user, `Your ticket for ${quest.title} is ready. See it in My tickets.`);
  pushTicket(claimed.user, ticket._id, 'Your ticket is ready 🎟️', `${quest.title} · ${when(quest.startsAt)}`, 'questUpdates');
  // The app updates by itself (e.g. paid on the website): live, while it's open.
  try {
    require('../realtime/socket').emitToUser(String(claimed.user), 'ticket:issued', { orderId: String(claimed._id), ticketId: String(ticket._id), questId: String(claimed.quest) });
  } catch (error) {
    console.warn(`[tickets] ${orderLabel(claimed)}: live update failed:`, error.message);
  }
  return { order: await Order.findById(order._id), ticket };
}

// ---------- refunds ----------

/** A paid order that gets no ticket: note the refund as owed, then make it. */
async function owedRefund(orderId, paymentIntentId, why) {
  await Order.updateOne({ _id: orderId, status: 'paid' }, { $set: { refundDue: why } });
  return autoRefund(orderId, paymentIntentId, why);
}

/** Money back with no seat to release (the ticket was never issued). */
async function autoRefund(orderId, paymentIntentId, why) {
  const order = await Order.findById(orderId);
  const pi = paymentIntentId || order.stripe.paymentIntentId;
  // A seat still held by this order goes back on sale (once).
  const released = await Order.findOneAndUpdate({ _id: order._id, holding: true }, { $set: { holding: false } });
  if (released) await TicketType.updateOne({ _id: order.ticketType, held: { $gt: 0 } }, { $inc: { held: -1 } });
  const refund = await payments.stripe().refunds.create({ payment_intent: pi, reason: 'requested_by_customer', metadata: { orderId: String(order._id), why: why.slice(0, 200) } }, { idempotencyKey: `refund-${order._id}` });
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: { $ne: 'refunded' } },
    { $set: { status: 'refunded', holding: false, refundDue: null, refundedAt: new Date(), refundReason: why, 'stripe.refundId': refund.id, ...(pi ? { 'stripe.paymentIntentId': pi } : {}) }, $push: { history: step('auto_refund', why) } },
    { new: true }
  );
  const quest = await Quest.findById(order.quest).select('title');
  tell(order.user, `Your payment for ${quest?.title || 'a ticket'} was refunded. ${why}`);
  return { order: updated || (await Order.findById(order._id)), refunded: true };
}

/**
 * Gives a ticket back: a refund for a paid one, a cancel for a free one.
 * The seat goes back on sale and the registration is cancelled.
 */
async function refundOrder(orderId, { reason, by = null }) {
  const order = await Order.findById(orderId);
  if (!order) fail(404, 'Order not found.');
  if (!['paid', 'free'].includes(order.status)) fail(409, order.status === 'refunded' ? 'This was already refunded.' : 'Only paid or free tickets can be given back.');
  const free = order.status === 'free';

  let refundId = null;
  if (!free) {
    try {
      const refund = await payments.stripe().refunds.create(
        { payment_intent: order.stripe.paymentIntentId, reason: 'requested_by_customer', metadata: { orderId: String(order._id) } },
        { idempotencyKey: `refund-${order._id}` }
      );
      refundId = refund.id;
    } catch (error) {
      console.error(`[tickets] ${orderLabel(order)}: refund failed:`, error.message);
      fail(502, "Couldn't reach the payment service. Nothing was changed. Please try again.", 'payment_service_unreachable');
    }
  }

  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: order.status },
    {
      $set: { status: free ? 'cancelled' : 'refunded', refundedAt: new Date(), refundReason: reason || null, refundedBy: by, ...(refundId ? { 'stripe.refundId': refundId } : {}) },
      $push: { history: step(free ? 'cancelled' : 'refunded', reason || '') },
    },
    { new: true }
  );
  if (!updated) return { order: await Order.findById(order._id), already: true };
  await releaseSeat(updated, free ? 'cancelled' : 'refunded');
  return { order: updated };
}

async function releaseSeat(order, ticketStatus) {
  const ticket = await Ticket.findOneAndUpdate({ order: order._id, status: { $in: ['valid', 'checked_in'] } }, { $set: { status: ticketStatus } }, { new: true });
  if (!ticket) return;
  await TicketType.updateOne({ _id: order.ticketType, sold: { $gt: 0 } }, { $inc: { sold: -1 } });
  const reg = await QuestRegistration.findOneAndUpdate({ quest: order.quest, user: order.user, status: 'registered' }, { $set: { status: 'cancelled' } });
  if (reg) await Quest.updateOne({ _id: order.quest, registrationCount: { $gt: 0 } }, { $inc: { registrationCount: -1 } });
}

/** A refund made outside the app (Stripe dashboard): keep ours in step. */
async function markRefundedFromStripe(paymentIntentId) {
  const order = await Order.findOne({ 'stripe.paymentIntentId': paymentIntentId });
  if (!order || order.status !== 'paid') return order;
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: 'paid' },
    { $set: { status: 'refunded', refundedAt: new Date(), refundReason: 'Refunded in Stripe' }, $push: { history: step('refunded', 'charge.refunded') } },
    { new: true }
  );
  if (updated) await releaseSeat(updated, 'refunded');
  return updated;
}

/** Every paid / free ticket of a cancelled quest is given back. */
async function refundAllForQuest(questId, reason, by) {
  const orders = await Order.find({ quest: questId, status: { $in: ['paid', 'free', 'pending'] } });
  let refunded = 0;
  let failed = 0;
  for (const order of orders) {
    try {
      if (order.status === 'pending') await closePending(order, 'quest cancelled');
      else {
        await refundOrder(order._id, { reason, by });
        refunded += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(`[tickets] refund on cancel failed for ${orderLabel(order)}:`, error.message);
    }
  }
  return { refunded, failed };
}

// ---------- reconciling with Stripe ----------

/** Asks Stripe where a pending order stands, and acts on it. */
async function reconcileOrder(order, { force = false } = {}) {
  if (order.status !== 'pending') return order;
  if (!force && order.lastCheckedAt && Date.now() - order.lastCheckedAt.getTime() < 10 * 1000) return order;
  await Order.updateOne({ _id: order._id }, { $set: { lastCheckedAt: new Date() } });
  // Paid in the app: ask Stripe about the PaymentIntent.
  if ((order.method || 'checkout') === 'sheet' && order.stripe.paymentIntentId) {
    let pi;
    try {
      pi = await payments.stripe().paymentIntents.retrieve(order.stripe.paymentIntentId);
    } catch (error) {
      console.warn(`[tickets] ${orderLabel(order)}: could not ask Stripe:`, error.message);
      return order;
    }
    if (pi.status === 'succeeded') {
      await fulfil(order, { paymentIntentId: pi.id, amountTotal: pi.amount_received || pi.amount, currency: pi.currency, via: 'reconciled' });
    } else if (pi.status === 'canceled') {
      await releaseHold(order, 'expired', 'payment canceled');
    } else if (order.holdExpiresAt <= new Date() && pi.status !== 'processing') {
      await closePending(order, 'hold ended');
    }
    return Order.findById(order._id);
  }
  if (!order.stripe.checkoutSessionId) {
    // Never got a Stripe page (crashed between steps): release once the hold ends.
    if (order.holdExpiresAt <= new Date()) await releaseHold(order, 'expired', 'no checkout session');
    return Order.findById(order._id);
  }
  let session;
  try {
    session = await payments.stripe().checkout.sessions.retrieve(order.stripe.checkoutSessionId);
  } catch (error) {
    console.warn(`[tickets] ${orderLabel(order)}: could not ask Stripe:`, error.message);
    return order;
  }
  if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
    await fulfil(order, { paymentIntentId: session.payment_intent, amountTotal: session.amount_total, currency: session.currency, via: 'reconciled' });
  } else if (session.status === 'expired') {
    await releaseHold(order, 'expired', 'checkout expired');
  } else if (order.holdExpiresAt <= new Date()) {
    await closePending(order, 'hold ended');
  }
  return Order.findById(order._id);
}

/** The background check: pending orders past their hold, or quiet for 5 minutes. */
async function reconcileDue() {
  if (!payments.isConfigured()) return;
  const now = Date.now();
  const due = await Order.find({
    status: 'pending',
    $or: [{ holdExpiresAt: { $lte: new Date(now) } }, { createdAt: { $lte: new Date(now - 5 * 60 * 1000) }, $or: [{ lastCheckedAt: null }, { lastCheckedAt: { $lte: new Date(now - 5 * 60 * 1000) } }] }],
  }).limit(50);
  for (const order of due) {
    try {
      await reconcileOrder(order, { force: true });
    } catch (error) {
      console.error(`[tickets] reconcile ${orderLabel(order)} failed:`, error.message);
    }
  }
  // Refunds still owed (Stripe didn't take the first try).
  const owed = await Order.find({ status: 'paid', refundDue: { $ne: null } }).limit(50);
  for (const order of owed) {
    try {
      await autoRefund(order._id, order.stripe.paymentIntentId, order.refundDue);
    } catch (error) {
      console.error(`[tickets] refund still owed for ${orderLabel(order)}:`, error.message);
    }
  }
}

// ---------- reminders ----------

/**
 * "Starts in about an hour": once per valid ticket, for quests starting in
 * 50-70 minutes. reminderSentAt is claimed atomically, so two servers (or
 * two runs) never send it twice.
 */
async function remindersDue(now = new Date()) {
  const soon = await Quest.find({
    isPublished: true,
    status: { $ne: 'cancelled' },
    startsAt: { $gt: new Date(now.getTime() + 50 * 60 * 1000), $lte: new Date(now.getTime() + 70 * 60 * 1000) },
  }).select('title startsAt location');
  let sent = 0;
  for (const quest of soon) {
    const due = await Ticket.find({ quest: quest._id, status: 'valid', reminderSentAt: null }).select('_id user').limit(1000);
    for (const t of due) {
      const claimed = await Ticket.findOneAndUpdate({ _id: t._id, reminderSentAt: null }, { $set: { reminderSentAt: new Date() } });
      if (!claimed) continue;
      tell(t.user, `${quest.title} starts in about an hour. Have your ticket ready.`);
      pushTicket(t.user, t._id, 'Starts in about an hour', `${quest.title}${quest.location?.name ? ` · ${quest.location.name}` : ''}. Tap to show your ticket.`, 'eventReminders');
      sent += 1;
    }
  }
  return sent;
}

let timer = null;
function start() {
  if (timer || process.env.TICKETS_WORKER === '0' || process.env.NODE_ENV === 'test') return;
  let busy = false;
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await reconcileDue();
      await remindersDue().catch((error) => console.error('[tickets] reminders failed:', error.message));
    } finally {
      busy = false;
    }
  }, 2 * 60 * 1000);
  timer.unref();
}
function stop() {
  clearInterval(timer);
  timer = null;
}

// ---------- JSON ----------

function orderJson(order, ticket = null) {
  return {
    id: String(order._id),
    number: orderLabel(order),
    questId: String(order.quest?._id || order.quest),
    status: order.status,
    amount: order.amount,
    checkoutUrl: order.status === 'pending' ? order.stripe?.checkoutUrl || null : null,
    holdExpiresAt: order.status === 'pending' ? order.holdExpiresAt : null,
    paidAt: order.paidAt,
    refundedAt: order.refundedAt,
    refundReason: order.refundReason,
    ticket: ticket ? { id: String(ticket._id), status: ticket.status } : null,
    createdAt: order.createdAt,
  };
}

module.exports = {
  HOLD_MS,
  freeAllowed,
  ensureDefaultTicketType,
  ticketTypesFor,
  ticketTypeJson,
  startCheckout,
  fulfil,
  refundOrder,
  autoRefund,
  refundAllForQuest,
  markRefundedFromStripe,
  reconcileOrder,
  reconcileDue,
  remindersDue,
  releaseHold,
  orderJson,
  orderLabel,
  start,
  stop,
};
