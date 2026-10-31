// The Chats page (super admin dashboard, Phase 2): group conversations in
// context, and keeping them safe.
//
//   GET  /api/admin/chats/stats?from&to
//   GET  /api/admin/chats/conversations?filter=all|reported&q=&offset=
//   GET  /api/admin/chats/conversations/:conversationId/messages?around=<messageId>&before=<messageId>
//   POST /api/admin/chats/messages/:messageId/delete                    { reason, notifyAuthor? }
//   POST /api/admin/chats/conversations/:conversationId/slow-mode       { seconds, reason? }
//   POST /api/admin/chats/conversations/:conversationId/members/:userId/mute    { duration, reason }
//   POST /api/admin/chats/conversations/:conversationId/members/:userId/unmute  { reason? }
//   POST /api/admin/chats/conversations/:conversationId/members/:userId/remove  { reason }
//   POST /api/admin/chats/conversations/:conversationId/members/:userId/ban     { reason }
//
// Groups and the Community / faction rooms are listed; direct messages are
// private and never shown here (a reported DM message is reviewed from its
// report, with the reported message only). Member actions are for groups.
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const Message = require('../models/Message');
const Report = require('../models/Report');
const User = require('../models/User');
const stats = require('../utils/adminStats');
const content = require('../utils/adminContent');
const { isSuperAdmin } = require('../utils/superAdmin');
const { personJson } = require('./adminOverviewController');
const { reportLabel } = require('./reportController');

const PAGE = 25;
const ROOM_TYPES = ['group', 'community', 'faction'];

function answer(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  throw error;
}

function roomName(conversation) {
  if (conversation.type === 'community') return 'Community';
  if (conversation.type === 'faction') return `Faction room · ${conversation.factionKey}`;
  return conversation.group?.name || 'Group';
}

async function chatStats(req, res) {
  const { current } = stats.windows(req.query);
  const [messages, active, openReports, slowMode, totalGroups] = await Promise.all([
    Message.countDocuments(stats.chatFilter(current)),
    Message.distinct('conversation', stats.chatFilter(current)),
    Report.countDocuments({ targetType: 'message', status: { $in: Report.OPEN_STATUSES } }),
    Conversation.countDocuments({ type: 'group', 'group.archived': { $ne: true }, 'group.slowModeSeconds': { $gt: 0 } }),
    Conversation.countDocuments({ type: 'group', 'group.archived': { $ne: true } }),
  ]);
  const activeGroups = await Conversation.countDocuments({ _id: { $in: active }, type: 'group' });
  return res.json({ window: current, messages, activeGroups, totalGroups, openReports, slowMode });
}

async function listConversations(req, res) {
  const filter = { type: { $in: ROOM_TYPES }, 'group.archived': { $ne: true } };
  if (req.query.filter === 'reported') {
    filter._id = { $in: await Report.distinct('conversation', { targetType: 'message', status: { $in: Report.OPEN_STATUSES } }) };
  }
  if (req.query.q) {
    const safe = String(req.query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter['group.name'] = { $regex: safe, $options: 'i' };
  }
  const offset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
  const [rows, total] = await Promise.all([
    Conversation.find(filter).sort({ updatedAt: -1, _id: -1 }).skip(offset).limit(PAGE),
    Conversation.countDocuments(filter),
  ]);
  const { countGroupMembers } = require('./chatController');
  const { current } = stats.windows({});
  const items = await Promise.all(
    rows.map(async (conversation) => {
      const [last, weekly, reports, members] = await Promise.all([
        Message.findOne({ conversation: conversation._id, deletedForEveryone: { $ne: true } }).sort({ createdAt: -1 }).populate('sender', 'profile'),
        Message.countDocuments({ conversation: conversation._id, ...stats.chatFilter(current) }),
        Report.countDocuments({ conversation: conversation._id, status: { $in: Report.OPEN_STATUSES } }),
        conversation.type === 'group' ? countGroupMembers(conversation) : null,
      ]);
      return {
        id: String(conversation._id),
        type: conversation.type,
        name: roomName(conversation),
        kind: conversation.group?.kind || null,
        photoUrl: conversation.group?.photoUrl || null,
        members,
        slowModeSeconds: conversation.group?.slowModeSeconds || 0,
        messagesThisWeek: weekly,
        openReports: reports,
        lastMessage: last
          ? { text: content.clip(last.content || (last.kind !== 'text' ? `[${last.kind}]` : ''), 120), sender: personJson(last.sender), at: last.createdAt }
          : null,
      };
    })
  );
  return res.json({ conversations: items, total, nextOffset: offset + rows.length < total ? offset + rows.length : null });
}

async function loadRoom(conversationId) {
  if (!mongoose.isValidObjectId(conversationId)) content.fail(404, 'Conversation not found.');
  const conversation = await Conversation.findById(conversationId);
  if (!conversation || !ROOM_TYPES.includes(conversation.type)) content.fail(404, 'Conversation not found.');
  return conversation;
}

// Messages in context: around a reported message, or the latest page.
async function listMessages(req, res) {
  try {
    const conversation = await loadRoom(req.params.conversationId);
    const base = { conversation: conversation._id, kind: { $nin: ['sparks_bot'] } };
    let rows;
    if (req.query.around && mongoose.isValidObjectId(req.query.around)) {
      const anchor = await Message.findOne({ _id: req.query.around, conversation: conversation._id });
      if (!anchor) content.fail(404, 'Message not found in this conversation.');
      const [before, after] = await Promise.all([
        Message.find({ ...base, createdAt: { $lt: anchor.createdAt } }).sort({ createdAt: -1 }).limit(12),
        Message.find({ ...base, createdAt: { $gte: anchor.createdAt } }).sort({ createdAt: 1 }).limit(13),
      ]);
      rows = [...before.reverse(), ...after];
    } else {
      const older = req.query.before && mongoose.isValidObjectId(req.query.before) ? await Message.findById(req.query.before) : null;
      const page = await Message.find({ ...base, ...(older ? { createdAt: { $lt: older.createdAt } } : {}) }).sort({ createdAt: -1 }).limit(30);
      rows = page.reverse();
    }
    await Message.populate(rows, { path: 'sender', select: 'profile' });
    const reports = await Report.find({ targetType: 'message', targetId: { $in: rows.map((m) => m._id) } }).sort({ createdAt: -1 });
    const byMessage = new Map();
    reports.forEach((r) => {
      if (!byMessage.has(String(r.targetId))) byMessage.set(String(r.targetId), r);
    });
    const { groupRoleOf } = require('./chatController');
    const roles = new Map();
    if (conversation.type === 'group') {
      const ids = [...new Set(rows.map((m) => String(m.sender?._id || m.sender)).filter(Boolean))];
      await Promise.all(ids.map(async (id) => roles.set(id, await groupRoleOf(conversation, id))));
    }
    return res.json({
      conversation: {
        id: String(conversation._id),
        type: conversation.type,
        name: roomName(conversation),
        kind: conversation.group?.kind || null,
        slowModeSeconds: conversation.group?.slowModeSeconds || 0,
        owner: conversation.group?.createdBy ? String(conversation.group.createdBy) : null,
      },
      messages: rows.map((m) => {
        const report = byMessage.get(String(m._id));
        const senderId = m.sender ? String(m.sender._id || m.sender) : null;
        return {
          id: String(m._id),
          kind: m.kind,
          text: m.deletedForEveryone ? null : m.content,
          media: m.deletedForEveryone ? null : m.media?.url || null,
          deleted: Boolean(m.deletedForEveryone),
          deletedByAdmin: Boolean(m.deletedByAdmin),
          sender: personJson(m.sender),
          role: senderId ? roles.get(senderId) || null : null,
          report: report ? { id: String(report._id), number: reportLabel(report.number), reason: report.reason, status: report.status } : null,
          createdAt: m.createdAt,
          editedAt: m.editedAt,
        };
      }),
    });
  } catch (error) {
    return answer(res, error);
  }
}

async function deleteMessage(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.messageId)) content.fail(404, 'Message not found.');
    const message = await Message.findById(req.params.messageId);
    if (!message) content.fail(404, 'Message not found.');
    const event = await content.deleteMessage(message, req.admin, { reason: req.body.reason, notifyAuthor: req.body.notifyAuthor !== false });
    return res.json({ deleted: true, messageId: String(message._id), auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

async function slowMode(req, res) {
  try {
    const conversation = await content.loadGroup(req.params.conversationId);
    const event = await content.setSlowMode(conversation, req.admin, { seconds: req.body.seconds, reason: req.body.reason });
    return res.json({ slowModeSeconds: req.body.seconds, auditEvent: event ? `EV-${event.number}` : null });
  } catch (error) {
    return answer(res, error);
  }
}

async function loadMemberAction(req) {
  const conversation = await content.loadGroup(req.params.conversationId);
  if (!mongoose.isValidObjectId(req.params.userId)) content.fail(404, 'Person not found.');
  if (String(req.params.userId) === req.adminId) content.fail(400, "You can't do this to yourself.");
  const target = await User.findById(req.params.userId);
  if (!target) content.fail(404, 'Person not found.');
  if (isSuperAdmin(target)) content.fail(403, 'Super admins are managed in Roles & permissions.');
  return { conversation, target };
}

function memberAction(kind) {
  return async (req, res) => {
    try {
      const { conversation, target } = await loadMemberAction(req);
      let event;
      if (kind === 'mute') event = await content.muteInGroup(conversation, target, req.admin, { duration: req.body.duration, reason: req.body.reason });
      if (kind === 'unmute') event = await content.unmuteInGroup(conversation, target, req.admin, { reason: req.body.reason });
      if (kind === 'remove') event = await content.removeFromGroup(conversation, target, req.admin, { reason: req.body.reason });
      if (kind === 'ban') event = await content.removeFromGroup(conversation, target, req.admin, { reason: req.body.reason, ban: true });
      const row = await ConversationMember.findOne({ conversation: conversation._id, user: target._id });
      return res.json({
        member: { id: String(target._id), role: row?.role || null, mutedUntil: row?.mutedByAdminUntil || null },
        auditEvent: `EV-${event.number}`,
      });
    } catch (error) {
      return answer(res, error);
    }
  };
}

module.exports = {
  chatStats,
  listConversations,
  listMessages,
  deleteMessage,
  slowMode,
  muteMember: memberAction('mute'),
  unmuteMember: memberAction('unmute'),
  removeMember: memberAction('remove'),
  banMember: memberAction('ban'),
};
