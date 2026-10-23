const mongoose = require('mongoose');
const VoiceRoom = require('../models/VoiceRoom');
const User = require('../models/User');
const { createCallToken, getLivekitUrl } = require('../utils/livekit');
const { loadConversationForUser } = require('./chatController');
const { emitToRooms } = require('../realtime/socket');
const limits = require('../config/callLimits');
const { createCoalescer } = require('../utils/coalescer');

const STALE_AFTER_MS = VoiceRoom.STALE_AFTER_MS;
const USER_FIELDS =
  'profile.username profile.displayName profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl';

// How this scales to big voice chats (hundreds of people):
//
// - Joining, leaving, checking in and removing people who went quiet are
//   each one atomic database update. Nobody loads the whole voice chat,
//   changes it and saves it back, so 200 people joining at once don't
//   collide and retry, and a check-in never overwrites someone's join.
//   Every update that changes who is in it bumps `__v`; check-ins don't.
// - The voice chat's JSON is built once per version (`__v`) and shared by
//   every response and live update until the next change, so the 30-second
//   check-ins of a 1,000-person voice chat cost a tiny lookup each.
// - Live updates (`voice:updated`) are coalesced per voice chat: at most one
//   per interval, always the latest state (src/utils/coalescer.js).

// ==========================================================================
// HELPERS
// ==========================================================================

function idOf(value) {
  return String(value?._id || value || '');
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

// Names and avatars for the member list, kept for a minute so a busy voice
// chat doesn't look up every member again on every join.
const PREVIEW_TTL_MS = 60 * 1000;
const PREVIEW_CACHE_MAX = 20000;
const previewCache = new Map(); // userId -> { preview, at }

async function previewsFor(userIds) {
  const now = Date.now();
  const result = new Map();
  const missing = [];
  for (const id of new Set(userIds.map(String))) {
    const hit = previewCache.get(id);
    if (hit && now - hit.at < PREVIEW_TTL_MS) result.set(id, hit.preview);
    else missing.push(id);
  }
  if (missing.length) {
    const users = await User.find({ _id: { $in: missing } }).select(USER_FIELDS).lean();
    const found = new Map(users.map((user) => [String(user._id), user]));
    if (previewCache.size + missing.length > PREVIEW_CACHE_MAX) previewCache.clear();
    for (const id of missing) {
      const preview = userPreview(found.get(id) || id);
      previewCache.set(id, { preview, at: now });
      result.set(id, preview);
    }
  }
  return result;
}

// Who is in one of this voice chat's answered private calls right now
// (callController.awayIn; required here, not at the top, as callController
// requires this file too).
function awayIn(roomId) {
  return require('./callController').awayIn(roomId);
}

function toVoiceJson(room, previews, away = new Set()) {
  return {
    id: idOf(room),
    conversationId: idOf(room.conversation),
    conversationType: room.conversationType,
    factionKey: room.factionKey || null,
    active: Boolean(room.active),
    startedBy: previews.get(idOf(room.startedBy)) || userPreview(room.startedBy),
    startedAt: room.createdAt,
    endedAt: room.endedAt,
    members: room.members.map((member) => ({
      user: previews.get(idOf(member.user)) || userPreview(member.user),
      joinedAt: member.joinedAt,
      // In a private call with someone from this voice chat right now.
      away: away.has(idOf(member.user)),
    })),
    memberCount: room.members.length,
    maxMembers: limits.voiceRoomMaxMembers(),
  };
}

// The current state of a voice chat: { active, conversationId, memberIds,
// json }, built once per version and shared until it changes.
const viewCache = new Map(); // roomId -> { version, active, promise }

async function buildView(roomId) {
  const room = await VoiceRoom.findById(roomId).lean();
  if (!room) return null;
  const memberIds = room.members.map((member) => idOf(member.user));
  const [previews, away] = await Promise.all([
    previewsFor([idOf(room.startedBy), ...memberIds]),
    room.active ? awayIn(room._id) : new Set(),
  ]);
  return {
    version: room.__v,
    active: Boolean(room.active),
    conversationId: idOf(room.conversation),
    memberIds,
    json: toVoiceJson(room, previews, away),
  };
}

async function roomView(roomId) {
  const key = String(roomId);
  const head = await VoiceRoom.findById(roomId, '__v active').lean();
  if (!head) return null;
  const cached = viewCache.get(key);
  if (cached && cached.version === head.__v && cached.active === head.active) return cached.promise;

  const promise = buildView(roomId);
  viewCache.set(key, { version: head.__v, active: head.active, promise });
  promise.catch(() => viewCache.get(key)?.promise === promise && viewCache.delete(key));
  if (!head.active) setTimeout(() => viewCache.get(key)?.promise === promise && viewCache.delete(key), 60 * 1000).unref?.();
  return promise;
}

// ==========================================================================
// ATOMIC CHANGES
// ==========================================================================

// The voice chat closes when the last person leaves, and leaves a "voice
// chat ended" entry in its chat (so its Sparks notes can be reopened later).
async function closeIfEmpty(roomId, now = new Date()) {
  const closed = await VoiceRoom.updateOne(
    { _id: roomId, active: true, members: { $size: 0 } },
    { $set: { active: false, endedAt: now }, $inc: { __v: 1 } }
  );
  if (!closed.modifiedCount) return false;
  require('../utils/callMessage').recordVoiceChatMessage(roomId).catch((error) =>
    console.error('[voice] failed to record the voice chat entry:', error.message)
  );
  return true;
}

// Removes anyone whose app hasn't checked in for 90 seconds (and closes the
// voice chat if that empties it). Someone away in a private call counts as
// still here. Returns { changed, closed }.
async function pruneStale(roomId, now = new Date()) {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
  const away = [...(await awayIn(roomId))].map((id) => new mongoose.Types.ObjectId(id));
  const stale = { lastSeenAt: { $lte: cutoff }, user: { $nin: away } };
  const pruned = await VoiceRoom.updateOne(
    { _id: roomId, active: true, members: { $elemMatch: stale } },
    { $pull: { members: stale }, $inc: { __v: 1 } }
  );
  if (!pruned.modifiedCount) return { changed: false, closed: false };
  return { changed: true, closed: await closeIfEmpty(roomId, now) };
}

// "I'm still here". Doesn't bump the version: nothing anyone sees changed.
async function touchMember(roomId, userId, now = new Date()) {
  const touched = await VoiceRoom.updateOne(
    { _id: roomId, active: true, 'members.user': userId },
    { $set: { 'members.$.lastSeenAt': now } }
  );
  return touched.matchedCount > 0;
}

// Adds this person if there's room. The size check is part of the same
// update, so two people taking the last place at once can't both get in.
async function addMember(roomId, userId, now = new Date()) {
  const max = limits.voiceRoomMaxMembers();
  const added = await VoiceRoom.updateOne(
    { _id: roomId, active: true, 'members.user': { $ne: userId }, [`members.${max - 1}`]: { $exists: false } },
    { $push: { members: { user: userId, joinedAt: now, lastSeenAt: now } }, $addToSet: { everJoined: userId }, $inc: { __v: 1 } }
  );
  if (added.modifiedCount) return { joined: true };

  if (await touchMember(roomId, userId, now)) return { joined: false }; // already in it
  const room = await VoiceRoom.findById(roomId, 'active').lean();
  if (!room?.active) return { error: { status: 410, message: 'This voice chat has ended. Try again.' } };
  return { error: { status: 409, message: `This voice chat is full (${max} people).` } };
}

// Takes this person out (and closes the voice chat if they were the last).
async function removeMember(roomId, userId, now = new Date()) {
  const removed = await VoiceRoom.updateOne(
    { _id: roomId, active: true, 'members.user': userId },
    { $pull: { members: { user: userId } }, $inc: { __v: 1 } }
  );
  if (!removed.modifiedCount) return { changed: false, closed: false };
  return { changed: true, closed: await closeIfEmpty(roomId, now) };
}

// ==========================================================================
// LIVE UPDATES
// ==========================================================================

const lastMemberCount = new Map(); // roomId -> members at the last update (sets the interval)

async function sendVoiceUpdate(roomId, extraUserIds) {
  const view = await roomView(roomId);
  if (!view) return;
  if (view.active) lastMemberCount.set(roomId, view.memberIds.length);
  else lastMemberCount.delete(roomId);

  // Everyone looking at that chat, everyone in the voice chat, and anyone
  // who just left it - in one emit, so nobody gets it twice.
  const payload = { conversationId: view.conversationId, voiceRoom: view.active ? view.json : null };
  const people = new Set([...view.memberIds, ...extraUserIds]);
  emitToRooms([`conversation:${view.conversationId}`, ...[...people].map((id) => `user:${id}`)], 'voice:updated', payload);
  // Sparks: the voice chat as a Sparks call (consent, transcription, topics,
  // outline). Rides this coalesced update, so membership reaches the module
  // batched. No-op on the legacy engine. See src/sparks/voiceRooms.js.
  require('../sparks/voiceRooms').sync(roomId, view, extraUserIds);
}

const voiceUpdates = createCoalescer({
  label: 'voice',
  interval: (value) => limits.broadcastIntervalMs(lastMemberCount.get(value?.roomId) || 0),
  send: (roomId, value) => {
    sendVoiceUpdate(roomId, [...value.extras]).catch((error) =>
      console.error('[voice] live update failed:', error.message)
    );
  },
});

// Tells everyone looking at that chat (and everyone in the voice chat) who's
// in it now. `voiceRoom: null` means it has closed.
function broadcastVoiceUpdate(roomId, extraUserIds = [], { immediate = false } = {}) {
  const key = String(roomId);
  voiceUpdates.push(
    key,
    { roomId: key, extras: new Set(extraUserIds.map(String)) },
    {
      immediate,
      merge: (pending, next) => ({ roomId: key, extras: new Set([...pending.extras, ...next.extras]) }),
    }
  );
}

// Removes stale members (and closes the room if it's empty), right now.
async function refreshRoom(roomId) {
  const { changed, closed } = await pruneStale(roomId);
  if (changed) broadcastVoiceUpdate(roomId, [], { immediate: closed });
  return roomView(roomId);
}

// Voice chats are for the Community room, faction rooms and groups (members
// only - loadConversationForUser checks that).
async function loadVoiceConversation(conversationId, user) {
  const { conversation, error } = await loadConversationForUser(conversationId, user);
  if (error) return { error };
  if (!['community', 'faction', 'group'].includes(conversation.type)) {
    return {
      error: {
        status: 400,
        message: 'Voice chats are for Community, faction and group chats. Use a call in direct messages.',
      },
    };
  }
  return { conversation };
}

// A private call from this voice chat changed (answered or ended): sends the
// voice chat again with who is away now. Its two people count as having just
// checked in, so they aren't removed for the time they spent away.
async function privateCallChanged(roomId, userIds) {
  const ids = userIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const updated = await VoiceRoom.updateOne(
    { _id: roomId, active: true },
    { $set: { 'members.$[person].lastSeenAt': new Date() }, $inc: { __v: 1 } },
    { arrayFilters: [{ 'person.user': { $in: ids } }] }
  );
  if (updated.modifiedCount) broadcastVoiceUpdate(roomId);
}

async function tokenFor(room, user) {
  return createCallToken({
    userId: user._id,
    name: displayName(user),
    roomName: room.roomName,
  });
}

// Takes this person out of any other voice chat they're still in, so they
// are only ever in one at a time.
async function leaveOtherRooms(userId, keepRoomId = null) {
  const filter = { active: true, 'members.user': userId };
  if (keepRoomId) filter._id = { $ne: keepRoomId };

  const others = await VoiceRoom.find(filter, '_id').lean();
  for (const other of others) {
    const { changed, closed } = await removeMember(other._id, userId);
    if (changed) broadcastVoiceUpdate(other._id, [userId], { immediate: closed });
  }
}

async function findVoiceRoomForUser(roomId) {
  if (!mongoose.isValidObjectId(roomId)) return { status: 404, error: 'Voice chat not found.' };
  const room = await VoiceRoom.findById(roomId, '_id conversation').lean();
  if (!room) return { status: 404, error: 'Voice chat not found.' };
  return { room };
}

// ==========================================================================
// ENDPOINTS
// ==========================================================================

// GET /api/chats/:conversationId/voice - is a voice chat live in this room?
async function getVoiceRoom(req, res) {
  const { conversation, error } = await loadVoiceConversation(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });

  const live = await VoiceRoom.findOne({ conversation: conversation._id, active: true }, '_id').lean();
  if (!live) return res.json({ voiceRoom: null });

  const view = await refreshRoom(live._id);
  return res.json({ voiceRoom: view?.active ? view.json : null });
}

// POST /api/chats/:conversationId/voice/join - start the voice chat (if none
// is live) or join the one that is. Returns the LiveKit token to connect.
async function joinVoiceRoom(req, res) {
  const { conversation, error } = await loadVoiceConversation(req.params.conversationId, req.user);
  if (error) return res.status(error.status).json({ error: error.message });

  // Validate configuration before creating anything.
  getLivekitUrl();

  const userId = String(req.userId);
  const findLive = () => VoiceRoom.findOne({ conversation: conversation._id, active: true }, '_id').lean();
  let live = await findLive();

  if (live) {
    const { changed, closed } = await pruneStale(live._id);
    if (changed) broadcastVoiceUpdate(live._id, [], { immediate: closed });
    if (closed) live = await findLive();
  }

  let roomId = null;
  let started = false;
  let changed = false;

  if (!live) {
    // Nobody's talking yet - start a new voice chat.
    const now = new Date();
    const fresh = new VoiceRoom({
      conversation: conversation._id,
      conversationType: conversation.type,
      factionKey: conversation.type === 'faction' ? conversation.factionKey : null,
      startedBy: req.userId,
      members: [{ user: req.userId, joinedAt: now, lastSeenAt: now }],
      everJoined: [req.userId],
    });
    fresh.roomName = `voice_${fresh._id}`;

    try {
      await fresh.save();
      roomId = fresh._id;
      started = true;
      changed = true;
    } catch (saveError) {
      if (saveError?.code !== 11000) throw saveError;
      // Someone else started one at the same moment - join theirs instead.
      live = await findLive();
    }
  }

  if (!roomId && !live) {
    return res.status(409).json({ error: 'The voice chat changed. Please try again.' });
  }

  if (!roomId) {
    const added = await addMember(live._id, userId);
    if (added.error) return res.status(added.error.status).json({ error: added.error.message });
    roomId = live._id;
    changed = added.joined;
  }

  await leaveOtherRooms(userId, roomId);
  if (changed) broadcastVoiceUpdate(roomId);

  const view = await roomView(roomId);
  const room = await VoiceRoom.findById(roomId, 'roomName').lean();
  if (!view?.active || !room) {
    return res.status(410).json({ error: 'This voice chat has ended. Try again.' });
  }

  return res.status(started ? 201 : 200).json({
    voiceRoom: view.json,
    token: await tokenFor(room, req.user),
    livekitUrl: getLivekitUrl(),
  });
}

// POST /api/voice/:roomId/ping - "I'm still here" (every 30 seconds).
async function pingVoiceRoom(req, res) {
  const found = await findVoiceRoomForUser(req.params.roomId);
  if (found.error) return res.status(found.status).json({ error: found.error });

  const roomId = found.room._id;
  const now = new Date();

  if (!(await touchMember(roomId, String(req.userId), now))) {
    const view = await roomView(roomId);
    if (!view?.active) return res.status(410).json({ error: 'This voice chat has ended.', voiceRoom: null });
    return res.status(404).json({ error: 'You are not in this voice chat.', voiceRoom: view.json });
  }

  const view = await refreshRoom(roomId);
  return res.json({ voiceRoom: view?.active ? view.json : null });
}

// POST /api/voice/:roomId/leave
async function leaveVoiceRoom(req, res) {
  const found = await findVoiceRoomForUser(req.params.roomId);
  if (found.error) return res.status(found.status).json({ error: found.error });

  const roomId = found.room._id;
  const userId = String(req.userId);

  const removed = await removeMember(roomId, userId);
  if (removed.changed) broadcastVoiceUpdate(roomId, [userId], { immediate: removed.closed });

  const view = removed.closed ? null : await refreshRoom(roomId);
  return res.json({ voiceRoom: view?.active ? view.json : null });
}

module.exports = {
  getVoiceRoom,
  joinVoiceRoom,
  pingVoiceRoom,
  leaveVoiceRoom,
  // Sparks (src/sparks/voiceRooms.js): drop people who went quiet, close if empty.
  refreshVoiceRoom: (roomId) => refreshRoom(roomId),
  // callController: a private call from this voice chat was answered or ended.
  privateCallChanged,
  // Exported for tests.
  _internal: { pruneStale, closeIfEmpty, addMember, removeMember, flushUpdates: () => voiceUpdates.flushAll() },
};
