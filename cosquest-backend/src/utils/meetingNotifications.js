const User = require('../models/User');
const Notification = require('../models/Notification');
const ScheduledCall = require('../models/ScheduledCall');
const { groupFor } = require('./projectAccess');
const { emitToUser, emitToConversation } = require('../realtime/socket');
const { peopleFor, publicCallJson } = require('./scheduledCallJson');
const { rollForward } = require('./meetingTime');
const push = require('./push');
const notificationModel = require('../models/notificationModel');

const REMINDER = 'starts in 10 minutes or less';

// Live update for everyone with the group chat open: `scheduled-call:updated`
// { callId, conversationId, call } (call without passcode or invite link -
// the app refetches GET /scheduled-calls/:id for those).
async function announceCall(call) {
  const json = publicCallJson(call, await peopleFor([call]));
  emitToConversation(String(call.conversation), 'scheduled-call:updated', { callId: json.id, conversationId: json.conversationId, call: json });
}

async function notifyMeeting(call, action, userIds = null) {
  const ids = userIds || call.participants.filter(p => p.response !== 'declined').map(p => p.user);
  const [users, people] = await Promise.all([User.find({ _id: { $in: ids } }), peopleFor([call])]);
  const json = publicCallJson(call, people);
  const message = `${call.topic}: ${action}.`;
  await Promise.all(users.map(async user => {
    try { await groupFor(String(call.conversation), user); } catch (e) { if ([403, 404].includes(e.status)) return; throw e; }
    const revision = action === REMINDER ? call.startsAt.toISOString() : call.__v || 0;
    const key = `${call._id}:${revision}:${action}:${user.id}`;
    let result;
    try { result = await Notification.updateOne({ deliveryKey: key }, { $setOnInsert: { user: user._id, message, type: 'group', actor: call.host, conversation: call.conversation, scheduledCall: call._id, deliveryKey: key } }, { upsert: true }); }
    catch (e) { if (e.code === 11000) return; throw e; } // another worker delivered it
    if (!result.upsertedCount) return;
    emitToUser(user.id, 'scheduled-call:updated', { callId: json.id, conversationId: json.conversationId, action, call: json });
    const host = people.get(String(call.host));
    emitToUser(user.id, 'notification:new', notificationModel.sanitize({ _id: result.upsertedId, type: 'group', message, actor: host, conversation: call.conversation, scheduledCall: call._id, read: false, createdAt: new Date() }));
    // Open app: an in-app banner instead of a push (push.js skipOnline).
    push.sendToUsers([user.id], { title: 'CosQuest calls', body: message, category: 'eventReminders', channel: 'calls', skipOnline: true, actor: push.actorPreview(host), data: { type: 'scheduled-call', scheduledCallId: String(call._id), conversationId: String(call.conversation) } });
  }));
}

// Moves repeating series whose current occurrence has ended to the next one.
async function rollDue(now = new Date()) {
  const calls = await ScheduledCall.find({ rollsForward: true, cancelledAt: null, endsAt: { $lte: now } }).limit(100);
  for (const call of calls) {
    if (!rollForward(call, now)) continue;
    try { await call.save(); } catch (e) { if (e.name === 'VersionError') continue; throw e; } // someone else moved it
    await announceCall(call);
  }
}

// The 10-minute reminder goes to the host and everyone who accepted (the
// phone app also sets its own local reminder; this covers the website and
// people who haven't opened the app).
async function remindDue(now = new Date()) {
  await rollDue(now);
  const calls = await ScheduledCall.find({ cancelledAt: null, reminderSentAt: null, startsAt: { $gt: now, $lte: new Date(now.getTime() + 10 * 60000) } }).limit(100);
  for (const call of calls) {
    await notifyMeeting(call, REMINDER, [call.host, ...call.participants.filter(p => p.response === 'accepted').map(p => p.user)]);
    await ScheduledCall.updateOne({ _id: call._id, __v: call.__v, cancelledAt: null }, { $set: { reminderSentAt: now } });
  }
}
let timer;
function start() {
  if (timer || process.env.MEETING_REMINDERS_WORKER === '0') return;
  let busy = false;
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await remindDue(); } catch (e) { console.error('[meeting reminders]', e.message); } finally { busy = false; }
  }, 30000);
  timer.unref();
}
function stop() { clearInterval(timer); timer = null; }
module.exports = { notifyMeeting, announceCall, remindDue, rollDue, start, stop };
