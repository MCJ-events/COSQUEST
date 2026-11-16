// Members: ticket types, checkout, the order's state, My tickets.
//
//   GET  /api/quests/:questId/ticket-types       (public)  what's on sale, seats left
//   POST /api/quests/:questId/checkout           { ticketTypeId?, position?: { lat, lng, accuracy } } -> free: the ticket; paid: { order, checkoutUrl }
//                                                (position: needed to join a LIVE quest that requires being at the venue)
//   POST /api/quests/:questId/payment-sheet      same, for the app: { order, paymentIntentClientSecret } (Stripe's payment sheet: card, Google Pay)
//   GET  /api/orders/:orderId                    the order's state; asks Stripe if still pending (the app's return page)
//   GET  /api/me/tickets?scope=upcoming|past
//   GET  /api/me/tickets/:ticketId               with the QR code value
//   POST /api/me/tickets/:ticketId/cancel        give it back: refund (paid) or cancel (free), until the cutoff
const mongoose = require('mongoose');
const Quest = require('../models/Quest');
const Order = require('../models/Order');
const Ticket = require('../models/Ticket');
const TicketType = require('../models/TicketType');
const tickets = require('../utils/tickets');
const { serializeQuest } = require('../utils/quest');

// Members can give a ticket back until this many hours before it starts.
const CUTOFF_HOURS = () => Number(process.env.REFUND_CUTOFF_HOURS ?? 24);

function answer(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.extra || {}) });
  throw error;
}

async function listTicketTypes(req, res) {
  if (!mongoose.isValidObjectId(req.params.questId)) return res.status(404).json({ error: 'Quest not found.' });
  const quest = await Quest.findOne({ _id: req.params.questId, isPublished: true });
  if (!quest) return res.status(404).json({ error: 'Quest not found.' });
  const types = await tickets.ticketTypesFor(quest);
  return res.json({ ticketTypes: types.map((tt) => tickets.ticketTypeJson(tt)) });
}

async function checkout(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.questId)) return res.status(404).json({ error: 'Quest not found.' });
    // The phone's position, for quests that need you at the venue (live ones).
    const p = req.body?.position;
    const position = p && typeof p === 'object' ? { lat: p.lat, lng: p.lng, accuracy: p.accuracy } : null;
    const result = await tickets.startCheckout({ user: req.user, questId: req.params.questId, ticketTypeId: req.body?.ticketTypeId, position, ip: req.ip });
    const status = result.ticket ? 201 : result.reused ? 200 : 201;
    return res.status(status).json({
      order: tickets.orderJson(result.order, result.ticket),
      checkoutUrl: result.order.status === 'pending' ? result.order.stripe.checkoutUrl : null,
      ticket: result.ticket ? { id: String(result.ticket._id) } : null,
      reused: Boolean(result.reused),
    });
  } catch (error) {
    return answer(res, error);
  }
}

// The app: Stripe's payment sheet (card, Google Pay) instead of Stripe's page.
async function paymentSheet(req, res) {
  // Payment brief, decision 2: payments happen on the CosQuest website, never
  // in the app. PAYMENT_SHEET=1 turns it back on (tests, or a team decision).
  if (process.env.PAYMENT_SHEET !== '1') {
    return res.status(410).json({ error: 'Payments happen on the CosQuest website. Update the app to pay.', code: 'pay_on_website' });
  }
  try {
    if (!mongoose.isValidObjectId(req.params.questId)) return res.status(404).json({ error: 'Quest not found.' });
    const p = req.body?.position;
    const position = p && typeof p === 'object' ? { lat: p.lat, lng: p.lng, accuracy: p.accuracy } : null;
    const result = await tickets.startCheckout({ user: req.user, questId: req.params.questId, ticketTypeId: req.body?.ticketTypeId, position, method: 'sheet', ip: req.ip });
    return res.status(result.reused ? 200 : 201).json({
      order: tickets.orderJson(result.order, result.ticket),
      paymentIntentClientSecret: result.order.status === 'pending' ? result.clientSecret || null : null,
      ticket: result.ticket ? { id: String(result.ticket._id) } : null,
      reused: Boolean(result.reused),
    });
  } catch (error) {
    return answer(res, error);
  }
}

async function getOrder(req, res) {
  if (!mongoose.isValidObjectId(req.params.orderId)) return res.status(404).json({ error: 'Order not found.' });
  let order = await Order.findOne({ _id: req.params.orderId, user: req.userId });
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  // The return page: if the webhook hasn't arrived yet, ask Stripe.
  if (order.status === 'pending') order = await tickets.reconcileOrder(order);
  const ticket = await Ticket.findOne({ order: order._id });
  return res.json({ order: tickets.orderJson(order, ticket) });
}

async function ticketJson(ticket, { withCode = false } = {}) {
  const [quest, type, order] = await Promise.all([Quest.findById(ticket.quest), TicketType.findById(ticket.ticketType), Order.findById(ticket.order)]);
  const startsIn = quest ? quest.startsAt.getTime() - Date.now() : 0;
  const refundable = ['valid'].includes(ticket.status) && quest && quest.status !== 'cancelled' && startsIn > CUTOFF_HOURS() * 3600e3;
  return {
    id: String(ticket._id),
    status: ticket.status,
    ...(withCode ? { code: ticket.code } : {}),
    quest: quest ? serializeQuest(quest) : null,
    ticketType: type ? { id: String(type._id), name: type.name } : null,
    order: order ? { id: String(order._id), number: tickets.orderLabel(order), amount: order.amount, status: order.status, paidAt: order.paidAt } : null,
    checkedInAt: ticket.checkedInAt,
    canGiveBack: Boolean(refundable),
    giveBackUntil: quest ? new Date(quest.startsAt.getTime() - CUTOFF_HOURS() * 3600e3) : null,
    createdAt: ticket.createdAt,
  };
}

async function myTickets(req, res) {
  const rows = await Ticket.find({ user: req.userId }).sort({ createdAt: -1 }).limit(100);
  const items = await Promise.all(rows.map((t) => ticketJson(t)));
  const now = Date.now();
  const past = (t) => !t.quest || new Date(t.quest.endsAt).getTime() <= now || ['refunded', 'cancelled'].includes(t.status);
  const scope = req.query.scope === 'past' ? 'past' : 'upcoming';
  return res.json({ tickets: items.filter((t) => (scope === 'past' ? past(t) : !past(t))).sort((a, b) => new Date(a.quest?.startsAt || 0) - new Date(b.quest?.startsAt || 0)) });
}

async function myTicket(req, res) {
  if (!mongoose.isValidObjectId(req.params.ticketId)) return res.status(404).json({ error: 'Ticket not found.' });
  const ticket = await Ticket.findOne({ _id: req.params.ticketId, user: req.userId });
  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
  return res.json({ ticket: await ticketJson(ticket, { withCode: ticket.status === 'valid' }) });
}

async function cancelMyTicket(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.ticketId)) return res.status(404).json({ error: 'Ticket not found.' });
    const ticket = await Ticket.findOne({ _id: req.params.ticketId, user: req.userId });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
    const json = await ticketJson(ticket);
    if (!json.canGiveBack) {
      return res.status(409).json({ error: ticket.status !== 'valid' ? 'This ticket can no longer be given back.' : `Tickets can be given back until ${CUTOFF_HOURS()} hours before the start.`, code: 'refund_window_closed' });
    }
    const result = await tickets.refundOrder(ticket.order, { reason: 'Given back by the member', by: req.user._id });
    return res.json({ order: tickets.orderJson(result.order), refunded: result.order.status === 'refunded' });
  } catch (error) {
    return answer(res, error);
  }
}

module.exports = { listTicketTypes, checkout, paymentSheet, getOrder, myTickets, myTicket, cancelMyTicket, ticketJson };
