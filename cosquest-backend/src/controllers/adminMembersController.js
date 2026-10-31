// The Members page (super admin dashboard, Phase 3).
//
//   GET  /api/admin/members/stats?from&to
//   GET  /api/admin/members?tab=all|pending|muted|suspended&role=admin|member&group=<id>&q=&offset=
//   GET  /api/admin/members/:userId
//   POST /api/admin/members/:userId/mute       { duration: 1h|1d|1w|30d|forever, reason }
//   POST /api/admin/members/:userId/unmute     { reason? }
//   POST /api/admin/members/:userId/suspend    { duration: 1d|1w|30d|forever, reason }
//   POST /api/admin/members/:userId/unsuspend  { reason? }
//
// "Pending" = signed up but hasn't finished onboarding (CosQuest has no
// community-level approval; group join requests are on the Groups page).
const mongoose = require('mongoose');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const GroupBan = require('../models/GroupBan');
const Report = require('../models/Report');
const AuditEvent = require('../models/AuditEvent');
const notificationModel = require('../models/notificationModel');
const { recordAudit, auditJson } = require('../utils/audit');
const { isSuperAdmin } = require('../utils/superAdmin');
const restrictions = require('../utils/communityRestrictions');
const stats = require('../utils/adminStats');
const content = require('../utils/adminContent');
const { reportLabel } = require('./reportController');

const PAGE = 25;
const GROUP_ROLES = ['owner', 'admin', 'member'];

function answer(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  throw error;
}

function nameOf(user) {
  const p = user.profile || {};
  return p.displayName || [p.firstName, p.lastName].filter(Boolean).join(' ') || p.username || 'Member';
}

function statusOf(user) {
  if (restrictions.suspendedUntil(user)) return 'suspended';
  if (restrictions.mutedUntil(user)) return 'muted';
  if (!user.onboardingComplete) return 'pending';
  return 'active';
}

function memberRow(user, groupCount = 0) {
  const p = user.profile || {};
  return {
    id: String(user._id),
    username: p.username || null,
    name: nameOf(user),
    email: user.email || null,
    avatarKey: p.avatarKey || null,
    avatarPhotoUrl: p.avatarPhotoUrl || null,
    role: isSuperAdmin(user) ? 'super_admin' : 'member',
    status: statusOf(user),
    faction: user.faction || null,
    groups: groupCount,
    lastActiveAt: user.lastActiveAt || null,
    createdAt: user.createdAt,
  };
}

async function groupCounts(userIds) {
  const rows = await ConversationMember.aggregate([
    { $match: { user: { $in: userIds }, role: { $in: GROUP_ROLES } } },
    { $group: { _id: '$user', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

async function memberStats(req, res) {
  const { current, previous } = stats.windows(req.query);
  const now = new Date();
  const [total, activeNow, activeBefore, newNow, newBefore, pending, muted, suspended] = await Promise.all([
    User.countDocuments({}),
    stats.activePeople(current),
    stats.activePeople(previous),
    User.countDocuments({ onboardingComplete: true, ...stats.inWindow(current) }),
    User.countDocuments({ onboardingComplete: true, ...stats.inWindow(previous) }),
    User.countDocuments({ onboardingComplete: false }),
    User.countDocuments({ 'moderation.mutedUntil': { $gt: now } }),
    User.countDocuments({ 'moderation.suspendedUntil': { $gt: now } }),
  ]);
  return res.json({
    window: current,
    total,
    active: { value: activeNow, change: stats.change(activeNow, activeBefore) },
    newMembers: { value: newNow, change: stats.change(newNow, newBefore) },
    pending,
    muted,
    suspended,
  });
}

async function listMembers(req, res) {
  const now = new Date();
  const filter = {};
  const tab = req.query.tab || 'all';
  if (tab === 'pending') filter.onboardingComplete = false;
  if (tab === 'muted') filter['moderation.mutedUntil'] = { $gt: now };
  if (tab === 'suspended') filter['moderation.suspendedUntil'] = { $gt: now };
  if (req.query.role === 'admin') filter.platformRole = 'admin';
  if (req.query.role === 'member') filter.platformRole = { $ne: 'admin' };
  if (req.query.group && mongoose.isValidObjectId(req.query.group)) {
    filter._id = { $in: await ConversationMember.distinct('user', { conversation: req.query.group, role: { $in: GROUP_ROLES } }) };
  }
  if (req.query.q) {
    const q = String(req.query.q).trim().replace(/^@/, '');
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { 'profile.usernameNormalized': { $regex: `^${safe.toLowerCase()}` } },
      { 'profile.firstName': { $regex: safe, $options: 'i' } },
      { 'profile.lastName': { $regex: safe, $options: 'i' } },
      { 'profile.displayName': { $regex: safe, $options: 'i' } },
      { email: { $regex: `^${safe.toLowerCase()}` } },
    ];
  }
  const offset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
  const [rows, total] = await Promise.all([
    User.find(filter).select('profile email platformRole moderation onboardingComplete faction lastActiveAt createdAt').sort({ lastActiveAt: -1, _id: -1 }).skip(offset).limit(PAGE),
    User.countDocuments(filter),
  ]);
  const counts = await groupCounts(rows.map((u) => u._id));
  return res.json({
    members: rows.map((u) => memberRow(u, counts.get(String(u._id)) || 0)),
    total,
    nextOffset: offset + rows.length < total ? offset + rows.length : null,
  });
}

async function loadMember(userId) {
  if (!mongoose.isValidObjectId(userId)) content.fail(404, 'Member not found.');
  const user = await User.findById(userId);
  if (!user) content.fail(404, 'Member not found.');
  return user;
}

function rankOf(user) {
  try {
    const rank = require('../utils/ranks').rankFor(user);
    return typeof rank === 'string' ? rank : rank?.label || rank?.name || rank?.key || null;
  } catch {
    return null;
  }
}

async function memberDetail(req, res) {
  try {
    const user = await loadMember(req.params.userId);
    const id = user._id;
    const [memberships, bans, reports, history] = await Promise.all([
      ConversationMember.find({ user: id, role: { $in: GROUP_ROLES } }).sort({ joinedAt: -1 }).limit(50),
      GroupBan.find({ user: id }).limit(50),
      Report.find({ $or: [{ targetUser: id }, { targetType: 'profile', targetId: id }] }).sort({ createdAt: -1 }).limit(20),
      AuditEvent.find({ $or: [{ 'meta.authorId': String(id) }, { 'target.type': 'user', 'target.id': String(id) }] }).sort({ createdAt: -1 }).limit(20).populate('actor', 'profile'),
    ]);
    const groupIds = [...new Set([...memberships.map((m) => String(m.conversation)), ...bans.map((b) => String(b.conversation))])];
    const groups = await Conversation.find({ _id: { $in: groupIds }, type: 'group' }).select('group');
    const groupName = (gid) => groups.find((g) => String(g._id) === String(gid))?.group?.name || 'Group';
    const openReportsIn = await Report.aggregate([
      { $match: { targetUser: id, conversation: { $ne: null }, status: { $in: Report.OPEN_STATUSES } } },
      { $group: { _id: '$conversation', count: { $sum: 1 } } },
    ]);
    const reportsByGroup = new Map(openReportsIn.map((row) => [String(row._id), row.count]));
    const now = Date.now();
    const m = user.moderation || {};

    return res.json({
      member: memberRow(user, memberships.length),
      details: {
        memberSince: user.createdAt,
        onboardingComplete: user.onboardingComplete,
        faction: user.faction || null,
        rank: rankOf(user),
        bio: user.profile?.bio || '',
      },
      restrictions: {
        muted: restrictions.mutedUntil(user) ? { until: m.mutedUntil, forever: restrictions.isForever(m.mutedUntil), reason: m.mutedReason || '' } : null,
        suspended: restrictions.suspendedUntil(user) ? { until: m.suspendedUntil, forever: restrictions.isForever(m.suspendedUntil), reason: m.suspendedReason || '' } : null,
      },
      groups: memberships
        .filter((row) => groups.some((g) => String(g._id) === String(row.conversation)))
        .map((row) => ({
          id: String(row.conversation),
          name: groupName(row.conversation),
          role: row.role,
          joinedAt: row.joinedAt,
          mutedUntil: row.mutedByAdminUntil && row.mutedByAdminUntil.getTime() > now ? row.mutedByAdminUntil : null,
          openReports: reportsByGroup.get(String(row.conversation)) || 0,
        })),
      groupBans: bans.map((ban) => ({ id: String(ban.conversation), name: groupName(ban.conversation), reason: ban.reason || '', at: ban.createdAt })),
      safety: reports.map((r) => ({
        id: String(r._id),
        number: reportLabel(r.number),
        targetType: r.targetType,
        reason: r.reason,
        status: r.status,
        chat: r.snapshot?.chat?.name || null,
        conversationId: r.conversation ? String(r.conversation) : null,
        assignee: r.assignee ? String(r.assignee) : null,
        createdAt: r.createdAt,
      })),
      history: history.map(auditJson),
    });
  } catch (error) {
    return answer(res, error);
  }
}

async function loadTarget(req) {
  const user = await loadMember(req.params.userId);
  if (String(user._id) === req.adminId) content.fail(400, "You can't do this to yourself.");
  if (isSuperAdmin(user)) content.fail(403, 'Super admins are managed in Roles & permissions.');
  return user;
}

function tell(userId, message) {
  notificationModel.createForUser(userId, message, { type: 'system' }).catch(() => {});
}

function restrict(kind) {
  const field = kind === 'mute' ? 'muted' : 'suspended';
  return async (req, res) => {
    try {
      const user = await loadTarget(req);
      const reason = content.requireReason(req.body.reason);
      const { duration } = req.body;
      if (!restrictions.DURATIONS[duration] || (kind === 'suspend' && duration === '1h')) {
        content.fail(400, kind === 'mute' ? 'duration must be 1h, 1d, 1w, 30d or forever.' : 'duration must be 1d, 1w, 30d or forever.');
      }
      const until = new Date(Date.now() + restrictions.DURATIONS[duration]);
      const before = { [`${field}Until`]: user.moderation?.[`${field}Until`] || null };
      await User.updateOne(
        { _id: user._id },
        { $set: { [`moderation.${field}Until`]: until, [`moderation.${field}Reason`]: reason, [`moderation.${field}By`]: req.admin._id } }
      );
      if (kind === 'mute') tell(user._id, `A CosQuest admin paused your posting (${restrictions.LABELS[duration]}). You can still read and browse. Reason: ${reason}`);
      // Suspended: close their live connections now (requireAuth and the
      // socket handshake refuse them from here on).
      if (kind === 'suspend') require('../realtime/socket').revokeSession(String(user._id), 'account_suspended');
      const event = await recordAudit(req.admin, {
        action: kind === 'mute' ? 'member.community_mute' : 'member.suspend',
        area: 'members',
        target: { type: 'user', id: user._id, label: user.profile?.username ? `@${user.profile.username}` : nameOf(user) },
        reason,
        before,
        after: { [`${field}Until`]: until, duration },
        meta: { authorId: String(user._id), scope: 'community' },
      });
      const updated = await User.findById(user._id);
      return res.json({ member: memberRow(updated), auditEvent: `EV-${event.number}` });
    } catch (error) {
      return answer(res, error);
    }
  };
}

function lift(kind) {
  const field = kind === 'mute' ? 'muted' : 'suspended';
  return async (req, res) => {
    try {
      const user = await loadTarget(req);
      const until = user.moderation?.[`${field}Until`];
      if (!restrictions.isActive(until)) content.fail(409, kind === 'mute' ? 'This member is not muted.' : 'This account is not suspended.');
      await User.updateOne(
        { _id: user._id },
        { $set: { [`moderation.${field}Until`]: null, [`moderation.${field}Reason`]: null, [`moderation.${field}By`]: null } }
      );
      if (kind === 'mute') tell(user._id, 'A CosQuest admin lifted your posting pause. You can post again.');
      const event = await recordAudit(req.admin, {
        action: kind === 'mute' ? 'member.community_unmute' : 'member.unsuspend',
        area: 'members',
        target: { type: 'user', id: user._id, label: user.profile?.username ? `@${user.profile.username}` : nameOf(user) },
        reason: typeof req.body.reason === 'string' ? req.body.reason.trim() : '',
        before: { [`${field}Until`]: until },
        after: { [`${field}Until`]: null },
        meta: { authorId: String(user._id), scope: 'community' },
      });
      const updated = await User.findById(user._id);
      return res.json({ member: memberRow(updated), auditEvent: `EV-${event.number}` });
    } catch (error) {
      return answer(res, error);
    }
  };
}

module.exports = {
  memberStats,
  listMembers,
  memberDetail,
  mute: restrict('mute'),
  unmute: lift('mute'),
  suspend: restrict('suspend'),
  unsuspend: lift('suspend'),
};
