// The Groups page (super admin dashboard, Phase 3): user-created groups.
//
//   GET   /api/admin/groups/stats?from&to
//   GET   /api/admin/groups?tab=all|active|attention|archived&kind=open|private|faction&q=&offset=
//   GET   /api/admin/groups/:groupId
//   PATCH /api/admin/groups/:groupId/settings   { joinMode?, whoCanAdd?, memberListVisibility?, reason? }
//   POST  /api/admin/groups/:groupId/requests/:requestId/approve  { reason? }
//   POST  /api/admin/groups/:groupId/requests/:requestId/decline  { reason? }
//   POST  /api/admin/groups/:groupId/archive    { reason }
//   POST  /api/admin/groups/:groupId/restore    { reason }
//
// Health: "reports" (open reports in it), "quiet" (no messages this week),
// else "healthy". Faction rank plays no part.
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const GroupJoinRequest = require('../models/GroupJoinRequest');
const GroupBan = require('../models/GroupBan');
const Message = require('../models/Message');
const Report = require('../models/Report');
const User = require('../models/User');
const AuditEvent = require('../models/AuditEvent');
const notificationModel = require('../models/notificationModel');
const { recordAudit, auditJson } = require('../utils/audit');
const { emitToUsers } = require('../realtime/socket');
const stats = require('../utils/adminStats');
const content = require('../utils/adminContent');
const { personJson } = require('./adminOverviewController');

const PAGE = 25;
const GROUP_ROLES = ['owner', 'admin', 'member'];

function answer(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  throw error;
}

async function weeklyMessages(ids, window) {
  const rows = await Message.aggregate([
    { $match: { conversation: { $in: ids }, ...stats.chatFilter(window) } },
    { $group: { _id: '$conversation', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

async function openReports(ids) {
  const rows = await Report.aggregate([
    { $match: { conversation: { $in: ids }, status: { $in: Report.OPEN_STATUSES } } },
    { $group: { _id: '$conversation', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

function health(reports, messages) {
  if (reports) return 'reports';
  if (!messages) return 'quiet';
  return 'healthy';
}

async function groupRow(conversation, { messages = 0, reports = 0, owner = null } = {}) {
  const { countGroupMembers } = require('./chatController');
  const g = conversation.group;
  return {
    id: String(conversation._id),
    name: g.name,
    description: g.description || '',
    kind: g.kind,
    factionKey: conversation.factionKey || null,
    scope: g.scope,
    photoUrl: g.photoUrl || null,
    archived: Boolean(g.archived),
    owner: personJson(owner),
    members: g.archived ? null : await countGroupMembers(conversation),
    messagesThisWeek: messages,
    openReports: reports,
    health: g.archived ? 'archived' : health(reports, messages),
    joinMode: g.joinMode,
    createdAt: conversation.createdAt,
  };
}

async function groupStats(req, res) {
  const { current } = stats.windows(req.query);
  const live = { type: 'group', 'group.archived': { $ne: true } };
  const [total, newGroups, activeIds, requests, approvalGroups, reported] = await Promise.all([
    Conversation.countDocuments(live),
    Conversation.countDocuments({ ...live, ...stats.inWindow(current) }),
    Message.distinct('conversation', stats.chatFilter(current)),
    GroupJoinRequest.countDocuments({ status: 'pending' }),
    GroupJoinRequest.distinct('conversation', { status: 'pending' }),
    Report.distinct('conversation', { conversation: { $ne: null }, status: { $in: Report.OPEN_STATUSES } }),
  ]);
  const [active, withReports] = await Promise.all([
    Conversation.countDocuments({ ...live, _id: { $in: activeIds } }),
    Conversation.countDocuments({ ...live, _id: { $in: reported } }),
  ]);
  return res.json({ window: current, total, active, newGroups, joinRequests: requests, approvalGroups: approvalGroups.length, withReports });
}

async function listGroups(req, res) {
  const { current } = stats.windows({});
  const tab = req.query.tab || 'all';
  const filter = { type: 'group', 'group.archived': tab === 'archived' ? true : { $ne: true } };
  if (tab === 'active') filter._id = { $in: await Message.distinct('conversation', stats.chatFilter(current)) };
  if (tab === 'attention') filter._id = { $in: await Report.distinct('conversation', { conversation: { $ne: null }, status: { $in: Report.OPEN_STATUSES } }) };
  if (req.query.kind) filter['group.kind'] = req.query.kind;
  if (req.query.q) {
    const safe = String(req.query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const owners = await User.find({ 'profile.usernameNormalized': { $regex: `^${safe.toLowerCase().replace(/^@/, '')}` } }, '_id').limit(50);
    filter.$or = [{ 'group.name': { $regex: safe, $options: 'i' } }, { 'group.createdBy': { $in: owners.map((o) => o._id) } }];
  }
  const offset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
  const [rows, total] = await Promise.all([
    Conversation.find(filter).sort({ updatedAt: -1, _id: -1 }).skip(offset).limit(PAGE),
    Conversation.countDocuments(filter),
  ]);
  const ids = rows.map((c) => c._id);
  const [messages, reports, owners] = await Promise.all([
    weeklyMessages(ids, current),
    openReports(ids),
    User.find({ _id: { $in: rows.map((c) => c.group.createdBy) } }).select('profile'),
  ]);
  const groups = await Promise.all(
    rows.map((c) =>
      groupRow(c, {
        messages: messages.get(String(c._id)) || 0,
        reports: reports.get(String(c._id)) || 0,
        owner: owners.find((o) => String(o._id) === String(c.group.createdBy)) || null,
      })
    )
  );
  return res.json({ groups, total, nextOffset: offset + rows.length < total ? offset + rows.length : null });
}

async function loadGroupAny(groupId) {
  if (!mongoose.isValidObjectId(groupId)) content.fail(404, 'Group not found.');
  const conversation = await Conversation.findById(groupId);
  if (!conversation || conversation.type !== 'group') content.fail(404, 'Group not found.');
  return conversation;
}

async function groupDetail(req, res) {
  try {
    const conversation = await loadGroupAny(req.params.groupId);
    const { current } = stats.windows({});
    const id = conversation._id;
    const [messages, reports, owner, admins, newMembers, requests, bans, history] = await Promise.all([
      weeklyMessages([id], current),
      openReports([id]),
      User.findById(conversation.group.createdBy).select('profile'),
      ConversationMember.find({ conversation: id, role: { $in: ['owner', 'admin'] } }).populate('user', 'profile').limit(20),
      ConversationMember.countDocuments({ conversation: id, role: { $in: GROUP_ROLES }, joinedAt: { $gte: current.from } }),
      GroupJoinRequest.find({ conversation: id, status: 'pending' }).sort({ createdAt: 1 }).limit(50).populate('user', 'profile'),
      GroupBan.countDocuments({ conversation: id }),
      AuditEvent.find({ $or: [{ 'target.type': 'group', 'target.id': String(id) }, { 'meta.conversationId': String(id) }] }).sort({ createdAt: -1 }).limit(15).populate('actor', 'profile'),
    ]);
    const row = await groupRow(conversation, { messages: messages.get(String(id)) || 0, reports: reports.get(String(id)) || 0, owner });
    return res.json({
      group: {
        ...row,
        newMembersThisWeek: newMembers,
        settings: {
          joinMode: conversation.group.joinMode,
          whoCanAdd: conversation.group.whoCanAdd,
          memberListVisibility: conversation.group.memberListVisibility,
          slowModeSeconds: conversation.group.slowModeSeconds || 0,
          sizeLimit: conversation.group.sizeLimit,
        },
        bans,
      },
      admins: admins.filter((a) => a.user).map((a) => ({ ...personJson(a.user), role: a.role })),
      requests: requests
        .filter((r) => r.user)
        .map((r) => ({ id: String(r._id), user: personJson(r.user), message: r.message || '', via: r.via, createdAt: r.createdAt })),
      history: history.map(auditJson),
    });
  } catch (error) {
    return answer(res, error);
  }
}

async function broadcast(conversation, extra = []) {
  const { explicitGroupMemberIds } = require('./chatController');
  const ids = [...new Set([...(await explicitGroupMemberIds(conversation)).map(String), ...extra.map(String)])];
  if (ids.length) {
    emitToUsers(ids, 'group:updated', { conversationId: String(conversation._id) });
    emitToUsers(ids, 'chat:preview', { conversationId: String(conversation._id) });
  }
}

async function updateSettings(req, res) {
  try {
    const conversation = await loadGroupAny(req.params.groupId);
    if (conversation.group.archived) content.fail(409, 'Restore the group before changing it.');
    const changes = {};
    const before = {};
    for (const key of ['joinMode', 'whoCanAdd', 'memberListVisibility']) {
      if (req.body[key] !== undefined && req.body[key] !== conversation.group[key]) {
        before[key] = conversation.group[key];
        changes[key] = req.body[key];
      }
    }
    if (!Object.keys(changes).length) return res.json({ settings: conversation.group, auditEvent: null });
    await Conversation.updateOne({ _id: conversation._id }, { $set: Object.fromEntries(Object.entries(changes).map(([k, v]) => [`group.${k}`, v])) });
    await broadcast(conversation);
    const event = await recordAudit(req.admin, {
      action: 'group.update',
      area: 'groups',
      target: { type: 'group', id: conversation._id, label: conversation.group.name },
      reason: typeof req.body.reason === 'string' ? req.body.reason.trim() : '',
      before,
      after: changes,
    });
    const updated = await Conversation.findById(conversation._id);
    return res.json({
      settings: { joinMode: updated.group.joinMode, whoCanAdd: updated.group.whoCanAdd, memberListVisibility: updated.group.memberListVisibility },
      auditEvent: `EV-${event.number}`,
    });
  } catch (error) {
    return answer(res, error);
  }
}

async function decideRequest(req, res) {
  try {
    const approve = req.params.decision === 'approve';
    const conversation = await loadGroupAny(req.params.groupId);
    if (conversation.group.archived) content.fail(409, 'This group is archived.');
    if (!mongoose.isValidObjectId(req.params.requestId)) content.fail(404, 'Request not found.');
    const request = await GroupJoinRequest.findOne({ _id: req.params.requestId, conversation: conversation._id, status: 'pending' }).populate('user', 'profile faction');
    if (!request) content.fail(404, 'This request was already answered.');
    if (!request.user) content.fail(404, 'That person no longer exists.');

    if (approve) {
      const { countGroupMembers } = require('./chatController');
      if (await GroupBan.exists({ conversation: conversation._id, user: request.user._id })) content.fail(409, 'This person is banned from the group. Lift the ban first.');
      if (conversation.group.kind === 'faction' && request.user.faction !== conversation.factionKey) content.fail(409, 'This group is for another faction.');
      if (conversation.group.kind !== 'faction' && (await countGroupMembers(conversation)) >= conversation.group.sizeLimit) content.fail(409, 'This group is full.');
      await ConversationMember.updateOne(
        { conversation: conversation._id, user: request.user._id },
        { $set: { role: 'member', joinedAt: new Date(), addedBy: req.admin._id }, $setOnInsert: { lastReadAt: new Date(0) } },
        { upsert: true }
      );
      notificationModel
        .createForUser(request.user._id, `You're in! You joined ${conversation.group.name}`, { type: 'group', conversation: conversation._id })
        .catch(() => {});
      emitToUsers([String(request.user._id)], 'chat:preview', { conversationId: String(conversation._id) });
    }
    request.status = approve ? 'approved' : 'declined';
    request.decidedBy = req.admin._id;
    request.decidedAt = new Date();
    await request.save();
    await broadcast(conversation);
    const event = await recordAudit(req.admin, {
      action: approve ? 'join.approve' : 'join.decline',
      area: 'groups',
      target: { type: 'group', id: conversation._id, label: `${conversation.group.name} · @${request.user.profile?.username || 'member'}` },
      reason: typeof req.body?.reason === 'string' ? req.body.reason.trim() : '',
      meta: { conversationId: String(conversation._id), authorId: String(request.user._id) },
    });
    return res.json({ request: { id: String(request._id), status: request.status }, auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

function setArchived(archived) {
  return async (req, res) => {
    try {
      const conversation = await loadGroupAny(req.params.groupId);
      const reason = content.requireReason(req.body.reason);
      if (Boolean(conversation.group.archived) === archived) content.fail(409, archived ? 'This group is already archived.' : 'This group is not archived.');
      // Members are told first (the list of members is still readable).
      const { explicitGroupMemberIds } = require('./chatController');
      const memberIds = (await explicitGroupMemberIds(conversation)).map(String);
      await Conversation.updateOne({ _id: conversation._id }, { $set: { 'group.archived': archived } });
      if (archived && memberIds.length) emitToUsers(memberIds, 'group:removed', { conversationId: String(conversation._id), reason: 'archived' });
      if (!archived && memberIds.length) emitToUsers(memberIds, 'chat:preview', { conversationId: String(conversation._id) });
      const event = await recordAudit(req.admin, {
        action: archived ? 'group.archive' : 'group.restore',
        area: 'groups',
        target: { type: 'group', id: conversation._id, label: conversation.group.name },
        reason,
        before: { archived: !archived },
        after: { archived },
        meta: { members: memberIds.length },
      });
      return res.json({ archived, auditEvent: `EV-${event.number}` });
    } catch (error) {
      return answer(res, error);
    }
  };
}

module.exports = {
  groupStats,
  listGroups,
  groupDetail,
  updateSettings,
  decideRequest,
  archive: setArchived(true),
  restore: setArchived(false),
};
