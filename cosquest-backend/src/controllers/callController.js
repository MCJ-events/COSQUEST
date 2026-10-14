const mongoose = require('mongoose');
const Call = require('../models/Call');
const User = require('../models/User');
const userModel = require('../models/userModel');
const { createCallToken, getLivekitUrl } = require('../utils/livekit');
const { isBlockedEitherWay } = require('./publicProfileController');
const { loadConversationForUser } = require('./chatController');
const Block = require('../models/Block');
const { emitToUsers } = require('../realtime/socket');
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

// Plain objects (lean), not full documents: a 1,000-person call populates
// 1,000 users, and only their names and avatars are read.
async function populateCall(call) {
  if (!call) return call;
  await call.populate([
    { path: 'caller', select: USER_FIELDS, options: { lean: true } },
    { path: 'members.user', select: USER_FIELDS, options: { lean: true } },
  ]);
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
  return {
    id: idOf(call),
    conversationId: idOf(call.conversation),
    conversationType: call.conversationType || 'dm',
    type: call.type,
    status: call.status,
    isGroup: Boolean(call.isGroup),
    caller: userPreview(call.caller),
    members: call.members.map((member) => ({
      user: userPreview(member.user),
      status: member.status,
      invitedBy: member.invitedBy ? idOf(member.invitedBy) : null,
      invitedAt: member.invitedAt || null,
      joinedAt: member.joinedAt || null,
      leftAt: member.leftAt || null,
    })),
    // The app shows these: how many people can be in the call at once, and
    // how many can be added in one go (CALL_MAX_IN_CALL /
    // CALL_MAX_INVITES_PER_REQUEST).
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
}

// Applies the 45-second rule to a call right now (and sends any change).
async function refreshCall(callId) {
  const { call, changed } = await mutateCall(callId, (current) => {
    if (!isActive(current)) return false;
    if (!expireRinging(current)) return false;
    settle(current);
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

// Is this person ringing in, or part of, another active call?
async function isBusy(userId, exceptCallId = null) {
  const filter = {
    active: true,
    $or: [
      { activeMembers: userId },
      { participants: userId, 'members.0': { $exists: false } },
    ],
  };
  if (exceptCallId) filter._id = { $ne: exceptCallId };
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
async function busyAmong(userIds, exceptCallId) {
  if (!userIds.length) return new Set();
  const wanted = new Set(userIds.map(String));
  const [current, legacy] = await Promise.all([
    Call.find({ active: true, _id: { $ne: exceptCallId }, activeMembers: { $in: userIds } }, 'activeMembers').lean(),
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

async function joinExtras(call, user) {
  const token = await createCallToken({
    userId: user._id,
    name: displayName(user),
    roomName: call.roomName,
  });
  return { token, livekitUrl: getLivekitUrl() };
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
      { conversation: conversation._id },
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
  return sendCall(res, 200, call, { invitedBy });
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
    if (mine.status === 'joined') return expired ? true : false; // already in it
    if (!isActive(current) || mine.status !== 'ringing') {
      // Save the expiry (if any) but report that this call is over for them.
      return expired ? { ended: true } : { error: { status: 410, message: 'This call has ended.' } };
    }

    mine.status = 'joined';
    mine.joinedAt = now;
    mine.leftAt = null;
    settle(current, now);
    return true;
  });

  if (error) return res.status(error.status).json({ error: error.message });
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
    if (mine.status === 'joined') return false;

    const maxInCall = limits.maxInCall();
    if (mine.status !== 'ringing' && activeCount(current) >= maxInCall) {
      return { error: { status: 409, message: `This call is full (${maxInCall} people).` } };
    }

    mine.status = 'joined';
    mine.joinedAt = now;
    mine.leftAt = null;
    settle(current, now);
    return true;
  });

  if (error) return res.status(error.status).json({ error: error.message });
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
      { conversation: conversation._id },
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
  scheduleRingTimeout(call._id);
  return { call };
}

module.exports = {
  startCall,
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
  _internal: { expireRinging, settle, ensureMembers, flushUpdates: () => callUpdates.flushAll() },
};
