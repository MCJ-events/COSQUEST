const mongoose = require('mongoose');
const Call = require('../models/Call');
const VoiceRoom = require('../models/VoiceRoom');
const User = require('../models/User');
const Block = require('../models/Block');
const FactionAlert = require('../models/FactionAlert');
const push = require('../utils/push');
const { emitToUsers } = require('../realtime/socket');

// "Faction in danger": someone in a call or a voice chat calls their whole
// faction for help.
//
//   POST /api/calls/:callId/alert   { message? }   from a call you are in
//   POST /api/voice/:roomId/alert   { message? }   from a voice chat you are in
//   GET  /api/alerts/:alertId                       the alert (faction members)
//   POST /api/alerts/:alertId/respond               join that call / voice chat
//
// Everyone in the sender's faction (onboarded, not blocked either way) gets
// the socket event `alert:faction` and a high-priority push on the Android
// channel "alerts". People with the app open get only the socket event (the
// app shows its own alert, not the generic banner). The sender's circle in
// that call or voice chat shows a flare (`alert` in its JSON) for 10 minutes;
// people can respond for 30 minutes. One alert per person every 5 minutes.

const FLARE_MS = 10 * 60 * 1000;
const RESPOND_MS = 30 * 60 * 1000;
const COOLDOWN_MS = 5 * 60 * 1000;
const MESSAGE_MAX = 200;

function idOf(value) {
  return String(value?._id || value || '');
}

function displayName(user) {
  const p = user?.profile || {};
  return p.displayName || [p.firstName, p.lastName].filter(Boolean).join(' ') || p.username || 'Someone';
}

const send = (res, error, extra = {}) => res.status(error.status).json({ error: error.message, ...(error.reason ? { reason: error.reason } : {}), ...extra });

// Everyone in the faction who should hear about it: onboarded members, not
// the sender, nobody blocked either way.
async function recipientsFor(sender) {
  const [members, blocks] = await Promise.all([
    User.find({ faction: sender.faction, onboardingComplete: true, _id: { $ne: sender._id } }, '_id').lean(),
    Block.find({ $or: [{ blocker: sender._id }, { blocked: sender._id }] }, 'blocker blocked').lean(),
  ]);
  const blocked = new Set(blocks.map((block) => (idOf(block.blocker) === idOf(sender) ? idOf(block.blocked) : idOf(block.blocker))));
  return members.map((member) => idOf(member)).filter((id) => !blocked.has(id));
}

function alertJson(alert, sender) {
  return {
    alertId: idOf(alert),
    from: push.actorPreview(sender),
    factionKey: alert.factionKey,
    source: alert.source,
    callId: alert.call ? idOf(alert.call) : null,
    voiceRoomId: alert.voiceRoom ? idOf(alert.voiceRoom) : null,
    conversationId: alert.conversation ? idOf(alert.conversation) : null,
    message: alert.message || null,
    at: alert.createdAt,
    flareUntil: alert.flareUntil,
    respondUntil: alert.respondUntil,
  };
}

// Checks shared by both ways of sending. Returns { message } or { error }.
async function checkSender(req) {
  if (!req.user.faction) return { error: { status: 403, message: 'Join a faction to send a faction alert.' } };
  const raw = req.body?.message;
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return { error: { status: 400, message: 'message must be text.' } };
  const message = String(raw || '').trim();
  if (message.length > MESSAGE_MAX) return { error: { status: 400, message: `Keep the message under ${MESSAGE_MAX} characters.` } };
  const recent = await FactionAlert.findOne({ sender: req.userId, createdAt: { $gt: new Date(Date.now() - COOLDOWN_MS) } }, 'createdAt').sort({ createdAt: -1 }).lean();
  if (recent) {
    const retryAfter = Math.ceil((new Date(recent.createdAt).getTime() + COOLDOWN_MS - Date.now()) / 1000);
    return { error: { status: 429, reason: 'cooldown', message: 'You just sent an alert. Wait a few minutes before sending another.' }, retryAfter };
  }
  return { message };
}

// Creates the alert, tells the faction, and shows the flare.
async function raise(req, { source, call = null, voiceRoom = null, conversation = null, message }) {
  const sender = req.user;
  const now = Date.now();
  const recipients = await recipientsFor(sender);
  const alert = await FactionAlert.create({
    sender: sender._id,
    factionKey: sender.faction,
    source,
    call,
    voiceRoom,
    conversation,
    message,
    recipientCount: recipients.length,
    flareUntil: new Date(now + FLARE_MS),
    respondUntil: new Date(now + RESPOND_MS),
  });
  const json = alertJson(alert, sender);

  emitToUsers(recipients, 'alert:faction', json);
  push.notify(recipients, {
    title: 'Faction in danger',
    body: message ? `${displayName(sender)}: ${message}` : `${displayName(sender)} needs backup. Tap to respond.`,
    data: { type: 'faction_alert', alertId: json.alertId, ...(json.callId ? { callId: json.callId } : {}), ...(json.voiceRoomId ? { voiceRoomId: json.voiceRoomId } : {}), ...(json.conversationId ? { chatId: json.conversationId } : {}) },
    channel: 'alerts',
    priority: 'high',
    ttl: RESPOND_MS / 1000,
    skipOnline: true,
    noBanner: true,
    collapseId: `alert-${json.alertId}`,
    actor: push.actorPreview(sender),
  });

  // The flare, and taking it down when it runs out.
  const flare = { alert: alert._id, user: sender._id, at: alert.createdAt, expiresAt: alert.flareUntil };
  await showFlare(alert, flare);
  setTimeout(() => showFlare(alert, null).catch((error) => console.error('[alerts] clearing the flare failed:', error.message)), FLARE_MS + 1000).unref?.();

  return json;
}

async function showFlare(alert, flare) {
  if (alert.source === 'call') {
    await require('./callController').setCallAlert(alert.call, flare, flare ? null : alert._id);
    return;
  }
  const filter = flare ? { _id: alert.voiceRoom, active: true } : { _id: alert.voiceRoom, 'activeAlert.alert': alert._id };
  const updated = await VoiceRoom.updateOne(filter, { $set: { activeAlert: flare }, $inc: { __v: 1 } });
  if (updated.modifiedCount) require('./voiceRoomController').broadcastVoiceUpdate(alert.voiceRoom, [], { immediate: true });
}

// POST /api/calls/:callId/alert - from a call you are in right now.
async function alertFromCall(req, res) {
  const callId = req.params.callId;
  if (!mongoose.isValidObjectId(callId)) return send(res, { status: 404, message: 'Call not found.' });
  const call = await Call.findById(callId, 'status members isPrivate conversation').lean();
  if (!call) return send(res, { status: 404, message: 'Call not found.' });
  if (!['ringing', 'accepted'].includes(call.status)) return send(res, { status: 410, message: 'This call has ended.' });
  const mine = call.members.find((member) => idOf(member.user) === String(req.userId));
  if (mine?.status !== 'joined') return send(res, { status: 403, message: 'Join the call first.' });
  if (call.isPrivate) return send(res, { status: 400, message: 'Send alerts from the main call, not a private call.' });

  const checked = await checkSender(req);
  if (checked.error) return send(res, checked.error, checked.retryAfter ? { retryAfter: checked.retryAfter } : {});
  const alert = await raise(req, { source: 'call', call: call._id, conversation: call.conversation, message: checked.message });
  return res.status(201).json({ alert });
}

// POST /api/voice/:roomId/alert - from a voice chat you are in right now.
async function alertFromVoice(req, res) {
  const roomId = req.params.roomId;
  if (!mongoose.isValidObjectId(roomId)) return send(res, { status: 404, message: 'Voice chat not found.' });
  const room = await VoiceRoom.findById(roomId, 'active members.user conversation').lean();
  if (!room) return send(res, { status: 404, message: 'Voice chat not found.' });
  if (!room.active) return send(res, { status: 410, message: 'This voice chat has ended.' });
  if (!room.members.some((member) => idOf(member.user) === String(req.userId))) return send(res, { status: 403, message: 'Join the voice chat first.' });

  const checked = await checkSender(req);
  if (checked.error) return send(res, checked.error, checked.retryAfter ? { retryAfter: checked.retryAfter } : {});
  const alert = await raise(req, { source: 'voice', voiceRoom: room._id, conversation: room.conversation, message: checked.message });
  return res.status(201).json({ alert });
}

// The alert, for a member of its faction (or its sender). Returns { alert, sender } or { error }.
async function loadAlert(req) {
  const alertId = req.params.alertId;
  if (!mongoose.isValidObjectId(alertId)) return { error: { status: 404, message: 'Alert not found.' } };
  const alert = await FactionAlert.findById(alertId).lean();
  if (!alert) return { error: { status: 404, message: 'Alert not found.' } };
  const isSender = idOf(alert.sender) === String(req.userId);
  if (!isSender && req.user.faction !== alert.factionKey) return { error: { status: 403, message: 'This alert is for another faction.' } };
  const sender = await User.findById(alert.sender).select('profile.username profile.displayName profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl').lean();
  return { alert, sender, isSender };
}

// GET /api/alerts/:alertId - what the push opens: the alert and whether you
// can still respond.
async function getAlert(req, res) {
  const loaded = await loadAlert(req);
  if (loaded.error) return send(res, loaded.error);
  const { alert, sender } = loaded;
  return res.json({
    alert: alertJson(alert, sender),
    canRespond: !loaded.isSender && new Date(alert.respondUntil) > new Date(),
    responded: alert.responders.some((id) => idOf(id) === String(req.userId)),
    responderCount: alert.responders.length,
  });
}

// POST /api/alerts/:alertId/respond - "Respond": into that call (straight in,
// no ringing) or that voice chat. Answers like accepting a call / joining a
// voice chat (token, livekitUrl, ...), plus `source`.
async function respondToAlert(req, res) {
  const loaded = await loadAlert(req);
  if (loaded.error) return send(res, loaded.error);
  const { alert } = loaded;
  if (loaded.isSender) return send(res, { status: 400, message: 'You sent this alert.' });
  if (new Date(alert.respondUntil) <= new Date()) return send(res, { status: 410, reason: 'expired', message: 'This alert has expired.' });
  const blocked = await Block.exists({ $or: [{ blocker: alert.sender, blocked: req.userId }, { blocker: req.userId, blocked: alert.sender }] });
  if (blocked) return send(res, { status: 403, message: 'You cannot respond to this alert.' });

  const markResponded = () => FactionAlert.updateOne({ _id: alert._id }, { $addToSet: { responders: req.userId } });

  if (alert.source === 'call') {
    const calls = require('./callController');
    const joined = await calls.joinFromAlert(alert.call, req.user, alert.sender);
    if (joined.error) return send(res, joined.error);
    await markResponded();
    return res.json({ source: 'call', call: calls.toCallJson(joined.call), ...joined.extras });
  }

  // A voice chat: the usual join (the same access rules), unless it has ended
  // - Respond never starts a new one.
  const room = await VoiceRoom.findById(alert.voiceRoom, 'active conversation').lean();
  if (!room?.active) return send(res, { status: 410, message: 'This voice chat has ended.' });
  req.params.conversationId = idOf(room.conversation);
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 300) markResponded().catch(() => {});
    return originalJson(res.statusCode < 300 ? { source: 'voice', ...body } : body);
  };
  return require('./voiceRoomController').joinVoiceRoom(req, res);
}

module.exports = { alertFromCall, alertFromVoice, getAlert, respondToAlert, _internal: { FLARE_MS, RESPOND_MS, COOLDOWN_MS } };
