// Tickets & Payments (super admin dashboard).
//
//   GET   /api/admin/quests/:questId/ticket-types
//   POST  /api/admin/quests/:questId/ticket-types          { name, description?, price, quantity, salesStartAt?, salesEndAt? }
//   PATCH /api/admin/ticket-types/:ticketTypeId            same fields + active (quantity never below sold + held)
//   GET   /api/admin/payments/stats?from&to                gross, refunded, net, tickets, pending
//   GET   /api/admin/orders?status&quest&q&offset
//   GET   /api/admin/orders/:orderId                       with its history, ticket and Stripe ids
//   POST  /api/admin/orders/:orderId/refund                { reason }
//   POST  /api/admin/checkin                               { code, questId? } -> checked in, once
//   GET   /api/admin/quests/:questId/checkins              how many in, of how many
const mongoose = require('mongoose');
const Quest = require('../models/Quest');
const TicketType = require('../models/TicketType');
const Order = require('../models/Order');
const Ticket = require('../models/Ticket');
const User = require('../models/User');
const tickets = require('../utils/tickets');
const payments = require('../utils/stripe');
const stats = require('../utils/adminStats');
const { recordAudit } = require('../utils/audit');
const { personJson } = require('./adminOverviewController');

const PAGE = 25;

function fail(status, message, code) {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}
function answer(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  throw error;
}
async function loadQuest(id) {
  if (!mongoose.isValidObjectId(id)) fail(404, 'Quest not found.');
  const quest = await Quest.findById(id);
  if (!quest) fail(404, 'Quest not found.');
  return quest;
}

function adminTypeJson(tt) {
  return { ...tickets.ticketTypeJson(tt), sold: tt.sold, held: tt.held, active: tt.active, isDefault: tt.isDefault };
}

function readType(body, { partial = false } = {}) {
  const out = {};
  const has = (k) => body[k] !== undefined;
  if (!partial || has('name')) {
    const name = String(body.name || '').trim();
    if (name.length < 2 || name.length > 60) fail(400, 'A ticket name needs 2-60 characters.');
    out.name = name;
  }
  if (has('description')) out.description = String(body.description || '').trim().slice(0, 300);
  if (!partial || has('price')) {
    const amount = Number(body.price?.amount ?? body.price);
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000) fail(400, 'The price must be 0 or more.');
    const currency = String(body.price?.currency || process.env.QUEST_CURRENCY || 'USD').toUpperCase();
    if (amount > 0 && !payments.SUPPORTED.includes(currency)) fail(400, `${currency} isn't supported.`);
    // Stripe's minimum charge is about 0.50 in these currencies.
    if (amount > 0 && amount < 0.5) fail(400, 'Paid tickets must cost at least 0.50.');
    out.price = { amount: Math.round(amount * 100) / 100, currency };
  }
  if (!partial || has('quantity')) {
    const q = Number(body.quantity);
    if (!Number.isInteger(q) || q < 1 || q > 100000) fail(400, 'Quantity must be a whole number from 1.');
    out.quantity = q;
  }
  for (const k of ['salesStartAt', 'salesEndAt']) {
    if (has(k)) {
      if (body[k] === null || body[k] === '') out[k] = null;
      else {
        const d = new Date(body[k]);
        if (Number.isNaN(d.getTime())) fail(400, `${k} must be a date.`);
        out[k] = d;
      }
    }
  }
  if (has('active')) out.active = Boolean(body.active);
  if (has('sortOrder')) out.sortOrder = Number(body.sortOrder) || 0;
  return out;
}

async function listTypes(req, res) {
  try {
    const quest = await loadQuest(req.params.questId);
    const types = await tickets.ticketTypesFor(quest, { activeOnly: false });
    return res.json({ ticketTypes: types.map(adminTypeJson), paymentsConfigured: payments.isConfigured() });
  } catch (error) {
    return answer(res, error);
  }
}

async function createType(req, res) {
  try {
    const quest = await loadQuest(req.params.questId);
    if (quest.status === 'cancelled') fail(409, 'This quest is cancelled.');
    await tickets.ensureDefaultTicketType(quest);
    const fields = readType(req.body);
    const type = await TicketType.create({ quest: quest._id, ...fields, sortOrder: (await TicketType.countDocuments({ quest: quest._id })) + 1 });
    const event = await recordAudit(req.admin, {
      action: 'ticket_type.create',
      area: 'quests',
      target: { type: 'quest', id: quest._id, label: `${quest.title} · ${type.name}` },
      after: { name: type.name, price: type.price, quantity: type.quantity },
    });
    return res.status(201).json({ ticketType: adminTypeJson(type), auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

async function updateType(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.ticketTypeId)) fail(404, 'Ticket type not found.');
    const type = await TicketType.findById(req.params.ticketTypeId);
    if (!type) fail(404, 'Ticket type not found.');
    const fields = readType(req.body, { partial: true });
    // Never below what's sold or in someone's checkout (atomic check).
    const filter = { _id: type._id };
    if (fields.quantity !== undefined) filter.$expr = { $lte: [{ $add: ['$sold', '$held'] }, fields.quantity] };
    const before = { name: type.name, price: type.price, quantity: type.quantity, active: type.active };
    const updated = await TicketType.findOneAndUpdate(filter, { $set: fields }, { new: true });
    if (!updated) fail(409, `${type.sold + type.held} are sold or being paid for: the quantity can't go below that.`);
    const quest = await Quest.findById(type.quest).select('title');
    const event = await recordAudit(req.admin, {
      action: 'ticket_type.update',
      area: 'quests',
      target: { type: 'quest', id: type.quest, label: `${quest?.title || 'Quest'} · ${updated.name}` },
      before,
      after: fields,
    });
    return res.json({ ticketType: adminTypeJson(updated), auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

async function paymentStats(req, res) {
  const { current } = stats.windows(req.query);
  const inWindow = { paidAt: { $gte: current.from, $lt: current.to } };
  const [paid, refunded, pending, free, ticketsSold] = await Promise.all([
    Order.aggregate([{ $match: { status: { $in: ['paid', 'refunded'] }, ...inWindow } }, { $group: { _id: '$amount.currency', gross: { $sum: '$amount.amount' }, n: { $sum: 1 } } }]),
    Order.aggregate([{ $match: { status: 'refunded', refundedAt: { $gte: current.from, $lt: current.to } } }, { $group: { _id: '$amount.currency', total: { $sum: '$amount.amount' }, n: { $sum: 1 } } }]),
    Order.countDocuments({ status: 'pending' }),
    Order.countDocuments({ status: 'free', ...inWindow }),
    Ticket.countDocuments({ createdAt: { $gte: current.from, $lt: current.to } }),
  ]);
  const usd = (rows, key) => rows.find((r) => r._id === 'USD')?.[key] || 0;
  return res.json({
    window: current,
    currency: 'USD',
    gross: usd(paid, 'gross'),
    refunded: usd(refunded, 'total'),
    net: Math.round((usd(paid, 'gross') - usd(refunded, 'total')) * 100) / 100,
    paidOrders: usd(paid, 'n'),
    refundedOrders: usd(refunded, 'n'),
    freeTickets: free,
    ticketsIssued: ticketsSold,
    pendingCheckouts: pending,
    paymentsConfigured: payments.isConfigured(),
    mode: (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_') ? 'live' : 'test',
  });
}

function adminOrderJson(order) {
  return {
    ...tickets.orderJson(order),
    user: personJson(order.user),
    quest: order.quest?.title ? { id: String(order.quest._id), title: order.quest.title, startsAt: order.quest.startsAt } : { id: String(order.quest) },
    stripe: { checkoutSessionId: order.stripe.checkoutSessionId, paymentIntentId: order.stripe.paymentIntentId, refundId: order.stripe.refundId },
  };
}

async function listOrders(req, res) {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.quest && mongoose.isValidObjectId(req.query.quest)) filter.quest = req.query.quest;
  if (req.query.q) {
    const q = String(req.query.q).trim();
    const number = Number(q.replace(/^ord-?/i, ''));
    const s = q.replace(/^@/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const users = await User.find({ $or: [{ 'profile.usernameNormalized': { $regex: `^${s.toLowerCase()}` } }, { email: { $regex: `^${s.toLowerCase()}` } }] }, '_id').limit(50);
    filter.$or = [...(Number.isInteger(number) && number > 0 ? [{ number }] : []), { user: { $in: users.map((u) => u._id) } }, { 'stripe.paymentIntentId': q }];
  }
  const offset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
  const [rows, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1, _id: -1 }).skip(offset).limit(PAGE).populate('user', 'profile').populate('quest', 'title startsAt'),
    Order.countDocuments(filter),
  ]);
  return res.json({ orders: rows.map(adminOrderJson), total, nextOffset: offset + rows.length < total ? offset + rows.length : null });
}

async function orderDetail(req, res) {
  if (!mongoose.isValidObjectId(req.params.orderId)) return res.status(404).json({ error: 'Order not found.' });
  const order = await Order.findById(req.params.orderId).populate('user', 'profile email').populate('quest', 'title startsAt');
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const [ticket, type] = await Promise.all([Ticket.findOne({ order: order._id }), TicketType.findById(order.ticketType).select('name')]);
  return res.json({
    order: { ...adminOrderJson(order), email: order.user?.email || null, ticketType: type?.name || null, history: order.history },
    ticket: ticket ? { id: String(ticket._id), status: ticket.status, checkedInAt: ticket.checkedInAt } : null,
    stripeDashboard: order.stripe.paymentIntentId ? `https://dashboard.stripe.com/${(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_') ? '' : 'test/'}payments/${order.stripe.paymentIntentId}` : null,
  });
}

async function refund(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.orderId)) fail(404, 'Order not found.');
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 3) fail(400, 'A reason is required.', 'reason_required');
    const result = await tickets.refundOrder(req.params.orderId, { reason, by: req.admin._id });
    const order = await Order.findById(req.params.orderId).populate('quest', 'title');
    const event = await recordAudit(req.admin, {
      action: 'order.refund',
      area: 'quests',
      target: { type: 'order', id: order._id, label: `${tickets.orderLabel(order)} · ${order.quest?.title || ''}` },
      reason,
      before: { status: 'paid' },
      after: { status: result.order.status },
      meta: { amount: order.amount, authorId: String(order.user) },
    });
    return res.json({ order: tickets.orderJson(result.order), auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

async function checkin(req, res) {
  try {
    const code = String(req.body.code || '').trim();
    if (!/^CQT-[A-Za-z0-9_-]{16,40}$/.test(code)) fail(400, "That doesn't look like a CosQuest ticket.", 'bad_code');
    const ticket = await Ticket.findOne({ code });
    if (!ticket) fail(404, 'No ticket with this code.', 'unknown_ticket');
    if (req.body.questId && String(ticket.quest) !== String(req.body.questId)) fail(409, 'This ticket is for a different quest or event.', 'other_quest');
    const [user, quest] = await Promise.all([User.findById(ticket.user).select('profile'), Quest.findById(ticket.quest).select('title startsAt endsAt')]);
    const who = { person: personJson(user), quest: quest ? { id: String(quest._id), title: quest.title } : null };
    if (ticket.status === 'refunded' || ticket.status === 'cancelled') return res.status(409).json({ error: `This ticket was ${ticket.status}.`, code: 'not_valid', ...who });
    // One atomic step: a copied code only gets in once.
    const updated = await Ticket.findOneAndUpdate({ _id: ticket._id, status: 'valid' }, { $set: { status: 'checked_in', checkedInAt: new Date(), checkedInBy: req.admin._id } }, { new: true });
    if (!updated) {
      const current = await Ticket.findById(ticket._id);
      return res.status(409).json({ error: 'Already checked in.', code: 'already_checked_in', checkedInAt: current.checkedInAt, ...who });
    }
    await recordAudit(req.admin, { action: 'ticket.checkin', area: 'quests', target: { type: 'ticket', id: ticket._id, label: `${quest?.title || ''} · @${user?.profile?.username || ''}` } });
    return res.json({ checkedIn: true, checkedInAt: updated.checkedInAt, ...who });
  } catch (error) {
    return answer(res, error);
  }
}

async function checkinSummary(req, res) {
  try {
    const quest = await loadQuest(req.params.questId);
    const [inside, total] = await Promise.all([
      Ticket.countDocuments({ quest: quest._id, status: 'checked_in' }),
      Ticket.countDocuments({ quest: quest._id, status: { $in: ['valid', 'checked_in'] } }),
    ]);
    return res.json({ checkedIn: inside, tickets: total });
  } catch (error) {
    return answer(res, error);
  }
}

module.exports = { listTypes, createType, updateType, paymentStats, listOrders, orderDetail, refund, checkin, checkinSummary };
