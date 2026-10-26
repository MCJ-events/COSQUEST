const mongoose = require('mongoose');
const VoiceRoom = require('../models/VoiceRoom');
const User = require('../models/User');
const { createCallToken, getLivekitUrl } = require('../utils/livekit');
const { sourcesFor, setSources, muteMicrophone, removeFromRoom, closeRoom } = require('../utils/callRoom');
const { loadConversationForUser } = require('./chatController');
const { roleIn, isAdminRole, canActOn } = require('../utils/roomRoles');
const { emitToRooms, emitToUser } = require('../realtime/socket');
const { transcriptionFor } = require('../sparks/calls');
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

// On a stage, who may talk: the speakers. Off a stage, everyone.
function isSpeaker(room, userId) {
  return !room.stage || (room.speakers || []).some((id) => idOf(id) === String(userId));
}

function activeAlertOf(holder) {
  const a = holder?.activeAlert;
  if (!a?.user || new Date(a.expiresAt) <= new Date()) return null;
  return { alertId: idOf(a.alert), userId: idOf(a.user), at: a.at, expiresAt: a.expiresAt };
}

function toVoiceJson(room, previews, away = new Set()) {
  const muted = new Set((room.mutedUsers || []).map(idOf));
  const hands = new Set((room.raisedHands || []).map(idOf));
  return {
    id: idOf(room),
    conversationId: idOf(room.conversation),
    conversationType: room.conversationType,
    factionKey: room.factionKey || null,
    active: Boolean(room.active),
    startedBy: previews.get(idOf(room.startedBy)) || userPreview(room.startedBy),
    startedAt: room.createdAt,
    endedAt: room.endedAt,
    endedBy: room.endedBy ? idOf(room.endedBy) : null,
    members: room.members.map((member) => ({
      user: previews.get(idOf(member.user)) || userPreview(member.user),
      joinedAt: member.joinedAt,
      // In a private call with someone from this voice chat right now.
      away: away.has(idOf(member.user)),
      // An admin muted them: they can't turn their microphone on.
      mutedByAdmin: muted.has(idOf(member.user)),
      // speaker (may talk) or listener (stage on, only hears).
      role: isSpeaker(room, idOf(member.user)) ? 'speaker' : 'listener',
      handRaised: Boolean(room.stage) && hands.has(idOf(member.user)),
    })),
    memberCount: room.members.length,
    // Stage (town hall): only speakers talk. speakerCount = how many may talk.
    stage: Boolean(room.stage),
    speakerCount: room.members.filter((member) => isSpeaker(room, idOf(member.user))).length,
    // A "faction in danger" alert sent from here: the flare on that circle.
    alert: activeAlertOf(room),
    maxMembers: limits.voiceRoomMaxMembers(),
    // Who is sharing their screen right now (one person at a time).
    screenShare: room.screenShare?.user ? { userId: idOf(room.screenShare.user), startedAt: room.screenShare.startedAt } : null,
  };
}

// What this person may publish in this voice chat right now.
function sourcesIn(room, userId) {
  return sourcesFor({
    listener: !isSpeaker(room, userId),
    microphone: !(room.mutedUsers || []).some((id) => idOf(id) === String(userId)),
    screenShare: idOf(room.screenShare?.user) === String(userId),
  });
}

// What the person joining needs to know before they connect: whether the
// Sparks notice applies (transcription), the camera starts off (voice chats
// are audio first), and what they may do.
async function viewerExtras(room, conversation, user) {
  const role = await roleIn(conversation, user);
  return {
    canModerate: isAdminRole(role),
    canEnd: isAdminRole(role) || idOf(room.startedBy) === String(user._id),
    // Switch the stage on/off and promote/demote speakers: same people as canEnd.
    canManageStage: isAdminRole(role) || idOf(room.startedBy) === String(user._id),
    media: { cameraStartsOn: false },
    transcription: await transcriptionFor(idOf(room), user._id),
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
    { $set: { active: false, endedAt: now, screenShare: null }, $inc: { __v: 1 } }
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
  await stopShareIfGone(roomId);
  return { changed: true, closed: await closeIfEmpty(roomId, now) };
}

// A screen share ends when the person sharing is no longer in the voice chat.
async function stopShareIfGone(roomId) {
  const room = await VoiceRoom.findById(roomId, 'screenShare members.user').lean();
  const sharer = room?.screenShare?.user;
  if (!sharer || room.members.some((member) => idOf(member.user) === idOf(sharer))) return;
  await VoiceRoom.updateOne({ _id: roomId, 'screenShare.user': sharer }, { $set: { screenShare: null }, $inc: { __v: 1 } });
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
    { _id: roomId, active: true, 'members.user': { $ne: userId }, removedUsers: { $ne: userId }, [`members.${max - 1}`]: { $exists: false } },
    { $push: { members: { user: userId, joinedAt: now, lastSeenAt: now } }, $addToSet: { everJoined: userId }, $inc: { __v: 1 } }
  );
  if (added.modifiedCount) return { joined: true };

  if (await touchMember(roomId, userId, now)) return { joined: false }; // already in it
  const room = await VoiceRoom.findById(roomId, 'active removedUsers').lean();
  if (!room?.active) return { error: { status: 410, message: 'This voice chat has ended. Try again.' } };
  if ((room.removedUsers || []).some((id) => idOf(id) === String(userId))) {
    return { error: { status: 403, reason: 'removed', message: 'An admin removed you from this voice chat. You can join the next one.' } };
  }
  return { error: { status: 409, message: `This voice chat is full (${max} people).` } };
}

// Takes this person out (and closes the voice chat if they were the last).
async function removeMember(roomId, userId, now = new Date()) {
  const removed = await VoiceRoom.updateOne(
    { _id: roomId, active: true, 'members.user': userId },
    { $pull: { members: { user: userId } }, $inc: { __v: 1 } }
  );
  if (!removed.modifiedCount) return { changed: false, closed: false };
  await stopShareIfGone(roomId);
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

// `room` needs roomName, mutedUsers and screenShare.
async function tokenFor(room, user) {
  return createCallToken({
    userId: user._id,
    name: displayName(user),
    roomName: room.roomName,
    sources: sourcesIn(room, user._id),
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
  if (!view?.active) return res.json({ voiceRoom: null });
  const room = await VoiceRoom.findById(live._id, 'startedBy').lean();
  return res.json({ voiceRoom: view.json, ...(await viewerExtras(room, conversation, req.user)) });
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
    if (added.error) return res.status(added.error.status).json({ error: added.error.message, ...(added.error.reason ? { reason: added.error.reason } : {}) });
    roomId = live._id;
    changed = added.joined;
  }

  await leaveOtherRooms(userId, roomId);
  if (changed) broadcastVoiceUpdate(roomId);

  const view = await roomView(roomId);
  const room = await VoiceRoom.findById(roomId, 'roomName startedBy mutedUsers screenShare stage speakers').lean();
  if (!view?.active || !room) {
    return res.status(410).json({ error: 'This voice chat has ended. Try again.' });
  }

  return res.status(started ? 201 : 200).json({
    voiceRoom: view.json,
    token: await tokenFor(room, req.user),
    livekitUrl: getLivekitUrl(),
    ...(await viewerExtras(room, conversation, req.user)),
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

// ==========================================================================
// ENDING, SCREEN SHARING AND MODERATION
// ==========================================================================

// The voice chat (live) and its chat, for someone acting on it. They must be
// able to see the chat. Returns { room, conversation, role } or { error }.
async function loadForAction(req, select = '') {
  const found = await findVoiceRoomForUser(req.params.roomId);
  if (found.error) return { error: { status: found.status, message: found.error } };
  const room = await VoiceRoom.findById(found.room._id, `conversation startedBy roomName active members.user mutedUsers removedUsers screenShare stage speakers raisedHands ${select}`).lean();
  const { conversation, error } = await loadConversationForUser(String(room.conversation), req.user);
  if (error) return { error };
  if (!room.active) return { error: { status: 410, message: 'This voice chat has ended.' } };
  const role = await roleIn(conversation, req.user);
  return { room, conversation, role };
}

const send = (res, error) => res.status(error.status).json({ error: error.message, ...(error.reason ? { reason: error.reason } : {}) });

// POST /api/voice/:roomId/end - end the voice chat for everyone. Whoever
// started it, or an admin. (Otherwise it ends when the
// last person leaves or goes quiet.)
async function endVoiceRoom(req, res) {
  const loaded = await loadForAction(req);
  if (loaded.error) return send(res, loaded.error);
  const { room, role } = loaded;
  if (idOf(room.startedBy) !== String(req.userId) && !isAdminRole(role)) {
    return send(res, { status: 403, message: 'Only the person who started this voice chat or an admin can end it.' });
  }
  const memberIds = room.members.map((member) => idOf(member.user));
  const ended = await VoiceRoom.updateOne(
    { _id: room._id, active: true },
    { $set: { active: false, endedAt: new Date(), endedBy: req.userId, members: [], screenShare: null }, $inc: { __v: 1 } }
  );
  if (ended.modifiedCount) {
    require('../utils/callMessage').recordVoiceChatMessage(room._id).catch((error) =>
      console.error('[voice] failed to record the voice chat entry:', error.message)
    );
    broadcastVoiceUpdate(room._id, memberIds, { immediate: true });
    emitToRooms(memberIds.map((id) => `user:${id}`), 'voice:ended', { roomId: idOf(room), conversationId: idOf(room.conversation), endedBy: String(req.userId) });
    closeRoom(room.roomName);
  }
  return res.json({ voiceRoom: null, ended: true });
}

// POST /api/voice/:roomId/screen-share/start - share your screen. One person
// at a time: 409 while someone else is sharing. Then publish the screen track
// (LiveKit only allows it to the person sharing).
async function startScreenShare(req, res) {
  const loaded = await loadForAction(req);
  if (loaded.error) return send(res, loaded.error);
  const { room } = loaded;
  const userId = String(req.userId);
  if (!room.members.some((member) => idOf(member.user) === userId)) return send(res, { status: 403, message: 'Join the voice chat first.' });
  if (!isSpeaker(room, userId)) return send(res, { status: 403, message: 'Only speakers can share their screen.' });
  // Already sharing: nothing changes (safe to retry).
  const taken = idOf(room.screenShare?.user) === userId
    ? room
    : await VoiceRoom.findOneAndUpdate(
      { _id: room._id, active: true, screenShare: null },
      { $set: { screenShare: { user: req.userId, startedAt: new Date() } }, $inc: { __v: 1 } },
      { new: true, projection: 'screenShare mutedUsers roomName stage speakers' }
    ).lean();
  if (!taken) {
    const current = await VoiceRoom.findById(room._id, 'screenShare').lean();
    const sharer = await User.findById(current?.screenShare?.user).select(USER_FIELDS).lean();
    return res.status(409).json({ error: `${displayName(sharer)} is already sharing their screen.`, reason: 'someone_sharing', screenShare: current?.screenShare ? { userId: idOf(current.screenShare.user), startedAt: current.screenShare.startedAt } : null });
  }
  await setSources(taken.roomName, userId, sourcesIn(taken, userId));
  broadcastVoiceUpdate(room._id, [], { immediate: true });
  return res.json({ screenShare: { userId, startedAt: taken.screenShare.startedAt } });
}

// POST /api/voice/:roomId/screen-share/stop - stop sharing (the sharer), or
// stop someone else's share (an admin).
async function stopScreenShare(req, res) {
  const loaded = await loadForAction(req);
  if (loaded.error) return send(res, loaded.error);
  const { room, conversation, role } = loaded;
  const sharer = idOf(room.screenShare?.user);
  if (!sharer) return res.json({ screenShare: null });
  if (sharer !== String(req.userId)) {
    const sharerRole = await roleIn(conversation, sharer);
    if (!canActOn(role, sharerRole)) return send(res, { status: 403, message: 'Only the person sharing or an admin can stop this screen share.' });
  }
  const stopped = await VoiceRoom.findOneAndUpdate(
    { _id: room._id, 'screenShare.user': room.screenShare.user },
    { $set: { screenShare: null }, $inc: { __v: 1 } },
    { new: true, projection: 'screenShare mutedUsers roomName stage speakers' }
  ).lean();
  if (stopped) {
    await setSources(stopped.roomName, sharer, sourcesIn(stopped, sharer));
    broadcastVoiceUpdate(room._id, [], { immediate: true });
  }
  return res.json({ screenShare: null });
}

// Moderation by admins (src/utils/roomRoles.js): a group's owner/admins, by
// the group's own rule (admins act on members, only the owner acts on
// admins, nobody on the owner), or a Community/faction room's admins
// (scripts/setRoomAdmin.js). Rank alone never gives these powers.
async function loadModeration(req) {
  const loaded = await loadForAction(req);
  if (loaded.error) return loaded;
  const targetId = req.params.userId;
  if (!mongoose.isValidObjectId(targetId)) return { error: { status: 400, message: 'Invalid user ID.' } };
  if (targetId === String(req.userId)) return { error: { status: 400, message: 'You cannot do this to yourself.' } };
  const { conversation, role } = loaded;
  const targetRole = await roleIn(conversation, targetId);
  if (!canActOn(role, targetRole)) {
    return { error: { status: 403, message: isAdminRole(role) ? 'Only the owner can do this to an admin.' : 'Only admins can mute or remove people.' } };
  }
  return { ...loaded, targetId };
}

// POST /api/voice/:roomId/members/:userId/mute - their microphone is muted
// and stays off (they can't unmute) until an admin unmutes them.
async function muteMember(req, res) {
  const loaded = await loadModeration(req);
  if (loaded.error) return send(res, loaded.error);
  const { room, targetId } = loaded;
  if (!room.members.some((member) => idOf(member.user) === targetId)) return send(res, { status: 404, message: 'That person is not in this voice chat.' });
  const updated = await VoiceRoom.findOneAndUpdate(
    { _id: room._id, active: true },
    { $addToSet: { mutedUsers: targetId }, $inc: { __v: 1 } },
    { new: true, projection: 'mutedUsers screenShare roomName stage speakers' }
  ).lean();
  await muteMicrophone(updated.roomName, targetId);
  await setSources(updated.roomName, targetId, sourcesIn(updated, targetId));
  broadcastVoiceUpdate(room._id, [], { immediate: true });
  emitToUser(targetId, 'voice:moderated', { roomId: idOf(room), conversationId: idOf(room.conversation), action: 'muted', by: String(req.userId) });
  return res.json({ voiceRoom: (await roomView(room._id))?.json || null });
}

// POST /api/voice/:roomId/members/:userId/unmute - they may use their
// microphone again (they turn it on themselves).
async function unmuteMember(req, res) {
  const loaded = await loadModeration(req);
  if (loaded.error) return send(res, loaded.error);
  const { room, targetId } = loaded;
  const updated = await VoiceRoom.findOneAndUpdate(
    { _id: room._id, active: true },
    { $pull: { mutedUsers: targetId }, $inc: { __v: 1 } },
    { new: true, projection: 'mutedUsers screenShare roomName stage speakers' }
  ).lean();
  await setSources(updated.roomName, targetId, sourcesIn(updated, targetId));
  broadcastVoiceUpdate(room._id, [], { immediate: true });
  emitToUser(targetId, 'voice:moderated', { roomId: idOf(room), conversationId: idOf(room.conversation), action: 'unmuted', by: String(req.userId) });
  return res.json({ voiceRoom: (await roomView(room._id))?.json || null });
}

// POST /api/voice/:roomId/members/:userId/remove - takes them out and keeps
// them out of this voice chat (joining again answers 403, reason "removed").
async function removeMemberByAdmin(req, res) {
  const loaded = await loadModeration(req);
  if (loaded.error) return send(res, loaded.error);
  const { room, targetId } = loaded;
  await VoiceRoom.updateOne({ _id: room._id, active: true }, { $addToSet: { removedUsers: targetId }, $inc: { __v: 1 } });
  const removed = await removeMember(room._id, targetId);
  await removeFromRoom(room.roomName, targetId);
  broadcastVoiceUpdate(room._id, [targetId], { immediate: true });
  emitToUser(targetId, 'voice:removed', { roomId: idOf(room), conversationId: idOf(room.conversation), by: String(req.userId) });
  return res.json({ voiceRoom: removed.closed ? null : (await roomView(room._id))?.json || null });
}

// POST /api/voice/:roomId/members/:userId/allow - let a removed person join
// this voice chat again.
async function allowMember(req, res) {
  const loaded = await loadModeration(req);
  if (loaded.error) return send(res, loaded.error);
  await VoiceRoom.updateOne({ _id: loaded.room._id, active: true }, { $pull: { removedUsers: loaded.targetId }, $inc: { __v: 1 } });
  return res.json({ allowed: true });
}

// ==========================================================================
// STAGE (town hall: speakers and listeners)
// ==========================================================================

// Whoever started the voice chat, or an admin, runs the stage.
function managesStage(loaded, userId) {
  return isAdminRole(loaded.role) || idOf(loaded.room.startedBy) === String(userId);
}

// LiveKit: what each of these people may publish now (in small batches - a
// stage switch can touch hundreds of people).
async function applySources(room, userIds) {
  for (let i = 0; i < userIds.length; i += 20) {
    await Promise.all(userIds.slice(i, i + 20).map((id) => setSources(room.roomName, id, sourcesIn(room, id))));
  }
}

// POST /api/voice/:roomId/stage { on: true|false } - turn the stage on (only
// speakers talk; the person turning it on and the starter are speakers,
// everyone else - and everyone joining later - listens) or off (everyone talks).
async function setStage(req, res) {
  const loaded = await loadForAction(req);
  if (loaded.error) return send(res, loaded.error);
  if (!managesStage(loaded, req.userId)) return send(res, { status: 403, message: 'Only the person who started this voice chat or an admin can run the stage.' });
  if (typeof req.body?.on !== 'boolean') return send(res, { status: 400, message: 'on must be true or false.' });
  const { room } = loaded;
  const update = req.body.on
    ? { $set: { stage: true }, $addToSet: { speakers: { $each: [req.userId, room.startedBy] } }, $inc: { __v: 1 } }
    : { $set: { stage: false, raisedHands: [] }, $inc: { __v: 1 } };
  const updated = await VoiceRoom.findOneAndUpdate({ _id: room._id, active: true }, update, { new: true, projection: 'members.user mutedUsers screenShare stage speakers roomName' }).lean();
  if (!updated) return send(res, { status: 410, message: 'This voice chat has ended.' });
  // A listener can't be sharing their screen.
  if (updated.stage && updated.screenShare?.user && !isSpeaker(updated, idOf(updated.screenShare.user))) {
    await VoiceRoom.updateOne({ _id: room._id }, { $set: { screenShare: null }, $inc: { __v: 1 } });
    updated.screenShare = null;
  }
  await applySources(updated, updated.members.map((member) => idOf(member.user)));
  broadcastVoiceUpdate(room._id, [], { immediate: true });
  return res.json({ voiceRoom: (await roomView(room._id))?.json || null });
}

// POST /api/voice/:roomId/members/:userId/role { role: 'speaker'|'listener' }
// - promote a listener to speaker (their raised hand comes down) or move a
// speaker back to the audience. The stage must be on.
async function setMemberRole(req, res) {
  const loaded = await loadForAction(req);
  if (loaded.error) return send(res, loaded.error);
  if (!managesStage(loaded, req.userId)) return send(res, { status: 403, message: 'Only the person who started this voice chat or an admin can choose speakers.' });
  const { room, conversation, role } = loaded;
  const targetId = req.params.userId;
  const newRole = req.body?.role;
  if (!mongoose.isValidObjectId(targetId)) return send(res, { status: 400, message: 'Invalid user ID.' });
  if (!['speaker', 'listener'].includes(newRole)) return send(res, { status: 400, message: 'role must be speaker or listener.' });
  if (!room.stage) return send(res, { status: 409, message: 'Turn the stage on first: everyone can talk right now.' });
  if (!room.members.some((member) => idOf(member.user) === targetId)) return send(res, { status: 404, message: 'That person is not in this voice chat.' });
  if (newRole === 'listener' && targetId !== String(req.userId) && isAdminRole(await roleIn(conversation, targetId)) && !canActOn(role, await roleIn(conversation, targetId))) {
    return send(res, { status: 403, message: 'Only the owner can move an admin to the audience.' });
  }
  const update = newRole === 'speaker'
    ? { $addToSet: { speakers: targetId }, $pull: { raisedHands: targetId }, $inc: { __v: 1 } }
    : { $pull: { speakers: targetId }, $inc: { __v: 1 } };
  let updated = await VoiceRoom.findOneAndUpdate({ _id: room._id, active: true }, update, { new: true, projection: 'mutedUsers screenShare stage speakers roomName' }).lean();
  if (newRole === 'listener' && idOf(updated.screenShare?.user) === targetId) {
    updated = await VoiceRoom.findOneAndUpdate({ _id: room._id }, { $set: { screenShare: null }, $inc: { __v: 1 } }, { new: true, projection: 'mutedUsers screenShare stage speakers roomName' }).lean();
  }
  await setSources(updated.roomName, targetId, sourcesIn(updated, targetId));
  broadcastVoiceUpdate(room._id, [], { immediate: true });
  emitToUser(targetId, 'voice:role', { roomId: idOf(room), conversationId: idOf(room.conversation), role: newRole, by: String(req.userId) });
  return res.json({ voiceRoom: (await roomView(room._id))?.json || null });
}

// POST /api/voice/:roomId/hand { raised: true|false } - a listener asks to
// speak (or changes their mind). The stage's managers see members[].handRaised.
async function raiseHand(req, res) {
  const loaded = await loadForAction(req);
  if (loaded.error) return send(res, loaded.error);
  const { room } = loaded;
  const userId = String(req.userId);
  if (typeof req.body?.raised !== 'boolean') return send(res, { status: 400, message: 'raised must be true or false.' });
  if (!room.members.some((member) => idOf(member.user) === userId)) return send(res, { status: 403, message: 'Join the voice chat first.' });
  if (!room.stage || isSpeaker(room, userId)) return send(res, { status: 409, message: 'You can already speak.' });
  await VoiceRoom.updateOne({ _id: room._id, active: true }, { [req.body.raised ? '$addToSet' : '$pull']: { raisedHands: req.userId }, $inc: { __v: 1 } });
  broadcastVoiceUpdate(room._id);
  return res.json({ handRaised: req.body.raised });
}

// ==========================================================================
// LIVEKIT WEBHOOKS (src/controllers/livekitWebhookController.js)
// ==========================================================================

// How long someone who dropped out of LiveKit has to come back (a network
// switch, a restart of either server) before they are taken out.
const RECONNECT_GRACE_MS = 20 * 1000;

// They left the LiveKit room: unless they reconnect (participantJoined) or
// their app checks in within the grace period, they are removed - so the
// count is right within seconds, not after the 90-second check-in window.
async function participantLeft(roomId, userId, now = new Date()) {
  const graceEndsStale = new Date(now.getTime() - STALE_AFTER_MS + RECONNECT_GRACE_MS);
  const touched = await VoiceRoom.updateOne(
    { _id: roomId, active: true, members: { $elemMatch: { user: userId, lastSeenAt: { $gt: graceEndsStale } } } },
    { $set: { 'members.$.lastSeenAt': graceEndsStale } }
  );
  if (!touched.matchedCount) return;
  setTimeout(() => refreshRoom(roomId).catch((error) => console.error('[voice] refresh after leave failed:', error.message)), RECONNECT_GRACE_MS + 1000).unref?.();
}

async function participantJoined(roomId, userId) {
  await touchMember(roomId, userId);
}

module.exports = {
  getVoiceRoom,
  joinVoiceRoom,
  pingVoiceRoom,
  leaveVoiceRoom,
  endVoiceRoom,
  startScreenShare,
  stopScreenShare,
  muteMember,
  unmuteMember,
  removeMemberByAdmin,
  allowMember,
  setStage,
  setMemberRole,
  raiseHand,
  // For alerts and tests.
  isSpeaker,
  activeAlertOf,
  broadcastVoiceUpdate,
  // LiveKit webhooks.
  participantLeft,
  participantJoined,
  // Sparks (src/sparks/voiceRooms.js): drop people who went quiet, close if empty.
  refreshVoiceRoom: (roomId) => refreshRoom(roomId),
  // callController: a private call from this voice chat was answered or ended.
  privateCallChanged,
  // Exported for tests.
  _internal: { pruneStale, closeIfEmpty, addMember, removeMember, flushUpdates: () => voiceUpdates.flushAll() },
};
