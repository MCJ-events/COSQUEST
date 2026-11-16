// Paying on the CosQuest website (payment brief, decision 2: no payment
// screens in the app). See src/utils/checkoutPass.js for the pass's safety.
//
//   POST /api/payments/handoff          (app, logged in) { questId, ticketTypeId? }
//                                       -> { url, expiresAt }: the 20-minute link to open in the browser
//   POST /api/payments/handoff/redeem   (website) { h }  -> the checkout pass + what's being bought (once per link)
//   POST /api/payments/checkout         (website, Bearer <checkout pass>) { ticketTypeId?, position? }
//                                       -> { order, checkoutUrl }: Stripe's page, returning to /checkout/return
//   GET  /api/payments/orders/:orderId  (website, Bearer <checkout pass>) the order (the return page)
//   GET  /api/payments/eligibility?questId=  (app, logged in) can I pay for this?
//
// Paid is still decided ONLY by Stripe's signed webhook (or the reconciler
// asking Stripe): the same tickets.startCheckout / fulfil as the app's checkout.
const mongoose = require('mongoose');
const Quest = require('../models/Quest');
const Order = require('../models/Order');
const Ticket = require('../models/Ticket');
const User = require('../models/User');
const tickets = require('../utils/tickets');
const payments = require('../utils/stripe');
const pass = require('../utils/checkoutPass');
const { checkEligibility } = require('../utils/eligibility');
const { serializeQuest } = require('../utils/quest');

function answer(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.extra || {}) });
  throw error;
}

const notEligible = (result) => ({ status: 403, json: { error: result.message, code: result.code, reason: result.reason } });

async function publishedQuest(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  return Quest.findOne({ _id: id, isPublished: true });
}

// ---------- the app ----------

async function handoff(req, res) {
  const quest = await publishedQuest(req.body.questId);
  if (!quest) return res.status(404).json({ error: 'Quest not found.' });
  const result = await checkEligibility(req.user, { quest, ip: req.ip });
  if (!result.allowed) {
    const n = notEligible(result);
    return res.status(n.status).json(n.json);
  }
  const ticketTypeId = req.body.ticketTypeId || null;
  const { token, expiresAt } = pass.signPass(req.user, { questId: quest._id, ticketTypeId, kind: 'link' });
  return res.status(201).json({ url: `${payments.appWebUrl()}/checkout?h=${encodeURIComponent(token)}`, expiresAt });
}

async function eligibility(req, res) {
  const quest = await publishedQuest(req.query.questId);
  if (!quest) return res.status(404).json({ error: 'Quest not found.' });
  const result = await checkEligibility(req.user, { quest, ip: req.ip });
  return res.json({ allowed: result.allowed, ...(result.allowed ? {} : { reason: result.reason, code: result.code, message: result.message }), mode: result.mode });
}

// ---------- the website ----------

/** Loads the member from a pass (logged out since, deleted or suspended: no). */
async function memberFor(claims) {
  const user = await User.findById(claims.sub);
  if (!user || (user.tokenVersion || 0) !== claims.tv) return null;
  if (require('../utils/communityRestrictions').suspendedAnswer(user)) return null;
  return user;
}

async function redeem(req, res) {
  const claims = pass.verifyPass(req.body.h, 'link');
  if (!claims) return res.status(401).json({ error: 'This checkout link has expired. Go back to CosQuest and tap Pay again.', code: 'link_expired' });
  if (!(await pass.claimOnce(claims))) return res.status(409).json({ error: 'This checkout link was already used. Go back to CosQuest and tap Pay again.', code: 'link_used' });
  const user = await memberFor(claims);
  if (!user) return res.status(401).json({ error: 'Please sign in to CosQuest again, then tap Pay.', code: 'signed_out' });
  const quest = await publishedQuest(claims.quest);
  if (!quest) return res.status(404).json({ error: 'Quest not found.' });

  const result = await checkEligibility(user, { quest, ip: req.ip });
  const session = pass.signPass(user, { questId: quest._id, ticketTypeId: claims.tt || null, kind: 'session', exp: claims.exp });
  const types = await tickets.ticketTypesFor(quest);
  const p = user.profile || {};
  return res.json({
    checkoutToken: session.token,
    expiresAt: session.expiresAt,
    member: { name: p.displayName || [p.firstName, p.lastName].filter(Boolean).join(' ') || p.username || 'You', username: p.username || null },
    quest: serializeQuest(quest),
    ticketTypes: types.map((tt) => tickets.ticketTypeJson(tt)),
    selectedTicketTypeId: claims.tt || null,
    eligibility: { allowed: result.allowed, ...(result.allowed ? {} : { reason: result.reason, code: result.code, message: result.message }), mode: result.mode },
  });
}

/** Bearer <checkout pass> (kind 'session'): req.user, req.checkout. */
async function requireCheckoutPass(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  const claims = scheme === 'Bearer' ? pass.verifyPass(token, 'session') : null;
  if (!claims) return res.status(401).json({ error: 'This checkout has expired. Go back to CosQuest and tap Pay again.', code: 'checkout_expired' });
  const user = await memberFor(claims);
  if (!user) return res.status(401).json({ error: 'Please sign in to CosQuest again, then tap Pay.', code: 'signed_out' });
  req.user = user;
  req.userId = user.id;
  req.checkout = claims;
  return next();
}

async function checkout(req, res) {
  try {
    const quest = await publishedQuest(req.checkout.quest);
    if (!quest) return res.status(404).json({ error: 'Quest not found.' });
    const p = req.body?.position;
    const position = p && typeof p === 'object' ? { lat: p.lat, lng: p.lng, accuracy: p.accuracy } : null;
    // Eligibility is checked in startCheckout, against the ticket type chosen.
    const started = await tickets.startCheckout({
      user: req.user,
      questId: quest._id,
      ticketTypeId: req.body?.ticketTypeId || req.checkout.tt || undefined,
      position,
      returnTo: 'web',
      ip: req.ip,
    });
    return res.status(started.ticket ? 201 : started.reused ? 200 : 201).json({
      order: tickets.orderJson(started.order, started.ticket),
      checkoutUrl: started.order.status === 'pending' ? started.order.stripe.checkoutUrl : null,
      ticket: started.ticket ? { id: String(started.ticket._id) } : null,
      reused: Boolean(started.reused),
    });
  } catch (error) {
    return answer(res, error);
  }
}

async function order(req, res) {
  if (!mongoose.isValidObjectId(req.params.orderId)) return res.status(404).json({ error: 'Order not found.' });
  // Only this member's order for this checkout's quest.
  let found = await Order.findOne({ _id: req.params.orderId, user: req.user._id, quest: req.checkout.quest });
  if (!found) return res.status(404).json({ error: 'Order not found.' });
  // Stripe's webhook not here yet: ask Stripe (the same as the app's return page).
  if (found.status === 'pending') found = await tickets.reconcileOrder(found);
  const ticket = await Ticket.findOne({ order: found._id });
  return res.json({ order: tickets.orderJson(found, ticket) });
}

module.exports = { handoff, eligibility, redeem, requireCheckoutPass, checkout, order };
