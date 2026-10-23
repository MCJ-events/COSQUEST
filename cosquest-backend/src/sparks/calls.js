/**
 * Hook 3: the call layer. CosQuest calls (src/models/Call.js) start in a DM
 * and can grow into group calls; callController.broadcastCallUpdate() runs on
 * every change, and calls sync() here, which mirrors the call into the
 * module's sparks_calls row:
 *   answered (status accepted)   -> onCallStarted (scribe job for the attendees' phones)
 *   who is in the call changed   -> onCallMembership
 *   finished                     -> onCallEnded (the outline starts after the grace window)
 * Transcription itself is phone-side (consent + segments on the `sparks`
 * channel); nothing here touches LiveKit. Voice chats (Community and faction
 * rooms) are mirrored the same way by voiceRooms.js; the REST routes below
 * take either id.
 */
const mongoose = require('mongoose');
const host = require('./index');
const members = require('./members');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');

const TERMINAL = ['declined', 'missed', 'cancelled', 'ended'];
const queues = new Map();

const idOf = (v) => String(v?._id || v);

async function syncNow(call) {
  const store = host.store;
  const backend = host.backend;
  const callId = idOf(call);
  const chatId = idOf(call.conversation);
  const joined = (call.members || []).filter((m) => m.status === 'joined').map((m) => idOf(m.user));
  const finished = TERMINAL.includes(call.status);
  const existing = await store.getCall(callId);

  if (!existing) {
    if (finished || call.status !== 'accepted') return;
    const row = {
      callId, chatId, startedAt: new Date(call.answeredAt || Date.now()).getTime(), endedAt: null,
      startedBy: idOf(call.caller), status: 'active', attendees: joined, everAttended: joined,
    };
    if (await store.insertCall(row)) await backend.onCallStarted(row);
    return;
  }
  if (existing.status !== 'active') return;
  if (finished) {
    await backend.onCallEnded(callId);
    return;
  }
  const same = existing.attendees.length === joined.length && joined.every((u) => existing.attendees.includes(u));
  if (!same) await backend.onCallMembership(callId, joined);
}

/** Fire-and-forget from broadcastCallUpdate. Never rejects. */
function sync(call) {
  if (!host.isModule() || !host.isReady() || !call) return Promise.resolve();
  const key = idOf(call);
  const run = (queues.get(key) || Promise.resolve()).then(() => syncNow(call));
  const tail = run.catch((error) => console.warn('[sparks] call sync failed:', error.message));
  queues.set(key, tail);
  tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return tail;
}

// GET /api/calls/:callId/outline - the post-call outline (OPEN_QUESTIONS Q9
// reference rule: people who were on the call, and the chat's admins).
async function getOutline(req, res) {
  if (!host.isModule() || !host.isReady()) return res.status(503).json({ error: 'Sparks are unavailable right now.' });
  const call = await host.store.getCall(String(req.params.callId));
  if (!call) return res.status(404).json({ error: 'No outline for this call.' });
  if (!call.everAttended.includes(String(req.userId)) && !(await members.isAdmin(String(req.userId), call.chatId))) {
    return res.status(403).json({ error: 'Only people who were on the call can read its outline.' });
  }
  const stored = (await host.store.getOutline(call.callId)) || { status: 'pending', outline: null };
  // Names for the outline's speakers and action-item owners (group calls too, not only the other person in a DM).
  const ids = stored.outline ? stored.outline.topics.flatMap((t) => [...(t.speakerIds || []), ...(t.actionItems || []).map((a) => a.ownerUserId).filter(Boolean)]) : [];
  return res.json({ ...stored, speakers: await speakerPreviews([...ids, ...call.everAttended]) });
}

const fail = (res, error) => {
  if (!error?.status) throw error;
  const message = {
    400: 'Bad cursor.',
    403: 'Only people who were on the call, and admins of the chat, can do this.',
    404: 'No outline for this call.',
    409: 'The outline is not ready yet.',
    501: 'Sparks needs an update for this.',
    502: 'The outline could not be posted. Please try again.',
  }[error.status];
  return res.status(error.status).json({ error: error.status === 404 && /unknown call/.test(error.message) ? 'Call not found.' : message || error.message, reason: error.message });
};

const unavailable = (res) => res.status(503).json({ error: 'Sparks are unavailable right now.' });

// GET /api/calls/:callId/transcript?cursor=&limit= - the full transcript of a
// call or a voice chat (its id), one page at a time: final lines in order,
// speaker, start and end (ms since the call started), the topic each fell
// under, plus the topic markers. Same rule as the outline (OPEN_QUESTIONS Q9:
// attendees and the chat's admins). `speakers` has a name and avatar for every
// userId on the page and, on the first page, everyone in `participants`
// (module 1.3.3: who was on the call and why someone has no lines, such as
// no Sparks on their phone yet).
async function getTranscript(req, res) {
  if (!host.isModule() || !host.isReady()) return unavailable(res);
  if (typeof host.backend.transcript !== 'function') return res.status(501).json({ error: 'Sparks needs an update for this.', reason: 'module without transcript()' });
  let page;
  try {
    page = await host.backend.transcript(String(req.userId), String(req.params.callId), {
      cursor: typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null,
      limit: Number(req.query.limit) || undefined,
    });
  } catch (error) {
    return fail(res, error);
  }
  const speakers = await speakerPreviews([...page.segments.map((s) => s.userId), ...(page.participants || []).map((p) => p.userId)]);
  // People outside the chat (added to a DM call) have no chat name in the module: use their profile's.
  const participants = page.participants && page.participants.map((p) => ({ ...p, displayName: p.displayName || speakers[p.userId]?.name || null }));
  return res.json({ ...page, ...(participants ? { participants } : {}), kind: (await voiceRooms().isVoiceRoom(page.callId)) ? 'voice_room' : 'call', speakers });
}

// POST /api/calls/:callId/outline/share - post the finished outline into the
// call's chat as a Sparks bot post (kind 'sparks_bot', sparksBot.kind
// 'call_outline'). Attendees who are in the chat, and the chat's admins.
// Once per call: 201 the first time, 200 with the same message after.
async function shareOutline(req, res) {
  if (!host.isModule() || !host.isReady()) return unavailable(res);
  if (typeof host.backend.shareOutline !== 'function') return res.status(501).json({ error: 'Sparks needs an update for this.', reason: 'module without shareOutline()' });
  const callId = String(req.params.callId);
  let result;
  try {
    result = await host.backend.shareOutline(String(req.userId), callId, { callKind: (await voiceRooms().isVoiceRoom(callId)) ? 'voice_room' : 'call' });
  } catch (error) {
    return fail(res, error);
  }
  return res.status(result.shared ? 201 : 200).json({ shared: result.shared, post: result.post, message: await serializedMessage(result.messageId, req.userId) });
}

const voiceRooms = () => require('./voiceRooms');

async function speakerPreviews(userIds) {
  const ids = [...new Set(userIds)].filter((id) => mongoose.isValidObjectId(id));
  if (!ids.length) return {};
  const users = await User.find({ _id: { $in: ids } }, 'profile.username profile.displayName profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl').lean();
  return Object.fromEntries(users.map((u) => [String(u._id), {
    id: String(u._id), username: u.profile?.username || null, name: members.displayNameOf(u), avatarKey: u.profile?.avatarKey || null, avatarPhotoUrl: u.profile?.avatarPhotoUrl || null,
  }]));
}

// The bot post as GET /chats/:id/messages returns it, for this viewer.
async function serializedMessage(messageId, viewerId) {
  if (!mongoose.isValidObjectId(messageId)) return null;
  const message = await Message.findById(messageId);
  if (!message) return null;
  const conversation = await Conversation.findById(message.conversation, 'type').lean();
  const { serializeMessage } = require('../controllers/chatController');
  return serializeMessage(message, { viewerId, conversationType: conversation?.type, otherLastReadAt: null, reactions: [] });
}

module.exports = { sync, getOutline, getTranscript, shareOutline };
