const mongoose = require('mongoose');
const Call = require('../models/Call');
const User = require('../models/User');
const { createCallToken, getLivekitUrl } = require('../utils/livekit');
const { isBlockedEitherWay } = require('./publicProfileController');
const { loadConversationForUser } = require('./chatController');
const { emitToUsers } = require('../realtime/socket');

const RING_TIMEOUT_MS = 45 * 1000;
const TERMINAL_STATUSES = ['declined', 'missed', 'cancelled', 'ended'];
const CALLER_FIELDS = 'profile.username profile.displayName profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl';

function ringCutoff() {
  return new Date(Date.now() - RING_TIMEOUT_MS);
}

function callerId(call) {
  return String(call.caller?._id || call.caller);
}

function displayName(user) {
  const profile = user?.profile || {};
  return profile.displayName || [profile.firstName, profile.lastName].filter(Boolean).join(' ') || profile.username || 'User';
}

function callerPreview(caller) {
  if (!caller?.profile) {
    return { id: String(caller?._id || caller || ''), username: null, name: 'User', avatarKey: null, avatarPhotoUrl: null };
  }
  return {
    id: String(caller._id),
    username: caller.profile.username,
    name: displayName(caller),
    avatarKey: caller.profile.avatarKey,
    avatarPhotoUrl: caller.profile.avatarPhotoUrl,
  };
}

function participantIds(call) {
  return call.participants.map(String);
}

function toCallJson(call) {
  return {
    id: String(call._id),
    conversationId: String(call.conversation?._id || call.conversation),
    conversationType: call.conversationType || 'dm',
    type: call.type,
    status: call.status,
    caller: callerPreview(call.caller),
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
  if (!participantIds(call).includes(String(userId))) return { status: 403, error: 'You are not part of this call.' };
  return { call };
}

function broadcastCallUpdate(call) {
  emitToUsers(participantIds(call), 'call:updated', { call: toCallJson(call) });
}

async function markMissedIfExpired(call) {
  if (call.status !== 'ringing' || new Date(call.createdAt) > ringCutoff()) return call;

  const updated = await Call.findOneAndUpdate(
    { _id: call._id, status: 'ringing', active: true, createdAt: { $lte: ringCutoff() } },
    { $set: { status: 'missed', active: false, endedAt: new Date() } },
    { new: true }
  ).populate('caller', CALLER_FIELDS);

  if (updated) {
    broadcastCallUpdate(updated);
    return updated;
  }
  return Call.findById(call._id).populate('caller', CALLER_FIELDS);
}

function scheduleMissedCheck(callId) {
  const timer = setTimeout(async () => {
    try {
      const call = await Call.findById(callId).populate('caller', CALLER_FIELDS);
      if (call) await markMissedIfExpired(call);
    } catch (error) {
      console.error('[calls] missed-call check failed:', error.message);
    }
  }, RING_TIMEOUT_MS + 1000);
  timer.unref?.();
}

async function joinInfo(call, user) {
  const token = await createCallToken({
    userId: user._id,
    name: displayName(user),
    roomName: call.roomName,
  });
  return { call: toCallJson(call), token, livekitUrl: getLivekitUrl() };
}

async function startCall(req, res) {
  const { type } = req.body || {};

  if (!['audio', 'video'].includes(type)) {
    return res.status(400).json({ error: 'Call type must be audio or video.' });
  }
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });
  if (conversation.type !== 'dm') {
    return res.status(400).json({ error: 'Calls are only available in direct messages.' });
  }

  const memberIds = conversation.participants.map(String);
  if (memberIds.length !== 2) {
    return res.status(400).json({ error: 'A direct-message call needs exactly two participants.' });
  }

  const recipientId = memberIds.find((id) => id !== String(req.userId));
  const recipient = await User.findById(recipientId).select('privacy.allowDirectMessages');
  if (!recipient || await isBlockedEitherWay(req.userId, recipientId)) {
    return res.status(403).json({ error: 'Calls are unavailable for this conversation.' });
  }
  if (recipient.privacy?.allowDirectMessages === false) {
    return res.status(403).json({ error: 'This user is not accepting direct messages or calls.' });
  }

  // Validate configuration before creating a ringing call.
  getLivekitUrl();

  const expiredCalls = await Call.find({
    participants: { $in: memberIds },
    status: 'ringing',
    active: true,
    createdAt: { $lte: ringCutoff() },
  }).populate('caller', CALLER_FIELDS);
  await Promise.all(expiredCalls.map(markMissedIfExpired));

  const existing = await Call.findOne({ participants: { $in: memberIds }, active: true });
  if (existing) {
    const sameConversation = String(existing.conversation) === String(conversation._id);
    return res.status(409).json({
      error: sameConversation
        ? 'A call is already in progress in this chat.'
        : 'One of you is already on another call.',
    });
  }

  const call = new Call({
    conversation: conversation._id,
    conversationType: 'dm',
    type,
    caller: req.userId,
    participants: memberIds,
    status: 'ringing',
  });
  call.roomName = `call_${call._id}`;

  try {
    await call.save();
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'One of you already has an active call.' });
    }
    throw error;
  }

  let response;
  try {
    await populateCaller(call);
    response = await joinInfo(call, req.user);
  } catch (error) {
    await Call.updateOne(
      { _id: call._id, status: 'ringing' },
      { $set: { status: 'cancelled', active: false, endedAt: new Date() } }
    );
    throw error;
  }

  emitToUsers([recipientId], 'call:incoming', { call: response.call });
  scheduleMissedCheck(call._id);
  return res.status(201).json(response);
}

async function getIncomingCall(req, res) {
  const expiredCalls = await Call.find({
    participants: req.userId,
    status: 'ringing',
    active: true,
    createdAt: { $lte: ringCutoff() },
  }).populate('caller', CALLER_FIELDS);
  await Promise.all(expiredCalls.map(markMissedIfExpired));

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
  let acceptedNow = false;
  if (call.status === 'ringing') {
    const updated = await Call.findOneAndUpdate(
      { _id: call._id, status: 'ringing', active: true, createdAt: { $gt: ringCutoff() } },
      { $set: { status: 'accepted', answeredAt: new Date() } },
      { new: true }
    ).populate('caller', CALLER_FIELDS);
    if (updated) {
      call = updated;
      acceptedNow = true;
    } else {
      call = await Call.findById(result.call._id).populate('caller', CALLER_FIELDS);
    }
  }
  if (!call || call.status !== 'accepted') {
    return res.status(410).json({ error: 'This call has ended.' });
  }

  if (acceptedNow) broadcastCallUpdate(call);
  return res.json(await joinInfo(call, req.user));
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
    const updated = await Call.findOneAndUpdate(
      { _id: call._id, status: 'ringing', active: true },
      { $set: { status: 'declined', active: false, endedAt: new Date() } },
      { new: true }
    ).populate('caller', CALLER_FIELDS);
    if (updated) {
      call = updated;
      broadcastCallUpdate(call);
    } else {
      call = await Call.findById(result.call._id).populate('caller', CALLER_FIELDS);
    }
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
    if (updated) {
      call = updated;
      broadcastCallUpdate(call);
    } else {
      call = await Call.findById(call._id).populate('caller', CALLER_FIELDS);
    }
  }

  return res.json({ call: toCallJson(call) });
}

module.exports = { startCall, getIncomingCall, getCall, acceptCall, declineCall, endCall };
