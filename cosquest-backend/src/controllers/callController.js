const mongoose = require('mongoose');
const Call = require('../models/Call');
const VoiceRoom = require('../models/VoiceRoom');
const User = require('../models/User');
const userModel = require('../models/userModel');
const { createCallToken, getLivekitUrl } = require('../utils/livekit');
const { sourcesFor, setSources, muteMicrophone, removeFromRoom } = require('../utils/callRoom');
const { isBlockedEitherWay } = require('./publicProfileController');
const { loadConversationForUser } = require('./chatController');
const Block = require('../models/Block');
const { emitToUsers } = require('../realtime/socket');
const push = require('../utils/push');
const { recordCallMessage } = require('../utils/callMessage');
const limits = require('../config/callLimits');
const { createMutationQueue } = require('../utils/mutationQueue');
const { createCoalescer } = require('../utils/coalescer');

const RING_TIMEOUT_MS = 45 * 1000;
const TERMINAL_STATUSES = ['declined', 'missed', 'cancelled', 'ended'];
const USER_FIELDS =
  'profile.username profile.displayName profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl';

// ==========================================================================
// SMALL HELPERS
// ==========================================================================

function idOf(value) {
  return String(value?._id || value || '');
}

function ringCutoff(now = new Date()) {
  return new Date(now.getTime() - RING_TIMEOUT_MS);
}

function displayName(user) {
  const profile = user?.profile || {};
  return (
    profile.displayName ||
    [profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
    profile.username ||
    'User'
  );
}

function userPreview(user) {
  if (!user?.profile) {
    return { id: idOf(user), username: null, name: 'User', avatarKey: null, avatarPhotoUrl: null };
  }
  return {
    id: idOf(user),
    username: user.profile.username,
    name: displayName(user),
    avatarKey: user.profile.avatarKey,
    avatarPhotoUrl: user.profile.avatarPhotoUrl,
  };
}

function memberOf(call, userId) {
  return call.members.find((member) => idOf(member.user) === String(userId)) || null;
}

function participantIds(call) {
  return call.participants.map(idOf);
}

function isActive(call) {
  return !TERMINAL_STATUSES.includes(call.status);
}

// The call's moderator muted / removed them (POST .../members/:userId/...).
function isMuted(call, userId) {
  return (call.mutedUsers || []).some((id) => idOf(id) === String(userId));
}
function isRemoved(call, userId) {
  return (call.removedUsers || []).some((id) => idOf(id) === String(userId));
}

// What they may publish in this call: no microphone while muted by the
// moderator, screen share only while they are the one sharing.
function callSources(call, userId) {
  return sourcesFor({ microphone: !isMuted(call, userId), screenShare: idOf(call.screenShare?.user) === String(userId) });
}

const REMOVED_ERROR = { status: 403, reason: 'removed', message: 'You were removed from this call.' };

function sendError(res, error, extra = {}) {
  return res.status(error.status).json({ error: error.message, ...(error.reason ? { reason: error.reason } : {}), ...extra });
}

// People ringing or in the call right now. (Counted from `members`, not
// `activeMembers`, which is only refreshed on save - several changes can be
// applied to one loaded copy before it is saved.)
function activeCount(call) {
  return call.members.filter((member) => ['ringing', 'joined'].includes(member.status)).length;
}

// Calls started before group calls existed have no `members` - build them
// from the old fields so every call can be handled the same way.
function ensureMembers(call) {
  if (call.members?.length) return;

  const callerId = idOf(call.caller);
  const memberStatusFor = (isCaller) => {
    if (call.status === 'accepted') return 'joined';
    if (call.status === 'ringing') return isCaller ? 'joined' : 'ringing';
    if (call.status === 'ended') return 'left';
    if (call.status === 'declined') return isCaller ? 'left' : 'declined';
    return isCaller ? 'left' : 'missed';
  };

  call.members = call.participants.map((participant) => {
    const isCaller = idOf(participant) === callerId;
    return {
      user: participant,
      status: memberStatusFor(isCaller),
      invitedBy: isCaller ? null : call.caller,
      invitedAt: call.createdAt,
      joinedAt: isCaller ? call.createdAt : call.answeredAt,
      leftAt: call.endedAt,
    };
  });
}

// ==========================================================================
// CALL RULES (the same for one-to-one and group calls)
// ==========================================================================

// Anyone still ringing after 45 seconds has missed it.
function expireRinging(call, now = new Date()) {
  let changed = false;
  const cutoff = ringCutoff(now);

  call.members.forEach((member) => {
    if (member.status === 'ringing' && new Date(member.invitedAt) <= cutoff) {
      member.status = 'missed';
      member.leftAt = now;
      changed = true;
    }
  });

  return changed;
}

// Works out the call's overall status from everyone's own status.
function settle(call, now = new Date()) {
  if (!isActive(call)) return;

  const joined = call.members.filter((member) => member.status === 'joined');
  const ringing = call.members.filter((member) => member.status === 'ringing');

  const finish = (status) => {
    call.status = status;
    call.endedAt = now;
    call.members.forEach((member) => {
      if (member.status === 'ringing') {
        member.status = 'missed';
        member.leftAt = now;
      } else if (member.status === 'joined') {
        member.status = 'left';
        member.leftAt = now;
      }
    });
  };

  if (call.status === 'ringing' && joined.length >= 2) {
    call.status = 'accepted';
    call.answeredAt = call.answeredAt || now;
    return;
  }

  if (call.status === 'ringing') {
    // Nobody has answered yet.
    if (joined.length === 0) return finish('cancelled'); // the caller hung up

    if (ringing.length === 0) {
      // Everyone invited either declined or didn't answer.
      const callerId = idOf(call.caller);
      const others = call.members.filter((member) => idOf(member.user) !== callerId);
      const everyoneDeclined = others.length > 0 && others.every((member) => member.status === 'declined');
      return finish(everyoneDeclined ? 'declined' : 'missed');
    }
    return;
  }

  // Answered: the call ends when nobody (or only one person, with nobody
  // else still ringing) is left in it.
  if (joined.length === 0 || (joined.length === 1 && ringing.length === 0)) {
    finish('ended');
  }
}

// ==========================================================================
// LOADING, SAVING AND SENDING
// ==========================================================================

// Who is away in this call or voice chat right now: everyone in one of its
// answered private calls. Worked out from the private calls each time (not
// stored), so it can never be left behind when a private call ends.
async function awayIn(mainId) {
  const privateCalls = await Call.find(
    { active: true, isPrivate: true, privateOf: mainId, status: 'accepted' },
    'members.user members.status'
  ).lean();
  const away = new Set();
  privateCalls.forEach((call) =>
    call.members.forEach((member) => member.status === 'joined' && away.add(idOf(member.user)))
  );
  return away;
}

const awayByCall = new WeakMap(); // call document -> Set of userIds away in a private call

// Plain objects (lean), not full documents: a 1,000-person call populates
// 1,000 users, and only their names and avatars are read.
async function populateCall(call) {
  if (!call) return call;
  const [away] = await Promise.all([
    call.isPrivate || !isActive(call) ? new Set() : awayIn(call._id),
    call.populate([
      { path: 'caller', select: USER_FIELDS, options: { lean: true } },
      { path: 'members.user', select: USER_FIELDS, options: { lean: true } },
    ]),
  ]);
  awayByCall.set(call, away);
  return call;
}

// A call's JSON is built once per loaded copy of the call and shared by
// everything that sends that copy (the live update, the ring, and every
// HTTP response in the same batch), instead of once per recipient.
const callJsonCache = new WeakMap(); // call document -> { json, text }

function toCallJson(call) {
  let cached = callJsonCache.get(call);
  if (!cached) {
    cached = { json: buildCallJson(call), text: null };
    callJsonCache.set(call, cached);
  }
  return cached.json;
}

function callJsonText(call) {
  toCallJson(call);
  const cached = callJsonCache.get(call);
  if (cached.text === null) cached.text = JSON.stringify(cached.json);
  return cached.text;
}

// res.json({ call, ...extra }) without serialising the (possibly large) call
// again for every person: the call's text is made once and reused.
function sendCall(res, status, call, extra = {}) {
  const rest = JSON.stringify(extra);
  const body = rest === '{}' ? `{"call":${callJsonText(call)}}` : `{"call":${callJsonText(call)},${rest.slice(1)}`;
  return res.status(status).type('application/json').send(body);
}

function buildCallJson(call) {
  const away = awayByCall.get(call) || new Set();
  return {
    id: idOf(call),
    conversationId: idOf(call.conversation),
    conversationType: call.conversationType || 'dm',
    type: call.type,
    status: call.status,
    isGroup: Boolean(call.isGroup),
    // A private call: the call ('call') or voice chat ('voice') it was started from.
    privateOf: call.privateOf ? idOf(call.privateOf) : null,
    privateOfType: call.privateOfType || null,
    caller: userPreview(call.caller),
    members: call.members.map((member) => ({
      user: userPreview(member.user),
      status: member.status,
      // In one of this call's private calls right now.
      away: away.has(idOf(member.user)),
      // The call's moderator muted them: they can't turn their microphone on.
      mutedByAdmin: isMuted(call, idOf(member.user)),
      invitedBy: member.invitedBy ? idOf(member.invitedBy) : null,
      invitedAt: member.invitedAt || null,
      joinedAt: member.joinedAt || null,
      leftAt: member.leftAt || null,
    })),
    // The app shows these: how many people can be in the call at once, and
    // how many can be added in one go (CALL_MAX_IN_CALL /
    // CALL_MAX_INVITES_PER_REQUEST).
    // Who is sharing their screen right now (one person at a time).
    screenShare: call.screenShare?.user ? { userId: idOf(call.screenShare.user), startedAt: call.screenShare.startedAt } : null,
    // Who can mute and remove people in this call: whoever started it.
    moderatorId: idOf(call.caller),
    // A "faction in danger" alert sent from this call (the flare on that
    // person's circle) until expiresAt. src/controllers/alertController.js.
    alert: call.activeAlert?.user && new Date(call.activeAlert.expiresAt) > new Date()
      ? { alertId: idOf(call.activeAlert.alert), userId: idOf(call.activeAlert.user), at: call.activeAlert.at, expiresAt: call.activeAlert.expiresAt }
      : null,
    maxParticipants: limits.maxInCall(),
    maxInvitesPerRequest: limits.maxInvitesPerRequest(),
    createdAt: call.createdAt,
    answeredAt: call.answeredAt,
    endedAt: call.endedAt,
  };
}

// Loads a call, applies a change, and saves it. If someone else changed the
// same call at the same moment, it reloads and tries again. Changes to the
// same call that arrive together are applied in one batch (one load, one
// save, one populate) - see src/utils/mutationQueue.js.
//
// `mutator(call)` returns:
//   false                     - nothing changed (no save)
//   { error: {status, ...} }  - stop with that error (no save)
//   anything else             - save, and pass it back as `result`
const callMutations = createMutationQueue({
  load: async (callId) => {
    const call = await Call.findById(callId);
    if (call) ensureMembers(call);
    return call;
  },
  populate: populateCall,
  conflictMessage: 'The call changed too quickly. Please try again.',
});

async function mutateCall(callId, mutator) {
  const { doc, ...rest } = await callMutations(callId, mutator);
  return { call: doc, ...rest };
}

// Last state sent per call, so an older copy can never follow a newer one
// (e.g. "accepted" arriving after "ended").
const lastSentAt = new Map(); // callId -> updatedAt (ms)

function sendCallUpdate(callId, call) {
  const at = new Date(call.updatedAt || 0).getTime();
  if (at < (lastSentAt.get(callId) ?? -Infinity)) return;
  lastSentAt.set(callId, at);
  if (!isActive(call)) {
    setTimeout(() => lastSentAt.get(callId) === at && lastSentAt.delete(callId), 60 * 1000).unref?.();
  }

  emitToUsers(participantIds(call), 'call:updated', { call: toCallJson(call) });
  // Private calls stay out of Sparks (no transcript or outline) and leave no
  // call entry in the chat.
  if (call.isPrivate) return;
  // Sparks: call transcription/outline bookkeeping (no-op on the legacy engine).
  require('../sparks/calls').sync(call);

  if (!isActive(call)) {
    recordCallMessage(call).catch((error) =>
      console.error('[calls] failed to record call message:', error.message)
    );
  }
}

// At most one `call:updated` per call per interval (250 ms, longer for very
// big calls - see CALL_BROADCAST_*), always carrying the latest state. The
// first change goes out at once; a call ending goes out at once.
const callUpdates = createCoalescer({
  label: 'calls',
  interval: (call) => limits.broadcastIntervalMs(call?.members?.length || 0),
  send: sendCallUpdate,
});

function newer(a, b) {
  const at = (call) => new Date(call?.updatedAt || 0).getTime();
  return at(b) >= at(a) ? b : a;
}

// Tells everyone who was part of the call what changed, and saves the call
// entry in the chat once the call has finished.
function broadcastCallUpdate(call) {
  callUpdates.push(idOf(call), call, { immediate: !isActive(call), merge: newer });
  // Once a private call has been answered, any change to it can change who
  // is away in the call or voice chat it came from.
  if (call.isPrivate && call.answeredAt) {
    announceAway(call).catch((error) => console.error('[calls] away update failed:', error.message));
  }
}

// Sends the main call (or voice chat) of this private call again, with who
// is away now.
async function announceAway(privateCall) {
  const mainId = privateCall.privateOf;
  if (privateCall.privateOfType === 'voice') {
    const people = privateCall.members.map((member) => member.user?._id || member.user);
    await require('./voiceRoomController').privateCallChanged(mainId, people);
    return;
  }

  // Marks the main call as changed now, so this copy goes out after (and
  // replaces) any copy loaded before the private call changed.
  const touched = await Call.updateOne(
    { _id: mainId, status: { $in: ['ringing', 'accepted'] } },
    { $set: { updatedAt: new Date() } }
  );
  if (!touched.matchedCount) return; // the main call has ended
  const main = await Call.findById(mainId);
  if (!main || !isActive(main)) return;
  ensureMembers(main);
  await populateCall(main);
  broadcastCallUpdate(main);
}

// Applies the 45-second rule to a call right now (and sends any change).
// How long someone who dropped out of LiveKit (webhook) has to reconnect
// before they count as having left the call - so a phone that crashed or
// lost signal doesn't keep the call (and their "busy") going forever.
const RECONNECT_GRACE_MS = 20 * 1000;

function expireDisconnected(call, now = new Date()) {
  let changed = false;
  call.members.forEach((member) => {
    if (member.status === 'joined' && member.disconnectedAt && now - new Date(member.disconnectedAt) >= RECONNECT_GRACE_MS) {
      member.status = 'left';
      member.leftAt = now;
      member.disconnectedAt = null;
      changed = true;
    }
  });
  return changed;
}

async function refreshCall(callId) {
  const { call, changed } = await mutateCall(callId, (current) => {
    if (!isActive(current)) return false;
    const now = new Date();
    const rang = expireRinging(current, now);
    const dropped = expireDisconnected(current, now);
    if (!rang && !dropped) return false;
    settle(current, now);
    return true;
  });

  if (call && changed) broadcastCallUpdate(call);
  return call;
}

// Refreshes every active call these people are ringing in or part of.
async function refreshCallsFor(userIds) {
  const calls = await Call.find(
    {
      active: true,
      $or: [
        { activeMembers: { $in: userIds } },
        // Calls started before group calls existed.
        { participants: { $in: userIds }, 'members.0': { $exists: false } },
      ],
    },
    '_id'
  );
  await Promise.all(calls.map((call) => refreshCall(call._id)));
}

function scheduleRingTimeout(callId) {
  const timer = setTimeout(() => {
    refreshCall(callId).catch((error) =>
      console.error('[calls] missed-call check failed:', error.message)
    );
  }, RING_TIMEOUT_MS + 1000);
  timer.unref?.();
}

// Is this person ringing in, or part of, another active call? (A private
// call started from `exceptCallId` doesn't count either.)
async function isBusy(userId, exceptCallId = null) {
  const filter = {
    active: true,
    $or: [
      { activeMembers: userId },
      { participants: userId, 'members.0': { $exists: false } },
    ],
  };
  if (exceptCallId) {
    filter._id = { $ne: exceptCallId };
    filter.privateOf = { $ne: exceptCallId };
  }
  return Boolean(await Call.exists(filter));
}

// The LiveKit token and address for joining this call's room.
// Of these people, who has blocked (or been blocked by) `userId`? One query.
async function blockedEitherWayAmong(userId, otherIds) {
  if (!otherIds.length) return new Set();
  const blocks = await Block.find(
    {
      $or: [
        { blocker: userId, blocked: { $in: otherIds } },
        { blocker: { $in: otherIds }, blocked: userId },
      ],
    },
    'blocker blocked'
  ).lean();
  const me = String(userId);
  return new Set(blocks.map((block) => (String(block.blocker) === me ? String(block.blocked) : String(block.blocker))));
}

// Of these people, who is ringing in or part of another active call? Same
// rule as isBusy(), for everyone at once.
async function busyAmong(userIds, exceptCallId = null) {
  if (!userIds.length) return new Set();
  const wanted = new Set(userIds.map(String));
  const notThisCall = exceptCallId ? { privateOf: { $ne: exceptCallId } } : {};
  const [current, legacy] = await Promise.all([
    Call.find(
      { active: true, _id: { $ne: exceptCallId }, ...notThisCall, activeMembers: { $in: userIds } },
      'activeMembers'
    ).lean(),
    Call.find(
      { active: true, _id: { $ne: exceptCallId }, participants: { $in: userIds }, 'members.0': { $exists: false } },
      'participants'
    ).lean(),
  ]);
  const busy = new Set();
  current.forEach((call) => call.activeMembers.forEach((id) => wanted.has(String(id)) && busy.add(String(id))));
  legacy.forEach((call) => call.participants.forEach((id) => wanted.has(String(id)) && busy.add(String(id))));
  return busy;
}

// What the app needs to connect: the LiveKit token (screen sharing only for
// the person sharing), whether the camera starts on (only in video calls -
// audio calls and private calls start with it off), and whether the Sparks
// transcription notice applies.
async function joinExtras(call, user) {
  const token = await createCallToken({
    userId: user._id,
    name: displayName(user),
    roomName: call.roomName,
    sources: callSources(call, user._id),
  });
  return {
    token,
    livekitUrl: getLivekitUrl(),
    media: { cameraStartsOn: call.type === 'video' },
    transcription: await require('../sparks/calls').transcriptionFor(idOf(call), user._id),
  };
}

// Is this person part of the call? Asks the database directly instead of
// loading the call's whole participant list on every request.
async function findCallForUser(callId, userId) {
  if (!mongoose.isValidObjectId(callId)) return { status: 404, error: 'Call not found.' };
  const mine = await Call.findOne({ _id: callId, participants: userId }, '_id').lean();
  if (mine) return { callId: mine._id };
  if (!(await Call.exists({ _id: callId }))) return { status: 404, error: 'Call not found.' };
  return { status: 403, error: 'You are not part of this call.' };
}

// ==========================================================================
// ENDPOINTS
// ==========================================================================

// POST /api/chats/:conversationId/calls - start a one-to-one call in a DM.
async function startCall(req, res) {
  const { type } = req.body || {};

  if (!['audio', 'video'].includes(type)) {
    return res.status(400).json({ error: 'Call type must be audio or video.' });
  }
  const { conversation, error } = await loadConversationForUser(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });
  if (conversation.type !== 'dm') {
    return res.status(400).json({ error: 'Calls start in direct messages. Use a voice chat in groups.' });
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

  await refreshCallsFor(memberIds);

  const existing = await Call.findOne({
    active: true,
    $or: [
      { conversation: conversation._id, isPrivate: false },
      { activeMembers: { $in: memberIds } },
      { participants: { $in: memberIds }, 'members.0': { $exists: false } },
    ],
  });
  if (existing) {
    const sameConversation = String(existing.conversation) === String(conversation._id);
    return res.status(409).json({
      error: sameConversation
        ? 'A call is already in progress in this chat.'
        : 'One of you is already on another call.',
    });
  }

  const now = new Date();
  const call = new Call({
    conversation: conversation._id,
    conversationType: 'dm',
    type,
    caller: req.userId,
    participants: memberIds,
    members: [
      { user: req.userId, status: 'joined', invitedAt: now, joinedAt: now },
      { user: recipientId, status: 'ringing', invitedBy: req.userId, invitedAt: now },
    ],
    status: 'ringing',
  });
  call.roomName = `call_${call._id}`;

  try {
    await call.save();
  } catch (saveError) {
    if (saveError?.code === 11000) {
      return res.status(409).json({ error: 'A call is already in progress in this chat.' });
    }
    throw saveError;
  }

  let extras;
  try {
    await populateCall(call);
    extras = await joinExtras(call, req.user);
  } catch (tokenError) {
    await Call.updateOne(
      { _id: call._id, status: 'ringing' },
      { $set: { status: 'cancelled', active: false, activeMembers: [], endedAt: new Date() } }
    );
    throw tokenError;
  }

  emitToUsers([recipientId], 'call:incoming', {
    call: toCallJson(call),
    invitedBy: userPreview(call.caller),
  });
  push.notifyIncomingCall([recipientId], { call: toCallJson(call), caller: userPreview(call.caller) });
  scheduleRingTimeout(call._id);
  return sendCall(res, 201, call, extras);
}

// GET /api/calls/incoming - is anything ringing for me right now?
async function getIncomingCall(req, res) {
  await refreshCallsFor([String(req.userId)]);

  const call = await Call.findOne({
    active: true,
    // Ringing people are always in activeMembers, which is indexed.
    activeMembers: req.userId,
    members: {
      $elemMatch: {
        user: req.userId,
        status: 'ringing',
        invitedAt: { $gt: ringCutoff() },
      },
    },
  }).sort({ createdAt: -1 });

  if (!call) return res.json({ call: null, invitedBy: null });

  ensureMembers(call);
  await populateCall(call);

  // Only the person who added me, not every member's inviter.
  const mine = memberOf(call, req.userId);
  const inviter = mine?.invitedBy
    ? await User.findById(mine.invitedBy).select(USER_FIELDS).lean()
    : null;
  const invitedBy = inviter ? userPreview(inviter) : userPreview(call.caller);
  return sendCall(res, 200, call, { invitedBy, transcription: await require('../sparks/calls').transcriptionFor(idOf(call), req.userId) });
}

// GET /api/calls/:callId
async function getCall(req, res) {
  const found = await findCallForUser(req.params.callId, req.userId);
  if (found.error) return res.status(found.status).json({ error: found.error });

  const call = await refreshCall(found.callId);
  return sendCall(res, 200, call);
}

// POST /api/calls/:callId/accept - answer a ringing call.
async function acceptCall(req, res) {
  const found = await findCallForUser(req.params.callId, req.userId);
  if (found.error) return res.status(found.status).json({ error: found.error });

  const { call, changed, error } = await mutateCall(found.callId, (current) => {
    const now = new Date();
    const expired = expireRinging(current, now);
    if (expired) settle(current, now);

    const mine = memberOf(current, req.userId);
    if (!mine) return { error: { status: 403, message: 'You are not part of this call.' } };
    if (isRemoved(current, req.userId)) return { error: REMOVED_ERROR };
    if (mine.status === 'joined') return expired ? true : false; // already in it
    if (!isActive(current) || mine.status !== 'ringing') {
      // Save the expiry (if any) but report that this call is over for them.
      return expired ? { ended: true } : { error: { status: 410, message: 'This call has ended.' } };
    }

    mine.status = 'joined';
    mine.joinedAt = now;
    mine.disconnectedAt = null;
    mine.leftAt = null;
    settle(current, now);
    return true;
  });

  if (error) return sendError(res, error);
  if (changed) broadcastCallUpdate(call);

  const mine = memberOf(call, req.userId);
  if (!isActive(call) || mine?.status !== 'joined') {
    return res.status(410).json({ error: 'This call has ended.' });
  }
  return sendCall(res, 200, call, await joinExtras(call, req.user));
}

// POST /api/calls/:callId/decline - say no to a ringing call.
async function declineCall(req, res) {
  const found = await findCallForUser(req.params.callId, req.userId);
  if (found.error) return res.status(found.status).json({ error: found.error });

  const { call, changed, error } = await mutateCall(found.callId, (current) => {
    const now = new Date();
    const expired = expireRinging(current, now);

    const mine = memberOf(current, req.userId);
    if (!mine) return { error: { status: 403, message: 'You are not part of this call.' } };
    if (mine.status === 'joined' && isActive(current)) {
      return { error: { status: 409, message: 'You are in this call. Leave it instead.' } };
    }
    if (mine.status !== 'ringing') {
      if (expired) settle(current, now);
      return expired ? true : false;
    }

    mine.status = 'declined';
    mine.leftAt = now;
    settle(current, now);
    return true;
  });

  if (error) return res.status(error.status).json({ error: error.message });
  if (changed) broadcastCallUpdate(call);
  return sendCall(res, 200, call);
}

// POST /api/calls/:callId/end - hang up / leave. In a group call the others
// keep talking; the call ends when the last person leaves.
async function endCall(req, res) {
  const found = await findCallForUser(req.params.callId, req.userId);
  if (found.error) return res.status(found.status).json({ error: found.error });

  const { call, changed, error } = await mutateCall(found.callId, (current) => {
    if (!isActive(current)) return false;

    const now = new Date();
    expireRinging(current, now);

    const mine = memberOf(current, req.userId);
    if (!mine) return { error: { status: 403, message: 'You are not part of this call.' } };

    if (mine.status === 'ringing') {
      mine.status = 'declined';
      mine.leftAt = now;
    } else if (mine.status === 'joined') {
      mine.status = 'left';
      mine.leftAt = now;
    }

    settle(current, now);
    return true;
  });

  if (error) return res.status(error.status).json({ error: error.message });
  if (changed) broadcastCallUpdate(call);
  return sendCall(res, 200, call);
}

// POST /api/calls/:callId/join - go back into a call you left (or missed)
// while it's still going on, like WhatsApp's "Join" on an ongoing group call.
async function rejoinCall(req, res) {
  const found = await findCallForUser(req.params.callId, req.userId);
  if (found.error) return res.status(found.status).json({ error: found.error });

  if (await isBusy(String(req.userId), found.callId)) {
    return res.status(409).json({ error: 'You are already on another call.' });
  }

  const { call, changed, error } = await mutateCall(found.callId, (current) => {
    const now = new Date();
    if (expireRinging(current, now)) settle(current, now);

    if (!isActive(current) || current.status !== 'accepted') {
      return { error: { status: 410, message: 'This call has ended.' } };
    }

    const mine = memberOf(current, req.userId);
    if (!mine) return { error: { status: 403, message: 'You are not part of this call.' } };
    if (isRemoved(current, req.userId)) return { error: REMOVED_ERROR };
    if (mine.status === 'joined') return false;

    const maxInCall = limits.maxInCall();
    if (mine.status !== 'ringing' && activeCount(current) >= maxInCall) {
      return { error: { status: 409, message: `This call is full (${maxInCall} people).` } };
    }

    mine.status = 'joined';
    mine.joinedAt = now;
    mine.disconnectedAt = null;
    mine.leftAt = null;
    settle(current, now);
    return true;
  });

  if (error) return sendError(res, error);
  if (changed) broadcastCallUpdate(call);
  return sendCall(res, 200, call, await joinExtras(call, req.user));
}

// POST /api/calls/:callId/invite - add people to the call.
// Body: { userIds: [...] } and/or { usernames: [...] }
async function inviteToCall(req, res) {
  const found = await findCallForUser(req.params.callId, req.userId);
  if (found.error) return res.status(found.status).json({ error: found.error });

  const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
  const usernames = Array.isArray(req.body?.usernames) ? req.body.usernames : [];

  if (!userIds.length && !usernames.length) {
    return res.status(400).json({ error: 'Choose at least one person to add.' });
  }
  const maxPerRequest = limits.maxInvitesPerRequest();
  if (userIds.length + usernames.length > maxPerRequest) {
    return res.status(400).json({ error: `You can add up to ${maxPerRequest} people at a time.` });
  }

  const { call, error, invited, skipped } = await inviteUsers(found.callId, req.user, { userIds, usernames });
  if (error) return res.status(error.status).json({ error: error.message, invited: [], skipped });
  return sendCall(res, 200, call, { invited, skipped });
}

// Rings people into a call, as `inviter` (who must be in it): blocks either
// way, "not accepting calls" and "already on another call" are skipped, then
// the call's own limits. One batch: at most CALL_MAX_INVITES_PER_REQUEST
// people (the caller checks). Used by POST /calls/:id/invite and by Sparks
// voice commands ("calling all sergeants", src/sparks/targetedCalls.js).
// Returns { call, invited, skipped } or { error, skipped }.
async function inviteUsers(callId, inviter, { userIds = [], usernames = [] } = {}) {
  const inviterId = String(inviter._id);
  const found = { callId };
  const skipped = [];
  const candidates = new Map(); // userId -> user

  // Everyone in one query, not one query per person.
  const validIds = [];
  for (const rawId of userIds) {
    if (typeof rawId !== 'string' || !mongoose.isValidObjectId(rawId)) {
      skipped.push({ userId: String(rawId), reason: 'not_found' });
    } else {
      validIds.push(rawId);
    }
  }
  const foundUsers = validIds.length
    ? await User.find({ _id: { $in: validIds } }).select('privacy.allowDirectMessages profile.username').lean()
    : [];
  const byId = new Map(foundUsers.map((user) => [String(user._id), user]));
  for (const rawId of validIds) {
    const user = byId.get(String(rawId));
    if (!user) skipped.push({ userId: rawId, reason: 'not_found' });
    else candidates.set(String(user._id), user);
  }

  const names = usernames.map((rawName) => (typeof rawName === 'string' ? rawName.trim().replace(/^@/, '') : ''));
  const byName = await Promise.all(names.map((name) => (name ? userModel.findByUsername(name) : null)));
  names.forEach((name, index) => {
    const user = byName[index];
    if (!user) skipped.push({ username: name, reason: 'not_found' });
    else candidates.set(String(user._id), user);
  });

  // Checks that don't depend on the call itself - blocks and "already on
  // another call" for everyone at once.
  candidates.delete(inviterId);
  const candidateIds = [...candidates.keys()];
  const [blockedIds, busyIds] = await Promise.all([
    blockedEitherWayAmong(inviterId, candidateIds),
    busyAmong(candidateIds, found.callId),
  ]);

  const allowed = [];
  for (const [userId, user] of candidates) {
    const username = user.profile?.username || null;

    if (blockedIds.has(userId)) {
      skipped.push({ userId, username, reason: 'unavailable' });
    } else if (user.privacy?.allowDirectMessages === false) {
      skipped.push({ userId, username, reason: 'not_accepting_calls' });
    } else if (busyIds.has(userId)) {
      skipped.push({ userId, username, reason: 'busy' });
    } else {
      allowed.push({ userId, username });
    }
  }

  getLivekitUrl();

  const { call, changed, error, result } = await mutateCall(found.callId, (current) => {
    const now = new Date();
    if (expireRinging(current, now)) settle(current, now);

    if (!isActive(current)) return { error: { status: 410, message: 'This call has ended.' } };
    if (current.isPrivate) return { error: { status: 400, message: 'Private calls are one-to-one.' } };

    const mine = memberOf(current, inviterId);
    if (!mine || mine.status !== 'joined') {
      return { error: { status: 403, message: 'Only people in the call can add others.' } };
    }

    const invited = [];
    const lateSkipped = [];
    const maxInCall = limits.maxInCall();
    const maxEverInvited = limits.maxEverInvited();
    let active = activeCount(current);
    const membersById = new Map(current.members.map((member) => [idOf(member.user), member]));

    for (const { userId, username } of allowed) {
      const existing = membersById.get(userId);

      if (existing && ['ringing', 'joined'].includes(existing.status)) {
        lateSkipped.push({ userId, username, reason: 'already_in_call' });
        continue;
      }
      if (isRemoved(current, userId)) {
        lateSkipped.push({ userId, username, reason: 'removed' });
        continue;
      }
      if (active >= maxInCall) {
        lateSkipped.push({ userId, username, reason: 'call_full' });
        continue;
      }
      if (!existing && current.participants.length >= maxEverInvited) {
        // Everyone who was ever in this call is remembered on it; past
        // CALL_MAX_EVER_INVITED only people who were in it before can come back.
        lateSkipped.push({ userId, username, reason: 'call_full' });
        continue;
      }

      if (existing) {
        existing.status = 'ringing';
        existing.invitedBy = inviterId;
        existing.invitedAt = now;
        existing.joinedAt = null;
        existing.leftAt = null;
      } else {
        current.members.push({ user: userId, status: 'ringing', invitedBy: inviterId, invitedAt: now });
        membersById.set(userId, current.members[current.members.length - 1]);
        if (!current.participants.some((participant) => idOf(participant) === userId)) {
          current.participants.push(userId);
        }
      }

      active += 1;
      invited.push(userId);
    }

    if (!invited.length) return { error: { status: 409, message: 'Nobody could be added.', lateSkipped } };

    current.isGroup = true;
    return { invited, lateSkipped };
  });

  if (error) {
    return { error, skipped: [...skipped, ...(error.lateSkipped || [])] };
  }

  if (changed) {
    broadcastCallUpdate(call);

    // One ring for the whole batch: a single emit to every invited person's
    // room, with the call serialised once.
    const inviterInCall = call.members.find((member) => idOf(member.user) === inviterId)?.user;
    emitToUsers(result.invited, 'call:incoming', {
      call: toCallJson(call),
      invitedBy: userPreview(inviterInCall || inviter),
    });
    push.notifyIncomingCall(result.invited, { call: toCallJson(call), caller: userPreview(inviterInCall || inviter) });
    scheduleRingTimeout(call._id);
  }

  return {
    call,
    invited: result?.invited || [],
    skipped: [...skipped, ...(result?.lateSkipped || [])],
  };
}

// Starts a one-to-one call in a DM for `caller`, ringing `recipientId`, with
// no HTTP request: a Sparks voice command when the leader is on no call
// (src/sparks/targetedCalls.js). Same rules as POST /chats/:id/calls (blocks,
// "not accepting calls", one active call per DM and per person). The caller
// is in the call; their app gets a token with POST /calls/:id/join.
// Returns { call } or { error: { status, message } }.
async function startCallFor(caller, conversation, recipientId, type = 'audio') {
  const callerId = String(caller._id);
  const otherId = String(recipientId);
  const recipient = await User.findById(otherId).select('privacy.allowDirectMessages');
  if (!recipient || (await isBlockedEitherWay(callerId, otherId))) {
    return { error: { status: 403, message: 'Calls are unavailable for this conversation.' } };
  }
  if (recipient.privacy?.allowDirectMessages === false) {
    return { error: { status: 403, message: 'This user is not accepting direct messages or calls.' } };
  }
  getLivekitUrl();

  const memberIds = [callerId, otherId];
  await refreshCallsFor(memberIds);
  const existing = await Call.exists({
    active: true,
    $or: [
      { conversation: conversation._id, isPrivate: false },
      { activeMembers: { $in: memberIds } },
      { participants: { $in: memberIds }, 'members.0': { $exists: false } },
    ],
  });
  if (existing) return { error: { status: 409, message: 'One of you is already on a call.' } };

  const now = new Date();
  const call = new Call({
    conversation: conversation._id,
    conversationType: 'dm',
    type,
    caller: callerId,
    participants: memberIds,
    members: [
      { user: callerId, status: 'joined', invitedAt: now, joinedAt: now },
      { user: otherId, status: 'ringing', invitedBy: callerId, invitedAt: now },
    ],
    status: 'ringing',
  });
  call.roomName = `call_${call._id}`;
  try {
    await call.save();
  } catch (saveError) {
    if (saveError?.code === 11000) return { error: { status: 409, message: 'A call is already in progress in this chat.' } };
    throw saveError;
  }
  await populateCall(call);
  emitToUsers([otherId], 'call:incoming', { call: toCallJson(call), invitedBy: userPreview(call.caller) });
  push.notifyIncomingCall([otherId], { call: toCallJson(call), caller: userPreview(call.caller) });
  scheduleRingTimeout(call._id);
  return { call };
}

// ==========================================================================
// PRIVATE CALLS ("private call on top")
// ==========================================================================

// Checks the person to call privately: a valid id, not yourself.
function privateTargetId(req) {
  const userId = req.body?.userId;
  if (typeof userId !== 'string' || !mongoose.isValidObjectId(userId)) {
    return { error: { status: 400, message: 'Choose who to call privately (userId).' } };
  }
  if (userId === String(req.userId)) {
    return { error: { status: 400, message: 'You cannot call yourself.' } };
  }
  return { userId };
}

// Starts a private call between `caller` and `targetId`, who are both in the
// call or voice chat `main` ({ id, type: 'call'|'voice', conversation,
// conversationType }). Rings only the target. Being in `main` doesn't count
// as busy; any other call, or another private call, does.
// Returns { call, extras } or { error: { status, message } }.
async function startPrivate(caller, targetId, main) {
  const callerId = String(caller._id);
  const target = await User.findById(targetId).select('privacy.allowDirectMessages');
  if (!target || (await isBlockedEitherWay(callerId, targetId))) {
    return { error: { status: 403, message: 'You cannot call this person privately.' } };
  }
  if (target.privacy?.allowDirectMessages === false) {
    return { error: { status: 403, message: 'This user is not accepting direct messages or calls.' } };
  }
  getLivekitUrl();

  const memberIds = [callerId, String(targetId)];
  await refreshCallsFor(memberIds); // a private call that rang out doesn't block a new one
  if (await Call.exists({ active: true, isPrivate: true, activeMembers: { $in: memberIds } })) {
    return { error: { status: 409, message: 'One of you is already in a private call.' } };
  }
  const busy = await busyAmong(memberIds, main.type === 'call' ? main.id : null);
  if (busy.size) return { error: { status: 409, message: 'One of you is on another call.' } };

  const now = new Date();
  const call = new Call({
    conversation: main.conversation,
    conversationType: main.conversationType,
    type: 'audio', // either person can turn their camera on once connected
    caller: callerId,
    participants: memberIds,
    members: [
      { user: callerId, status: 'joined', invitedAt: now, joinedAt: now },
      { user: targetId, status: 'ringing', invitedBy: callerId, invitedAt: now },
    ],
    status: 'ringing',
    isPrivate: true,
    privateOf: main.id,
    privateOfType: main.type,
  });
  call.roomName = `call_${call._id}`;

  try {
    await call.save();
  } catch (saveError) {
    if (saveError?.code === 11000) {
      return { error: { status: 409, message: 'One of you is already in a private call.' } };
    }
    throw saveError;
  }

  let extras;
  try {
    await populateCall(call);
    extras = await joinExtras(call, caller);
  } catch (tokenError) {
    await Call.updateOne(
      { _id: call._id, status: 'ringing' },
      { $set: { status: 'cancelled', active: false, activeMembers: [], endedAt: new Date() } }
    );
    throw tokenError;
  }

  emitToUsers([String(targetId)], 'call:incoming', {
    call: toCallJson(call),
    invitedBy: userPreview(call.caller),
    privateOf: String(main.id),
    privateOfType: main.type,
  });
  push.notifyIncomingCall([String(targetId)], { call: toCallJson(call), caller: userPreview(call.caller) });
  scheduleRingTimeout(call._id);
  return { call, extras };
}

// POST /api/calls/:callId/private - { userId }: a private call with someone
// else in this call. Answer, decline and hang up with the usual
// /api/calls/:id/accept, /decline and /end.
async function startPrivateCall(req, res) {
  const found = await findCallForUser(req.params.callId, req.userId);
  if (found.error) return res.status(found.status).json({ error: found.error });
  const { userId: targetId, error: targetError } = privateTargetId(req);
  if (targetError) return res.status(targetError.status).json({ error: targetError.message });

  const main = await refreshCall(found.callId);
  if (!main || !isActive(main)) return res.status(410).json({ error: 'This call has ended.' });
  if (main.isPrivate) return res.status(400).json({ error: 'This is already a private call.' });
  if (memberOf(main, req.userId)?.status !== 'joined') {
    return res.status(403).json({ error: 'Join the call first.' });
  }
  if (memberOf(main, targetId)?.status !== 'joined') {
    return res.status(409).json({ error: 'That person is not in this call right now.' });
  }

  const started = await startPrivate(req.user, targetId, {
    id: main._id,
    type: 'call',
    conversation: main.conversation?._id || main.conversation,
    conversationType: main.conversationType || 'dm',
  });
  if (started.error) return res.status(started.error.status).json({ error: started.error.message });
  return sendCall(res, 201, started.call, started.extras);
}

// POST /api/voice/:roomId/private - { userId }: the same, from a voice chat.
async function startPrivateVoiceCall(req, res) {
  const roomId = req.params.roomId;
  if (!mongoose.isValidObjectId(roomId)) return res.status(404).json({ error: 'Voice chat not found.' });
  const { userId: targetId, error: targetError } = privateTargetId(req);
  if (targetError) return res.status(targetError.status).json({ error: targetError.message });

  const room = await VoiceRoom.findById(roomId, 'conversation conversationType active members.user').lean();
  if (!room) return res.status(404).json({ error: 'Voice chat not found.' });
  if (!room.active) return res.status(410).json({ error: 'This voice chat has ended.' });
  const inRoom = (userId) => room.members.some((member) => idOf(member.user) === String(userId));
  if (!inRoom(req.userId)) return res.status(403).json({ error: 'You are not in this voice chat.' });
  if (!inRoom(targetId)) return res.status(409).json({ error: 'That person is not in this voice chat right now.' });

  const started = await startPrivate(req.user, targetId, {
    id: room._id,
    type: 'voice',
    conversation: room.conversation,
    conversationType: room.conversationType,
  });
  if (started.error) return res.status(started.error.status).json({ error: started.error.message });
  return sendCall(res, 201, started.call, started.extras);
}

// ==========================================================================
// SCREEN SHARING (one person at a time)
// ==========================================================================

// POST /api/calls/:callId/screen-share/start - share your screen in a call
// you are in. 409 while someone else is sharing. Then publish the screen
// track (LiveKit only allows it to the person sharing).
async function startScreenShare(req, res) {
  const found = await findCallForUser(req.params.callId, req.userId);
  if (found.error) return res.status(found.status).json({ error: found.error });
  const userId = String(req.userId);
  const { call, changed, error } = await mutateCall(found.callId, (current) => {
    if (!isActive(current)) return { error: { status: 410, message: 'This call has ended.' } };
    if (memberOf(current, userId)?.status !== 'joined') return { error: { status: 403, message: 'Join the call first.' } };
    const sharer = idOf(current.screenShare?.user);
    if (sharer === userId) return false; // already sharing
    if (sharer) return { error: { status: 409, reason: 'someone_sharing', message: 'Someone else is already sharing their screen.' } };
    current.screenShare = { user: req.userId, startedAt: new Date() };
    return true;
  });
  if (error) {
    const sharer = error.reason ? call?.members?.find((member) => idOf(member.user) === idOf(call.screenShare?.user))?.user : null;
    return res.status(error.status).json({
      error: sharer ? `${displayName(sharer)} is already sharing their screen.` : error.message,
      ...(error.reason ? { reason: error.reason, screenShare: toCallJson(call).screenShare } : {}),
    });
  }
  if (changed) {
    await setSources(call.roomName, userId, callSources(call, userId));
    broadcastCallUpdate(call);
  }
  return sendCall(res, 200, call);
}

// POST /api/calls/:callId/screen-share/stop - stop your share. (It also ends
// by itself when you leave the call or the call ends.)
async function stopScreenShare(req, res) {
  const found = await findCallForUser(req.params.callId, req.userId);
  if (found.error) return res.status(found.status).json({ error: found.error });
  const userId = String(req.userId);
  const { call, changed, error } = await mutateCall(found.callId, (current) => {
    const sharer = idOf(current.screenShare?.user);
    if (!sharer) return false;
    if (sharer !== userId) return { error: { status: 403, message: 'Only the person sharing can stop their screen share.' } };
    current.screenShare = null;
    return true;
  });
  if (error) return res.status(error.status).json({ error: error.message });
  if (changed) {
    await setSources(call.roomName, userId, callSources(call, userId));
    broadcastCallUpdate(call);
  }
  return sendCall(res, 200, call);
}

// ==========================================================================
// MODERATION (whoever started the call)
// ==========================================================================

// A call always starts in a DM, so it has no group admins: whoever started it
// moderates it. They can't act on themselves.
async function moderate(req, mutator) {
  const found = await findCallForUser(req.params.callId, req.userId);
  if (found.error) return { error: { status: found.status, message: found.error } };
  const targetId = req.params.userId;
  if (!mongoose.isValidObjectId(targetId)) return { error: { status: 400, message: 'Invalid user ID.' } };
  if (targetId === String(req.userId)) return { error: { status: 400, message: 'You cannot do this to yourself.' } };
  return mutateCall(found.callId, (current) => {
    if (!isActive(current)) return { error: { status: 410, message: 'This call has ended.' } };
    if (idOf(current.caller) !== String(req.userId)) {
      return { error: { status: 403, message: 'Only the person who started this call can mute or remove people.' } };
    }
    const target = memberOf(current, targetId);
    if (!target) return { error: { status: 404, message: 'That person is not part of this call.' } };
    return mutator(current, target, targetId);
  });
}

function moderationReply(res, { call, changed, error }) {
  if (error) return sendError(res, error);
  if (changed) broadcastCallUpdate(call);
  return sendCall(res, 200, call);
}

// POST /api/calls/:callId/members/:userId/mute - their microphone is muted
// and stays off (they can't turn it on) until .../unmute.
async function muteCallMember(req, res) {
  const targetId = req.params.userId;
  const outcome = await moderate(req, (current) => {
    if (isMuted(current, targetId)) return false;
    current.mutedUsers.push(targetId);
    return true;
  });
  if (outcome.changed) {
    await muteMicrophone(outcome.call.roomName, targetId);
    await setSources(outcome.call.roomName, targetId, callSources(outcome.call, targetId));
    emitToUsers([targetId], 'call:moderated', { callId: idOf(outcome.call), action: 'muted', by: String(req.userId) });
  }
  return moderationReply(res, outcome);
}

// POST /api/calls/:callId/members/:userId/unmute - they may turn their
// microphone on again (it stays off until they do).
async function unmuteCallMember(req, res) {
  const targetId = req.params.userId;
  const outcome = await moderate(req, (current) => {
    if (!isMuted(current, targetId)) return false;
    current.mutedUsers = current.mutedUsers.filter((id) => idOf(id) !== targetId);
    return true;
  });
  if (outcome.changed) {
    await setSources(outcome.call.roomName, targetId, callSources(outcome.call, targetId));
    emitToUsers([targetId], 'call:moderated', { callId: idOf(outcome.call), action: 'unmuted', by: String(req.userId) });
  }
  return moderationReply(res, outcome);
}

// POST /api/calls/:callId/members/:userId/remove - out of the call and its
// LiveKit room, and kept out: answering, rejoining or being added again is
// refused (403, reason 'removed') until .../allow.
async function removeCallMember(req, res) {
  const targetId = req.params.userId;
  const outcome = await moderate(req, (current, target) => {
    if (isRemoved(current, targetId)) return false;
    const now = new Date();
    current.removedUsers.push(targetId);
    if (['ringing', 'joined'].includes(target.status)) {
      target.status = target.status === 'ringing' ? 'declined' : 'left';
      target.leftAt = now;
    }
    settle(current, now);
    return true;
  });
  if (outcome.changed) {
    await removeFromRoom(outcome.call.roomName, targetId);
    emitToUsers([targetId], 'call:removed', { callId: idOf(outcome.call), by: String(req.userId) });
  }
  return moderationReply(res, outcome);
}

// POST /api/calls/:callId/members/:userId/allow - a removed person may be
// added to this call again (someone in it still has to add them).
async function allowCallMember(req, res) {
  const targetId = req.params.userId;
  const outcome = await moderate(req, (current) => {
    if (!isRemoved(current, targetId)) return false;
    current.removedUsers = current.removedUsers.filter((id) => idOf(id) !== targetId);
    return true;
  });
  return moderationReply(res, outcome);
}

// ==========================================================================
// FACTION ALERTS (src/controllers/alertController.js)
// ==========================================================================

// Shows (or, with null, clears) the alert's flare on this call. Clearing
// with `onlyAlertId` leaves a newer alert alone.
async function setCallAlert(callId, activeAlert, onlyAlertId = null) {
  const { call, changed } = await mutateCall(callId, (current) => {
    if (!activeAlert && (!current.activeAlert || (onlyAlertId && idOf(current.activeAlert.alert) !== String(onlyAlertId)))) return false;
    if (activeAlert && !isActive(current)) return false;
    current.activeAlert = activeAlert;
    return true;
  });
  if (call && changed) broadcastCallUpdate(call);
  return call;
}

// "Respond" to an alert sent from this call: straight into the call, without
// ringing. The call's own rules still apply (removed people stay out, the
// size limit, one call at a time). Returns { call, extras } or { error }.
async function joinFromAlert(callId, user, senderId) {
  const userId = String(user._id);
  if (await isBusy(userId, callId)) return { error: { status: 409, message: 'You are already on another call.' } };
  const { call, changed, error } = await mutateCall(callId, (current) => {
    const now = new Date();
    if (expireRinging(current, now)) settle(current, now);
    if (!isActive(current)) return { error: { status: 410, message: 'This call has ended.' } };
    if (isRemoved(current, userId)) return { error: REMOVED_ERROR };
    const mine = memberOf(current, userId);
    if (mine?.status === 'joined') return false;
    const maxInCall = limits.maxInCall();
    const full = { error: { status: 409, message: `This call is full (${maxInCall} people).` } };
    if (mine?.status !== 'ringing' && activeCount(current) >= maxInCall) return full;
    if (!mine && current.participants.length >= limits.maxEverInvited()) return full;
    if (mine) {
      mine.status = 'joined';
      mine.joinedAt = now;
      mine.leftAt = null;
      mine.disconnectedAt = null;
    } else {
      current.members.push({ user: userId, status: 'joined', invitedBy: senderId, invitedAt: now, joinedAt: now });
      if (!current.participants.some((participant) => idOf(participant) === userId)) current.participants.push(userId);
    }
    current.isGroup = true;
    settle(current, now);
    return true;
  });
  if (error) return { error };
  if (changed) broadcastCallUpdate(call);
  return { call, extras: await joinExtras(call, user) };
}

// ==========================================================================
// LIVEKIT WEBHOOKS (src/controllers/livekitWebhookController.js)
// ==========================================================================

// They dropped out of the call's LiveKit room: unless they reconnect within
// RECONNECT_GRACE_MS they have left (expireDisconnected).
async function participantLeft(callId, userId, now = new Date()) {
  const { call, changed } = await mutateCall(callId, (current) => {
    const mine = memberOf(current, userId);
    if (!isActive(current) || mine?.status !== 'joined' || mine.disconnectedAt) return false;
    mine.disconnectedAt = now;
    return true;
  });
  if (!call || !changed) return;
  setTimeout(() => refreshCall(callId).catch((error) => console.error('[calls] refresh after leave failed:', error.message)), RECONNECT_GRACE_MS + 1000).unref?.();
}

async function participantJoined(callId, userId) {
  await mutateCall(callId, (current) => {
    const mine = memberOf(current, userId);
    if (!mine?.disconnectedAt) return false;
    mine.disconnectedAt = null;
    return true;
  });
}

module.exports = {
  startCall,
  muteCallMember,
  unmuteCallMember,
  removeCallMember,
  allowCallMember,
  isRemoved,
  setCallAlert,
  joinFromAlert,
  startScreenShare,
  stopScreenShare,
  participantLeft,
  participantJoined,
  startPrivateCall,
  startPrivateVoiceCall,
  awayIn,
  getIncomingCall,
  getCall,
  acceptCall,
  declineCall,
  endCall,
  rejoinCall,
  inviteToCall,
  // Sparks voice commands (src/sparks/targetedCalls.js).
  inviteUsers,
  startCallFor,
  toCallJson,
  // Exported for tests.
  _internal: { expireRinging, expireDisconnected, settle, ensureMembers, refreshCall, flushUpdates: () => callUpdates.flushAll() },
};
