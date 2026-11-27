// Telling winners about their prize: in the notification list AND as a push to the phone
// (system notifications aren't pushed by default, so prizes push here, once each).
// Tapping opens My prizes (app/utils/openFromNotification: type "prize").
const notificationModel = require('../models/notificationModel');

const money = (c) => `$${(c.amountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

async function tell(c, message, title) {
  await notificationModel.createForUser(c.user, message, { type: 'system', link: '/prizes', push: false });
  await require('./push').sendToUsers([String(c.user)], { title, body: message, data: { type: 'prize', prizeId: String(c._id) }, channel: 'default', category: 'questUpdates', skipOnline: false });
}

async function toClaim(c, questTitle) {
  const by = c.claimDeadline.toISOString().slice(0, 10);
  await tell(c, `Claim your ${money(c)} prize from ${questTitle} in My prizes (by ${by}).`, '🏆 You have a prize to claim');
}

async function approved(c) {
  const until = c.holdUntil ? c.holdUntil.toISOString().slice(0, 10) : 'soon';
  await tell(c, `Your ${money(c)} prize (PC-${c.number}) is approved: it will be sent after ${until}.`, '✅ Prize approved');
}

async function paid(c) {
  await tell(c, `Your prize of ${money(c)} (PC-${c.number}) has been paid.`, '💸 Your prize has been paid');
}

module.exports = { toClaim, approved, paid };
