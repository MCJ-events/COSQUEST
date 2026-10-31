// Super admin dashboard, Phase 6 ("finishing touches"):
//
//   Exports (CSV, up to 5,000 rows, formula-safe cells; each export is recorded)
//     GET  /api/admin/overview/export?from&to
//     GET  /api/admin/reports/export?<Moderation filters>
//     GET  /api/admin/members/export?<Members filters>
//     GET  /api/admin/groups/export?<Groups filters>
//     GET  /api/admin/feeds/posts/export?<Feeds filters>
//   Top bar
//     GET  /api/admin/search?q=        members, groups, posts, reports, Sparks (5 each)
//     GET  /api/admin/alerts           the bell: high-priority reports, reports assigned to me,
//                                      join requests waiting, pending admin invitations
//   Moderation
//     GET  /api/admin/reports/triage   reports in review per admin ("Triage handoff")
//   Groups
//     POST /api/admin/groups           { name, description?, kind: open|private, joinMode? }  the admin owns it
//     POST /api/admin/groups/:groupId/contact-owner   { message }   an in-app notice from "CosQuest admins"
//   Feeds
//     POST /api/admin/feeds/posts      { content }   a text post (thought) as the admin's account
const mongoose = require('mongoose');
const User = require('../models/User');
const Post = require('../models/Post');
const Report = require('../models/Report');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const GroupJoinRequest = require('../models/GroupJoinRequest');
const AdminInvitation = require('../models/AdminInvitation');
const notificationModel = require('../models/notificationModel');
const { recordAudit } = require('../utils/audit');
const { csvCell } = require('./adminAuditController');
const { personJson } = require('./adminOverviewController');
const { reportLabel } = require('./reportController');
const content = require('../utils/adminContent');
const stats = require('../utils/adminStats');

const EXPORT_MAX = 5000;
const safe = (q) => String(q || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function answer(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  throw error;
}

// ---------- exports ----------

/**
 * Runs a page's own list endpoint for every page of results (so the export
 * uses exactly the page's filters), then writes the CSV.
 */
async function collect(handler, req, key) {
  const rows = [];
  let offset = 0;
  while (rows.length < EXPORT_MAX) {
    let body = null;
    const fake = {
      status() { return this; },
      json(data) { body = data; return this; },
    };
    await handler({ ...req, query: { ...req.query, offset: String(offset) } }, fake);
    const page = body?.[key] || [];
    rows.push(...page);
    if (body?.nextOffset == null || !page.length) break;
    offset = body.nextOffset;
  }
  return rows.slice(0, EXPORT_MAX);
}

async function sendCsv(req, res, name, header, lines) {
  await recordAudit(req.admin, { action: `${name}.export`, area: 'auth', target: { type: name, id: null, label: `${lines.length} rows` } });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="cosquest-${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.send([header.join(','), ...lines.map((cells) => cells.map(csvCell).join(','))].join('\n'));
}

async function exportOverview(req, res) {
  const { overview } = require('./adminOverviewController');
  let body = null;
  await overview(req, { status() { return this; }, json(data) { body = data; return this; } });
  const s = body.stats;
  const lines = [
    ['Active members', s.activeMembers.value, s.activeMembers.change],
    ['Community interactions', s.interactions.value, s.interactions.change],
    ['Active groups', s.activeGroups.value, null],
    ['New groups', s.activeGroups.newThisPeriod, null],
    ['Total groups', s.activeGroups.total, null],
    ['Open reports', s.openReports.value, null],
    ['High priority reports', s.openReports.high, null],
    ['Feed posts', body.pulse.feedPosts, null],
    ['Chat messages', body.pulse.chatMessages, null],
    ['New Sparks', body.pulse.newSparks, null],
    ['Reactions', body.pulse.mix.reactions, null],
    ['Comments', body.pulse.mix.comments, null],
    ['Replies', body.pulse.mix.replies, null],
    ['New members', body.pulse.newMembers.value, body.pulse.newMembers.change],
    ...body.engagement.current.map((d) => [`Interactions on ${d.date}`, d.interactions, null]),
  ].map(([label, value, change]) => [label, value, change == null ? '' : `${change}%`, new Date(body.window.from).toISOString().slice(0, 10), new Date(body.window.to).toISOString().slice(0, 10)]);
  return sendCsv(req, res, 'overview', ['metric', 'value', 'change_vs_previous', 'from', 'to'], lines);
}

async function exportReports(req, res) {
  const rows = await collect(require('./adminReportsController').list, req, 'reports');
  return sendCsv(
    req,
    res,
    'reports',
    ['report', 'type', 'reason', 'priority', 'status', 'reporters', 'author', 'content', 'assignee', 'decision', 'decision_reason', 'created_utc'],
    rows.map((r) => [
      r.number, r.targetType, r.reason, r.priority, r.status, r.reporterCount,
      r.targetUser?.username ? `@${r.targetUser.username}` : '',
      r.snapshot?.text || r.snapshot?.username || '',
      r.assignee?.name || '', r.decision?.action || '', r.decision?.reason || '', new Date(r.createdAt).toISOString(),
    ])
  );
}

async function exportMembers(req, res) {
  const rows = await collect(require('./adminMembersController').listMembers, req, 'members');
  return sendCsv(
    req,
    res,
    'members',
    ['name', 'username', 'email', 'role', 'status', 'faction', 'groups', 'last_active_utc', 'joined_utc'],
    rows.map((m) => [m.name, m.username ? `@${m.username}` : '', m.email || '', m.role, m.status, m.faction || '', m.groups, m.lastActiveAt ? new Date(m.lastActiveAt).toISOString() : '', new Date(m.createdAt).toISOString()])
  );
}

async function exportGroups(req, res) {
  const rows = await collect(require('./adminGroupsController').listGroups, req, 'groups');
  return sendCsv(
    req,
    res,
    'groups',
    ['group', 'kind', 'owner', 'members', 'messages_7d', 'open_reports', 'health', 'join_mode', 'created_utc'],
    rows.map((g) => [g.name, g.kind, g.owner?.username ? `@${g.owner.username}` : '', g.members ?? '', g.messagesThisWeek, g.openReports, g.health, g.joinMode, new Date(g.createdAt).toISOString()])
  );
}

async function exportPosts(req, res) {
  const rows = await collect(require('./adminFeedsController').listPosts, req, 'posts');
  return sendCsv(
    req,
    res,
    'posts',
    ['post', 'type', 'author', 'text', 'status', 'reactions', 'comments', 'open_reports', 'removed_reason', 'created_utc'],
    rows.map((p) => [p.label, p.type, p.author?.username ? `@${p.author.username}` : '', p.text, p.status, p.reactions, p.comments, p.openReports, p.removed?.reason || '', new Date(p.createdAt).toISOString()])
  );
}

// ---------- top bar: search ----------

async function search(req, res) {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ members: [], groups: [], posts: [], reports: [], sparks: [] });
  const s = safe(q.replace(/^@/, ''));
  const number = Number(q.replace(/^cq-?/i, ''));

  const [members, groups, posts, reports, sparks] = await Promise.all([
    User.find({
      $or: [
        { 'profile.usernameNormalized': { $regex: `^${s.toLowerCase()}` } },
        { 'profile.firstName': { $regex: s, $options: 'i' } },
        { 'profile.lastName': { $regex: s, $options: 'i' } },
        { 'profile.displayName': { $regex: s, $options: 'i' } },
        { email: { $regex: `^${s.toLowerCase()}` } },
      ],
    }).select('profile email').limit(5),
    Conversation.find({ type: 'group', 'group.name': { $regex: s, $options: 'i' } }).select('group').limit(5),
    Post.find({ content: { $regex: s, $options: 'i' } }).setOptions({ includeRemoved: true }).select('content type removedAt author createdAt').sort({ createdAt: -1 }).limit(5).populate('author', 'profile'),
    Report.find({ $or: [...(Number.isInteger(number) && number > 0 ? [{ number }] : []), { 'snapshot.text': { $regex: s, $options: 'i' } }] }).sort({ createdAt: -1 }).limit(5),
    (async () => {
      try {
        if (!require('../sparks').isModule()) return [];
        const rooms = (await Conversation.find({ type: { $in: ['group', 'community', 'faction'] }, 'group.archived': { $ne: true } }, '_id').lean()).map((r) => String(r._id));
        return mongoose.connection.collection('sparks_sparks').find({ chatId: { $in: rooms }, state: { $in: ['active', 'dormant'] }, subject: { $regex: s, $options: 'i' } }).sort({ lastMessageAt: -1 }).limit(5).toArray();
      } catch {
        return [];
      }
    })(),
  ]);

  return res.json({
    members: members.map((u) => ({ ...personJson(u), email: u.email || null })),
    groups: groups.map((g) => ({ id: String(g._id), name: g.group.name, kind: g.group.kind, archived: Boolean(g.group.archived) })),
    posts: posts.map((p) => ({ id: String(p._id), label: content.postLabel(p), text: content.clip(p.content, 90), author: personJson(p.author), removed: Boolean(p.removedAt) })),
    reports: reports.map((r) => ({ id: String(r._id), number: reportLabel(r.number), reason: r.reason, status: r.status, text: content.clip(r.snapshot?.text || r.snapshot?.username || '', 90) })),
    sparks: sparks.map((sp) => ({ id: sp.sparkId || sp._id, subject: sp.subject })),
  });
}

// ---------- top bar: the bell ----------

async function alerts(req, res) {
  const open = { $in: Report.OPEN_STATUSES };
  const [high, mine, requests, invitations] = await Promise.all([
    Report.find({ status: 'new', priority: 'high' }).sort({ createdAt: -1 }).limit(10),
    Report.find({ status: open, assignee: req.admin._id }).sort({ updatedAt: -1 }).limit(10),
    GroupJoinRequest.aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: '$conversation', count: { $sum: 1 }, latest: { $max: '$createdAt' } } },
      { $sort: { latest: -1 } },
      { $limit: 5 },
    ]),
    AdminInvitation.find({ status: 'pending', expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).limit(5).populate('user', 'profile'),
  ]);
  const groups = await Conversation.find({ _id: { $in: requests.map((r) => r._id) } }).select('group.name');
  const items = [
    ...high.map((r) => ({
      id: `high:${r._id}`,
      kind: 'high_priority_report',
      title: `High-priority report ${reportLabel(r.number)}`,
      text: content.clip(r.snapshot?.text || r.snapshot?.username || r.reason, 80),
      link: { page: 'moderation', report: String(r._id) },
      at: r.createdAt,
    })),
    ...mine
      .filter((r) => !high.some((h) => String(h._id) === String(r._id)))
      .map((r) => ({
        id: `mine:${r._id}`,
        kind: 'assigned_to_you',
        title: `${reportLabel(r.number)} is assigned to you`,
        text: content.clip(r.snapshot?.text || r.snapshot?.username || r.reason, 80),
        link: { page: 'moderation', report: String(r._id) },
        at: r.assignedAt || r.updatedAt,
      })),
    ...requests.map((r) => ({
      id: `join:${r._id}:${r.count}`,
      kind: 'join_requests',
      title: `${r.count} join request${r.count === 1 ? '' : 's'} waiting`,
      text: groups.find((g) => String(g._id) === String(r._id))?.group?.name || 'A group',
      link: { page: 'groups', group: String(r._id) },
      at: r.latest,
    })),
    ...invitations.map((inv) => ({
      id: `invite:${inv._id}`,
      kind: 'admin_invitation',
      title: 'Admin invitation pending',
      text: inv.user?.profile?.username ? `@${inv.user.profile.username} hasn't accepted yet` : 'Not accepted yet',
      link: { page: 'roles' },
      at: inv.createdAt,
    })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));
  return res.json({ items, counts: { highPriority: high.length, assignedToYou: mine.length } });
}

// ---------- Moderation: triage handoff ----------

async function triage(req, res) {
  const rows = await Report.aggregate([
    { $match: { status: 'in_review', assignee: { $ne: null } } },
    { $group: { _id: '$assignee', inReview: { $sum: 1 }, high: { $sum: { $cond: [{ $eq: ['$priority', 'high'] }, 1, 0] } } } },
    { $sort: { inReview: -1 } },
  ]);
  const admins = await User.find({ _id: { $in: rows.map((r) => r._id) } }).select('profile');
  const unassignedHigh = await Report.countDocuments({ status: { $in: Report.OPEN_STATUSES }, assignee: null, priority: 'high' });
  return res.json({
    admins: rows.map((r) => ({ ...personJson(admins.find((a) => String(a._id) === String(r._id))), inReview: r.inReview, high: r.high, you: String(r._id) === req.adminId })),
    unassignedHigh,
  });
}

// ---------- Groups ----------

async function createGroup(req, res) {
  try {
    const name = String(req.body.name).trim();
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    const conversation = await Conversation.create({
      type: 'group',
      group: {
        name,
        description,
        kind: req.body.kind,
        createdBy: req.admin._id,
        // Same defaults as a group made in the app (groupController.createGroup):
        // private groups ask an admin unless told otherwise, and every group
        // gets its invite link straight away.
        joinMode: req.body.joinMode || (req.body.kind === 'private' ? 'approval' : 'instant'),
        inviteCode: require('crypto').randomBytes(9).toString('base64url'),
        // The community's default for new groups (Settings).
        slowModeSeconds: await defaultSlowMode(),
      },
    });
    await ConversationMember.create({ conversation: conversation._id, user: req.admin._id, role: 'owner', joinedAt: new Date(), lastReadAt: new Date() });
    const event = await recordAudit(req.admin, {
      action: 'group.create',
      area: 'groups',
      target: { type: 'group', id: conversation._id, label: name },
      after: { kind: conversation.group.kind, joinMode: conversation.group.joinMode },
    });
    return res.status(201).json({ group: { id: String(conversation._id), name, kind: conversation.group.kind }, auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

async function defaultSlowMode() {
  try {
    const settings = await require('../models/CommunitySettings').current();
    return settings.moderation?.newGroupSlowMode || 0;
  } catch {
    return 0;
  }
}

async function contactOwner(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.groupId)) content.fail(404, 'Group not found.');
    const conversation = await Conversation.findById(req.params.groupId);
    if (!conversation || conversation.type !== 'group') content.fail(404, 'Group not found.');
    const message = String(req.body.message).trim();
    const ownerRow = await ConversationMember.findOne({ conversation: conversation._id, role: 'owner' });
    const ownerId = ownerRow?.user || conversation.group.createdBy;
    if (!ownerId) content.fail(409, 'This group has no owner to contact.');
    if (String(ownerId) === req.adminId) content.fail(400, 'You own this group.');
    await notificationModel.createForUser(ownerId, `CosQuest admins about ${conversation.group.name}: ${message}`, { type: 'system', conversation: conversation._id });
    const event = await recordAudit(req.admin, {
      action: 'group.contact_owner',
      area: 'groups',
      target: { type: 'group', id: conversation._id, label: conversation.group.name },
      reason: message,
      meta: { ownerId: String(ownerId) },
    });
    return res.json({ sent: true, auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

// ---------- Feeds ----------

async function createPost(req, res) {
  try {
    const text = String(req.body.content).trim();
    const post = await Post.create({ author: req.admin._id, type: 'thought', content: text });
    try {
      require('../utils/postNotifications').newPost(post, req.adminId);
    } catch {}
    const event = await recordAudit(req.admin, {
      action: 'post.create',
      area: 'feeds',
      target: { type: 'post', id: post._id, label: `${content.postLabel(post)} · community post` },
      after: { status: 'published' },
    });
    return res.status(201).json({ post: { id: String(post._id), label: content.postLabel(post) }, auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

module.exports = { exportOverview, exportReports, exportMembers, exportGroups, exportPosts, search, alerts, triage, createGroup, contactOwner, createPost };
