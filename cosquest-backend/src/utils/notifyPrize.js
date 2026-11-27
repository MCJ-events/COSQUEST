// Telling winners about their prize (in-app notification, which also sends the push).
const notificationModel = require('../models/notificationModel');

const money = (c) => `$${(c.amountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

async function toClaim(c, questTitle) {
  const by = c.claimDeadline.toISOString().slice(0, 10);
  await notificationModel.createForUser(c.user, `Claim your ${money(c)} prize from ${questTitle} in My prizes (by ${by}).`, { type: 'system', link: '/prizes' });
}

async function paid(c) {
  await notificationModel.createForUser(c.user, `Your prize of ${money(c)} (PC-${c.number}) has been paid.`, { type: 'system', link: '/prizes' });
}

async function approved(c) {
  const until = c.holdUntil ? c.holdUntil.toISOString().slice(0, 10) : 'soon';
  await notificationModel.createForUser(c.user, `Your ${money(c)} prize (PC-${c.number}) is approved: it will be sent after ${until}.`, { type: 'system', link: '/prizes' });
}

module.exports = { toClaim, approved, paid };
