// The Sparks page (super admin dashboard, Phase 4): every Spark in groups,
// the Community room and faction rooms (never DMs), read-only.
//
//   GET /api/admin/sparks/stats?from&to
//   GET /api/admin/sparks?tab=all|active|quiet|dormant&group=<conversationId>&q=&offset=
//   GET /api/admin/sparks/:sparkId
//
// Reads the Sparks module's own collection (sparks_sparks) directly: the
// store only lists per chat. Rows are the module's: ms-number timestamps,
// chatId and createdBy as text (createdBy null = the Sparks bot).
//
// The dashboard's states come from the last reply, NOT the module's state
// (the module calls a Spark "dormant" after 12 minutes of silence):
//   Active = a reply in the last 24 hours, Quiet = 1-7 days, Dormant = 7+ days.
// Merged and deleted Sparks are hidden. Pin, delete and merge are not here
// (requirements pending).
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Report = require('../models/Report');
const User = require('../models/User');
const stats = require('../utils/adminStats');
const { personJson } = require('./adminOverviewController');

const PAGE = 25;
const LIVE = ['active', 'dormant'];
const DAY = 24 * 60 * 60 * 1000;
const ROOM_TYPES = ['group', 'community', 'faction'];

const sparksCollection = () => mongoose.connection.collection('sparks_sparks');

function answer(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  throw error;
}

function requireModule() {
  if (!require('../sparks').isModule()) {
    throw Object.assign(new Error('The Sparks page reads the Sparks module (SPARKS_ENGINE=module).'), { status: 503, code: 'sparks_legacy' });
  }
}

/** Active / Quiet / Dormant from the last reply (ms). */
function topicState(lastMessageAt, now = Date.now()) {
  const age = now - Number(lastMessageAt || 0);
  if (age <= DAY) return 'active';
  if (age <= 7 * DAY) return 'quiet';
  return 'dormant';
}

/** The ids (as text) of the chats whose Sparks the dashboard may show. */
async function roomIds(extra = {}) {
  const rooms = await Conversation.find({ type: { $in: ROOM_TYPES }, 'group.archived': { $ne: true }, ...extra }, '_id').lean();
  return rooms.map((room) => String(room._id));
}

function roomName(conversation) {
  if (!conversation) return 'Chat';
  if (conversation.type === 'community') return 'Community';
  if (conversation.type === 'faction') return `Faction room · ${conversation.factionKey}`;
  return conversation.group?.name || 'Group';
}

function stateFilter(tab, now = Date.now()) {
  if (tab === 'active') return { lastMessageAt: { $gte: now - DAY } };
  if (tab === 'quiet') return { lastMessageAt: { $lt: now - DAY, $gte: now - 7 * DAY } };
  if (tab === 'dormant') return { lastMessageAt: { $lt: now - 7 * DAY } };
  return {};
}

/** Replies (people's messages, not deleted) and participants, for many Sparks in one query. */
async function replyStats(sparkIds) {
  if (!sparkIds.length) return new Map();
  const rows = await Message.aggregate([
    { $match: { sparkId: { $in: sparkIds }, kind: { $ne: 'sparks_bot' }, deletedForEveryone: { $ne: true } } },
    { $group: { _id: '$sparkId', replies: { $sum: 1 }, senders: { $addToSet: '$sender' } } },
  ]);
  return new Map(rows.map((row) => [row._id, { replies: row.replies, participants: row.senders.filter(Boolean).length }]));
}

function sparkJson(row, { chat, creator, counts, now = Date.now() }) {
  return {
    id: row.sparkId || row._id,
    subject: row.subject,
    chat: chat ? { id: String(chat._id), type: chat.type, name: roomName(chat) } : { id: row.chatId, type: null, name: 'Chat' },
    creator: row.createdBy ? personJson(creator) || { id: row.createdBy, name: 'Member' } : null,
    startedByBot: !row.createdBy,
    state: topicState(row.lastMessageAt, now),
    moduleState: row.state,
    pinned: Boolean(row.pinned),
    revivals: row.revivalIndex || 0,
    replies: counts?.replies || 0,
    participants: counts?.participants || 0,
    summary: row.summaryText || '',
    createdAt: new Date(row.createdAt),
    lastMessageAt: new Date(row.lastMessageAt),
  };
}

async function enrich(rows) {
  const ids = rows.map((row) => row.sparkId || row._id);
  const chatIds = [...new Set(rows.map((row) => row.chatId))].filter((id) => mongoose.isValidObjectId(id));
  const creatorIds = [...new Set(rows.map((row) => row.createdBy).filter((id) => id && mongoose.isValidObjectId(id)))];
  const [counts, chats, creators] = await Promise.all([
    replyStats(ids),
    Conversation.find({ _id: { $in: chatIds } }).select('type factionKey group.name').lean(),
    User.find({ _id: { $in: creatorIds } }).select('profile').lean(),
  ]);
  const now = Date.now();
  return rows.map((row) =>
    sparkJson(row, {
      chat: chats.find((c) => String(c._id) === row.chatId),
      creator: creators.find((u) => String(u._id) === row.createdBy),
      counts: counts.get(row.sparkId || row._id),
      now,
    })
  );
}

async function sparkStats(req, res) {
  try {
    requireModule();
    const { current } = stats.windows(req.query);
    const rooms = await roomIds();
    const now = Date.now();
    const base = { state: { $in: LIVE }, chatId: { $in: rooms } };
    const col = sparksCollection();
    const [created, active, quiet, dormant, total] = await Promise.all([
      col.countDocuments({ chatId: { $in: rooms }, state: { $ne: 'deleted' }, createdAt: { $gte: current.from.getTime(), $lt: current.to.getTime() } }),
      col.countDocuments({ ...base, ...stateFilter('active', now) }),
      col.countDocuments({ ...base, ...stateFilter('quiet', now) }),
      col.countDocuments({ ...base, ...stateFilter('dormant', now) }),
      col.countDocuments(base),
    ]);
    return res.json({ window: current, newThisWeek: created, active, quiet, dormant, total });
  } catch (error) {
    return answer(res, error);
  }
}

async function listSparks(req, res) {
  try {
    requireModule();
    const rooms = req.query.group && mongoose.isValidObjectId(req.query.group) ? await roomIds({ _id: req.query.group }) : await roomIds();
    const filter = { state: { $in: LIVE }, chatId: { $in: rooms }, ...stateFilter(req.query.tab || 'all') };
    if (req.query.q) filter.subject = { $regex: String(req.query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const offset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
    const col = sparksCollection();
    const [rows, total] = await Promise.all([col.find(filter).sort({ lastMessageAt: -1, _id: 1 }).skip(offset).limit(PAGE).toArray(), col.countDocuments(filter)]);
    return res.json({ sparks: await enrich(rows), total, nextOffset: offset + rows.length < total ? offset + rows.length : null });
  } catch (error) {
    return answer(res, error);
  }
}

async function sparkDetail(req, res) {
  try {
    requireModule();
    const row = await sparksCollection().findOne({ _id: req.params.sparkId });
    if (!row || !LIVE.includes(row.state) || !mongoose.isValidObjectId(row.chatId)) return res.status(404).json({ error: 'Spark not found.' });
    const chat = await Conversation.findById(row.chatId).select('type factionKey group').lean();
    // DM Sparks are private: never shown.
    if (!chat || !ROOM_TYPES.includes(chat.type) || chat.group?.archived) return res.status(404).json({ error: 'Spark not found.' });

    const [[spark], messages, sessions, related] = await Promise.all([
      enrich([row]),
      Message.find({ sparkId: row.sparkId || row._id, kind: { $ne: 'sparks_bot' } }).sort({ seq: -1, _id: -1 }).limit(40).populate('sender', 'profile'),
      mongoose.connection.collection('sparks_sessions').find({ sparkId: row.sparkId || row._id }).sort({ sessionIndex: 1 }).toArray(),
      sparksCollection()
        .find({ chatId: row.chatId, state: { $in: LIVE }, _id: { $ne: row._id } })
        .sort({ lastMessageAt: -1 })
        .limit(3)
        .toArray(),
    ]);
    const openReports = await Report.countDocuments({ targetType: 'message', targetId: { $in: messages.map((m) => m._id) }, status: { $in: Report.OPEN_STATUSES } });
    return res.json({
      spark,
      openReports,
      revivals: sessions.map((s) => ({ index: s.sessionIndex, startedAt: new Date(s.startedAt), endedAt: s.endedAt ? new Date(s.endedAt) : null })),
      // Newest first in the query; oldest first here, like a conversation.
      history: messages.reverse().map((m) => ({
        id: String(m._id),
        sender: personJson(m.sender),
        text: m.deletedForEveryone ? null : m.content || (m.kind !== 'text' ? `[${m.kind}]` : ''),
        deleted: Boolean(m.deletedForEveryone),
        era: m.sparkRevivalIndex || 0,
        at: m.createdAt,
      })),
      related: await enrich(related),
    });
  } catch (error) {
    return answer(res, error);
  }
}

/** For the Overview: new Sparks in a window (module), not counting DMs. */
async function newSparksBetween(window) {
  if (!require('../sparks').isModule()) return null;
  const rooms = await roomIds();
  return sparksCollection().countDocuments({ chatId: { $in: rooms }, state: { $ne: 'deleted' }, createdAt: { $gte: window.from.getTime(), $lt: window.to.getTime() } });
}

module.exports = { sparkStats, listSparks, sparkDetail, newSparksBetween, topicState };
