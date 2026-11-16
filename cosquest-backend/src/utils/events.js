// Event rules that sit around tickets.
//   salesClosesAt()  ticket sales close when the quest starts (or earlier,
//                    if the ticket type has its own end)
//   placeLabel()     1st, 2nd, 3rd, 4th...
//   remindTomorrow() "Tomorrow!" to ticket holders, once, 23-25 hours before
//   nudgeSalesClosing() "Ticket sales close in about an hour" to people who
//                    started buying but didn't finish, once per quest
const Quest = require('../models/Quest');
const Ticket = require('../models/Ticket');
const Order = require('../models/Order');
const notificationModel = require('../models/notificationModel');

function salesClosesAt(ticketType, quest) {
  // SALES_AFTER_START=1: sales stay open after the start (as checkout does).
  const starts = quest?.startsAt && process.env.SALES_AFTER_START !== '1' ? new Date(quest.startsAt) : null;
  const own = ticketType?.salesEndAt ? new Date(ticketType.salesEndAt) : null;
  if (starts && own) return own < starts ? own : starts;
  return own || starts;
}

function placeLabel(place) {
  const n = Number(place);
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
  return `${n}${suffix}`;
}

const when = (date) => new Date(date).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: process.env.REMINDER_TIME_ZONE || 'America/Los_Angeles' });

function tell(userId, message, data = {}) {
  notificationModel.createForUser(userId, message, { type: 'system', ...data }).catch(() => {});
}

function push(userIds, note) {
  require('./push').sendToUsers(userIds.map(String), { channel: 'default', skipOnline: false, ...note }).catch(() => {});
}

/** "Tomorrow!": valid tickets for quests starting in 23-25 hours, once per ticket. */
async function remindTomorrow(now = new Date()) {
  const soon = await Quest.find({
    isPublished: true,
    status: { $ne: 'cancelled' },
    startsAt: { $gt: new Date(now.getTime() + 23 * 3600e3), $lte: new Date(now.getTime() + 25 * 3600e3) },
  }).select('title startsAt location');
  let sent = 0;
  for (const quest of soon) {
    const due = await Ticket.find({ quest: quest._id, status: 'valid', dayReminderSentAt: null }).select('_id user').limit(1000);
    for (const t of due) {
      const claimed = await Ticket.findOneAndUpdate({ _id: t._id, dayReminderSentAt: null }, { $set: { dayReminderSentAt: new Date() } });
      if (!claimed) continue;
      tell(t.user, `Tomorrow: ${quest.title} at ${when(quest.startsAt)}. Your ticket is in My tickets.`);
      push([t.user], { title: `Tomorrow: ${quest.title}`, body: `${when(quest.startsAt)}${quest.location?.name ? ` · ${quest.location.name}` : ''}. Tap to see your ticket.`, data: { type: 'ticket', ticketId: String(t._id) }, category: 'eventReminders' });
      sent += 1;
    }
  }
  return sent;
}

/**
 * "Ticket sales close in about an hour": quests starting in 50-70 minutes
 * (sales close at the start). Only people who started buying (an order that
 * expired or failed) and have no ticket; once per person per quest (the
 * order's salesNudgedAt, claimed atomically). Never to everyone nearby.
 */
async function nudgeSalesClosing(now = new Date()) {
  const soon = await Quest.find({
    isPublished: true,
    status: { $ne: 'cancelled' },
    startsAt: { $gt: new Date(now.getTime() + 50 * 60e3), $lte: new Date(now.getTime() + 70 * 60e3) },
  }).select('title startsAt');
  let sent = 0;
  for (const quest of soon) {
    const unfinished = await Order.find({ quest: quest._id, status: { $in: ['expired', 'failed'] } }).sort({ createdAt: -1 }).select('_id user salesNudgedAt').limit(2000);
    const seen = new Set();
    for (const order of unfinished) {
      const userId = String(order.user);
      if (seen.has(userId)) continue;
      seen.add(userId);
      if (await Ticket.exists({ quest: quest._id, user: order.user, status: { $in: ['valid', 'checked_in'] } })) continue;
      if (await Order.exists({ quest: quest._id, user: order.user, salesNudgedAt: { $ne: null } })) continue;
      const claimed = await Order.findOneAndUpdate({ _id: order._id, salesNudgedAt: null }, { $set: { salesNudgedAt: new Date() } });
      if (!claimed) continue;
      tell(order.user, `Last chance: ticket sales for ${quest.title} close in about an hour.`);
      push([order.user], { title: `Last chance: ${quest.title}`, body: 'Ticket sales close in about an hour.', data: { type: 'quest', questId: String(quest._id) }, category: 'questUpdates' });
      sent += 1;
    }
  }
  return sent;
}

module.exports = { salesClosesAt, placeLabel, remindTomorrow, nudgeSalesClosing };
