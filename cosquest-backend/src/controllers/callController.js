const mongoose = require('mongoose');
const Call = require('../models/Call');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const { createCallToken, getLivekitUrl } = require('../utils/livekit');
const { isBlockedEitherWay } = require('./publicProfileController');

const RING_TIMEOUT_MS = 45 * 1000;
const TERMINAL_STATUSES = ['declined', 'missed', 'cancelled', 'ended'];
const CALLER_FIELDS = 'profile.username profile.avatarPhotoUrl';

function ringCutoff() {
  return new Date(Date.now() - RING_TIMEOUT_MS);
}

function callerId(call) {
  return String(call.caller?._id || call.caller);
}

function isParticipant(call, userId) {
  return call.participants.some((id) => String(id) === String(userId));
}

function toCallJson(call) {
  const caller = call.caller || {};
  return {
    id: String(call._id),
    conversationId: String(call.conversation?._id || call.conversation),
    conversationType: call.conversationType || 'dm',
    type: call.type,
    status: call.status,
    caller: {
      id: String(caller._id || caller),
      username: caller.profile?.username || 'User',
      avatarPhotoUrl: caller.profile?.avatarPhotoUrl || null,
    },
    createdAt: call.createdAt,
    answeredAt: call.answeredAt,
    endedAt: call.endedAt,
  };
}

async function populateCaller(call) {
  if (call) await call.populate('caller', CALLER_FIELDS);
  return call;
}

async function findCallForUser(callId, userId) {
  if (!mongoose.isValidObjectId(callId)) return { status: 404, error: 'Call not found.' };
  const call = await Call.findById(callId).populate('caller', CALLER_FIELDS);
  if (!call) return { status: 404, error: 'Call not found.' };
  if (!isParticipant(call, userId)) return { status: 403, error: 'You are not part of this call.' };
  return { call };
}

async function markMissedIfExpired(call) {
  if (call.status !== 'ringing' || new Date(call.createdAt) > ringCutoff()) return call;

  const updated = await Call.findOneAndUpdate(
    { _id: call._id, status: 'ringing', active: true, createdAt: { $lte: ringCutoff() } },
    { $set: { status: 'missed', active: false, endedAt: new Date() } },
    { new: true }
  ).populate('caller', CALLER_FIELDS);

  return updated || Call.findById(call._id).populate('caller', CALLER_FIELDS);
}

async function startCall(req, res) {
  const { conversationId } = req.params;
  const { type } = req.body || {};

  if (!['audio', 'video'].includes(type)) {
    return res.status(400).json({ error: 'Call type must be audio or video.' });
  }
  if (!mongoose.isValidObjectId(conversationId)) {
    return res.status(404).json({ error: 'Chat not found.' });
  }

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) return res.status(404).json({ error: 'Chat not found.' });
  if (conversation.type !== 'dm') {
    return res.status(400).json({ error: 'Calls are only available in direct messages.' });
  }

  const participantIds = conversation.participants.map(String);
  if (!participantIds.includes(String(req.userId))) {
    return res.status(403).json({ error: 'You are not in this chat.' });
  }
  if (participantIds.length !== 2) {
    return res.status(400).json({ error: 'A direct-message call needs exactly two participants.' });
  }

  const recipientId = participantIds.find((id) => id !== String(req.userId));
  const recipient = await User.findById(recipientId).select('privacy.allowDirectMessages');
  if (!recipient || await isBlockedEitherWay(req.userId, recipientId)) {
    return res.status(403).json({ error: 'Calls are unavailable for this conversation.' });
  }
  if (recipient.privacy?.allowDirectMessages === false) {
    return res.status(403).json({ error: 'This user is not accepting direct messages or calls.' });
  }

  // Validate configuration before creating a ringing call.
  const livekitUrl = getLivekitUrl();
  await Call.updateMany(
    { conversation: conversation._id, status: 'ringing', active: true, createdAt: { $lte: ringCutoff() } },
    { $set: { status: 'missed', active: false, endedAt: new Date() } }
  );
  if (await Call.exists({ conversation: conversation._id, active: true })) {
    return res.status(409).json({ error: 'A call is already in progress in this chat.' });
  }

  const call = new Call({
    conversation: conversation._id,
    conversationType: 'dm',
    type,
    caller: req.userId,
    participants: participantIds,
    status: 'ringing',
  });
  call.roomName = `call_${call._id}`;

  try {
    await call.save();
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'A call is already in progress in this chat.' });
    }
    throw error;
  }

  let token;
  try {
    token = await createCallToken({
      userId: req.userId,
      username: req.user.profile?.username,
      roomName: call.roomName,
    });
  } catch (error) {
    await Call.updateOne(
      { _id: call._id, status: 'ringing' },
      { $set: { status: 'cancelled', active: false, endedAt: new Date() } }
    );
    throw error;
  }

  await populateCaller(call);
  return res.status(201).json({ call: toCallJson(call), token, livekitUrl });
}

async function getIncomingCall(req, res) {
  await Call.updateMany(
    { participants: req.userId, status: 'ringing', active: true, createdAt: { $lte: ringCutoff() } },
    { $set: { status: 'missed', active: false, endedAt: new Date() } }
  );

  const call = await Call.findOne({
    participants: req.userId,
    caller: { $ne: req.userId },
    status: 'ringing',
    active: true,
    createdAt: { $gt: ringCutoff() },
  })
    .sort({ createdAt: -1 })
    .populate('caller', CALLER_FIELDS);

  return res.json({ call: call ? toCallJson(call) : null });
}

async function getCall(req, res) {
  const result = await findCallForUser(req.params.callId, req.userId);
  if (result.error) return res.status(result.status).json({ error: result.error });
  const call = await markMissedIfExpired(result.call);
  return res.json({ call: toCallJson(call) });
}

async function acceptCall(req, res) {
  const result = await findCallForUser(req.params.callId, req.userId);
  if (result.error) return res.status(result.status).json({ error: result.error });
  if (callerId(result.call) === String(req.userId)) {
    return res.status(400).json({ error: "You can't answer your own call." });
  }

  let call = await markMissedIfExpired(result.call);
  if (call.status === 'ringing') {
    call = await Call.findOneAndUpdate(
      { _id: call._id, status: 'ringing', active: true, createdAt: { $gt: ringCutoff() } },
      { $set: { status: 'accepted', answeredAt: new Date() } },
      { new: true }
    ).populate('caller', CALLER_FIELDS);
    if (!call) call = await Call.findById(result.call._id).populate('caller', CALLER_FIELDS);
  }
  if (!call || call.status !== 'accepted') {
    return res.status(410).json({ error: 'This call has ended.' });
  }

  const token = await createCallToken({
    userId: req.userId,
    username: req.user.profile?.username,
    roomName: call.roomName,
  });
  return res.json({ call: toCallJson(call), token, livekitUrl: getLivekitUrl() });
}

async function declineCall(req, res) {
  const result = await findCallForUser(req.params.callId, req.userId);
  if (result.error) return res.status(result.status).json({ error: result.error });
  if (callerId(result.call) === String(req.userId)) {
    return res.status(400).json({ error: 'The caller must cancel the call instead.' });
  }

  let call = await markMissedIfExpired(result.call);
  if (call.status === 'accepted') {
    return res.status(409).json({ error: 'An accepted call must be ended.' });
  }
  if (call.status === 'ringing') {
    call = await Call.findOneAndUpdate(
      { _id: call._id, status: 'ringing', active: true },
      { $set: { status: 'declined', active: false, endedAt: new Date() } },
      { new: true }
    ).populate('caller', CALLER_FIELDS);
    if (!call) call = await Call.findById(result.call._id).populate('caller', CALLER_FIELDS);
  }

  return res.json({ call: toCallJson(call) });
}

async function endCall(req, res) {
  const result = await findCallForUser(req.params.callId, req.userId);
  if (result.error) return res.status(result.status).json({ error: result.error });

  let call = await markMissedIfExpired(result.call);
  if (!TERMINAL_STATUSES.includes(call.status)) {
    const status = call.status === 'ringing'
      ? callerId(call) === String(req.userId) ? 'cancelled' : 'declined'
      : 'ended';
    const updated = await Call.findOneAndUpdate(
      { _id: call._id, status: call.status, active: true },
      { $set: { status, active: false, endedAt: new Date() } },
      { new: true }
    ).populate('caller', CALLER_FIELDS);
    call = updated || await Call.findById(call._id).populate('caller', CALLER_FIELDS);
  }

  return res.json({ call: toCallJson(call) });
}

module.exports = { startCall, getIncomingCall, getCall, acceptCall, declineCall, endCall };
