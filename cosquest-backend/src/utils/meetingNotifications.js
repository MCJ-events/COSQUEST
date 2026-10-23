const User = require('../models/User');
const Notification = require('../models/Notification');
const ScheduledCall = require('../models/ScheduledCall');
const { groupFor } = require('./projectAccess');
const { emitToUser } = require('../realtime/socket');
const push = require('./push');

async function notifyMeeting(call, action, userIds = null) {
  const ids = userIds || call.participants.filter(p => p.response !== 'declined').map(p => p.user);
  const users = await User.find({ _id: { $in: ids } });
  const message = `${call.topic}: ${action}.`;
  await Promise.all(users.map(async user => {
    try { await groupFor(String(call.conversation), user); } catch (e) { if ([403, 404].includes(e.status)) return; throw e; }
    const revision = action === 'starts in 10 minutes or less' ? call.startsAt.toISOString() : call.__v || 0;
    const key = `${call._id}:${revision}:${action}:${user.id}`;
    let result;
    try { result = await Notification.updateOne({ deliveryKey: key }, { $setOnInsert: { user: user._id, message, type: 'group', actor: call.host, conversation: call.conversation, scheduledCall: call._id, deliveryKey: key } }, { upsert: true }); }
    catch (e) { if (e.code === 11000) return; throw e; } // another worker delivered it
    if (!result.upsertedCount) return;
    emitToUser(user.id, 'scheduled-call:updated', { callId: String(call._id), conversationId: String(call.conversation), action });
    emitToUser(user.id, 'notification:new', { message, scheduledCallId: String(call._id) });
    push.sendToUsers([user.id], { title: 'CosQuest calls', body: message, category: 'eventReminders', channel: 'calls', data: { type: 'scheduled-call', scheduledCallId: String(call._id), conversationId: String(call.conversation) } });
  }));
}
async function remindDue(now = new Date()) {
  const calls = await ScheduledCall.find({ cancelledAt: null, reminderSentAt: null, startsAt: { $gt: now, $lte: new Date(now.getTime() + 10 * 60000) } }).limit(100);
  for (const call of calls) {
    await notifyMeeting(call, 'starts in 10 minutes or less', [call.host, ...call.participants.filter(p => p.response !== 'declined').map(p => p.user)]);
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
module.exports = { notifyMeeting, remindDue, start, stop };
