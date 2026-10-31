// The Moderation page (super admin dashboard, Phase 2).
//
//   GET  /api/admin/reports/stats                  open, new, in review, high priority, resolved today
//   GET  /api/admin/reports?status=open|new|in_review|resolved&type=&priority=&assignee=me|<id>|none&q=&offset=
//   GET  /api/admin/reports/:reportId              the report, its evidence, the author's history, reporters
//   POST /api/admin/reports/:reportId/assign       { adminId? } (default: me) - new -> in review
//   POST /api/admin/reports/:reportId/decision     { action, reason, notifyAuthor? }
//
// Decisions per target (a reason is always required):
//   post     remove_post | dismiss          comment  remove_comment | dismiss
//   message  delete_message | dismiss       profile  dismiss (member restrictions: Members page)
const mongoose = require('mongoose');
const Report = require('../models/Report');
const Post = require('../models/Post');
const PostComment = require('../models/PostComment');
const Message = require('../models/Message');
const User = require('../models/User');
const AuditEvent = require('../models/AuditEvent');
const { recordAudit } = require('../utils/audit');
const { isSuperAdmin } = require('../utils/superAdmin');
const content = require('../utils/adminContent');
const { reportLabel } = require('./reportController');
const { personJson } = require('./adminOverviewController');

const PAGE = 25;
const ACTIONS = {
  post: ['remove_post', 'dismiss'],
  comment: ['remove_comment', 'dismiss'],
  message: ['delete_message', 'dismiss'],
  profile: ['dismiss'],
};

function startOfToday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function reportJson(report, { full = false } = {}) {
  const json = {
    id: String(report._id),
    number: reportLabel(report.number),
    targetType: report.targetType,
    targetId: String(report.targetId),
    reason: report.reason,
    priority: report.priority,
    status: report.status,
    reporterCount: report.reporterCount,
    snapshot: report.snapshot,
    targetUser: personJson(report.targetUser),
    assignee: personJson(report.assignee),
    conversationId: report.conversation ? String(report.conversation) : null,
    postId: report.post ? String(report.post) : null,
    decision: report.decision?.action
      ? { action: report.decision.action, reason: report.decision.reason, by: personJson(report.decision.by), at: report.decision.at }
      : null,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
  if (full) {
    json.reporters = (report.reporters || []).map((r) => ({ user: personJson(r.user), reason: r.reason, statement: r.statement, at: r.at }));
  }
  return json;
}

const POPULATE = [
  { path: 'targetUser', select: 'profile createdAt' },
  { path: 'assignee', select: 'profile' },
  { path: 'decision.by', select: 'profile' },
];

async function stats(req, res) {
  const open = { status: { $in: Report.OPEN_STATUSES } };
  const [openCount, newCount, inReview, high, resolvedToday] = await Promise.all([
    Report.countDocuments(open),
    Report.countDocuments({ status: 'new' }),
    Report.countDocuments({ status: 'in_review' }),
    Report.countDocuments({ ...open, priority: 'high' }),
    Report.countDocuments({ status: { $in: ['resolved', 'dismissed'] }, 'decision.at': { $gte: startOfToday() } }),
  ]);
  return res.json({ open: openCount, new: newCount, inReview, high, resolvedToday });
}

async function list(req, res) {
  const filter = {};
  const status = req.query.status || 'open';
  if (status === 'open') filter.status = { $in: Report.OPEN_STATUSES };
  else if (status === 'resolved') filter.status = { $in: ['resolved', 'dismissed'] };
  else filter.status = status;
  if (req.query.type) filter.targetType = req.query.type;
  if (req.query.priority) filter.priority = req.query.priority;
  if (req.query.assignee === 'me') filter.assignee = req.admin._id;
  else if (req.query.assignee === 'none') filter.assignee = null;
  else if (req.query.assignee) filter.assignee = req.query.assignee;
  if (req.query.q) {
    const q = String(req.query.q).trim();
    const number = Number(q.replace(/^cq-?/i, ''));
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      ...(Number.isInteger(number) && number > 0 ? [{ number }] : []),
      { 'snapshot.text': { $regex: safe, $options: 'i' } },
      { 'snapshot.author': { $regex: safe, $options: 'i' } },
      { 'snapshot.username': { $regex: safe, $options: 'i' } },
    ];
  }
  const offset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
  // Open reports: high priority first, then newest. Others: newest decided first.
  const sort = status === 'resolved' ? { 'decision.at': -1, _id: -1 } : { priority: 1, createdAt: -1, _id: -1 };
  const [rows, total] = await Promise.all([
    Report.find(filter).sort(sort).skip(offset).limit(PAGE).populate(POPULATE),
    Report.countDocuments(filter),
  ]);
  return res.json({
    reports: rows.map((r) => reportJson(r)),
    total,
    nextOffset: offset + rows.length < total ? offset + rows.length : null,
  });
}

async function loadReport(reportId) {
  if (!mongoose.isValidObjectId(reportId)) content.fail(404, 'Report not found.');
  const report = await Report.findById(reportId).populate([...POPULATE, { path: 'reporters.user', select: 'profile' }]);
  if (!report) content.fail(404, 'Report not found.');
  return report;
}

// The reported thing as it is NOW (it may have been edited, deleted or removed since).
async function liveTarget(report) {
  if (report.targetType === 'post') {
    const post = await Post.findOne({ _id: report.targetId }).setOptions({ includeRemoved: true });
    if (!post) return { exists: false };
    return {
      exists: true,
      label: content.postLabel(post),
      removed: Boolean(post.removedAt),
      text: post.content,
      media: (post.media || []).map((m) => m.url),
      reactions: post.likeCount,
      comments: post.commentCount,
      editedAt: post.editedAt,
    };
  }
  if (report.targetType === 'comment') {
    const comment = await PostComment.findById(report.targetId);
    return comment ? { exists: true, text: comment.body || comment.media?.transcript || '', postId: String(comment.post) } : { exists: false };
  }
  if (report.targetType === 'message') {
    const message = await Message.findById(report.targetId);
    if (!message) return { exists: false };
    return { exists: true, deleted: Boolean(message.deletedForEveryone), text: message.deletedForEveryone ? null : message.content, editedAt: message.editedAt };
  }
  const user = await User.findById(report.targetId).select('profile');
  return user ? { exists: true, username: user.profile?.username, bio: user.profile?.bio || '' } : { exists: false };
}

async function authorHistory(report) {
  if (!report.targetUser) return null;
  const id = report.targetUser._id || report.targetUser;
  const [posts, reportsAgainst, actions] = await Promise.all([
    Post.countDocuments({ author: id }),
    Report.countDocuments({ targetUser: id }),
    AuditEvent.countDocuments({ 'meta.authorId': String(id) }),
  ]);
  return { joinedAt: report.targetUser.createdAt || null, posts, reportsAgainst, previousActions: actions };
}

async function detail(req, res) {
  try {
    const report = await loadReport(req.params.reportId);
    const [target, author, history] = await Promise.all([
      liveTarget(report),
      authorHistory(report),
      AuditEvent.find({ report: report._id }).sort({ createdAt: -1 }).limit(20).populate('actor', 'profile'),
    ]);
    return res.json({
      report: reportJson(report, { full: true }),
      target,
      author,
      actions: ACTIONS[report.targetType],
      history: history.map((event) => require('../utils/audit').auditJson(event)),
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
}

async function assign(req, res) {
  try {
    const report = await loadReport(req.params.reportId);
    if (!Report.OPEN_STATUSES.includes(report.status)) content.fail(409, 'This report has already been decided.');
    let assignee = req.admin;
    if (req.body?.adminId && String(req.body.adminId) !== req.adminId) {
      assignee = await User.findById(req.body.adminId);
      if (!assignee || !isSuperAdmin(assignee)) content.fail(400, 'Reports can only be assigned to a super admin.');
    }
    const before = { status: report.status, assignee: report.assignee ? String(report.assignee._id || report.assignee) : null };
    report.assignee = assignee._id;
    report.assignedAt = new Date();
    report.status = 'in_review';
    await report.save();
    await recordAudit(req.admin, {
      action: 'report.assign',
      area: 'moderation',
      target: { type: 'report', id: report._id, label: `${reportLabel(report.number)} · ${assignee.profile?.username ? `@${assignee.profile.username}` : 'admin'}` },
      before,
      after: { status: 'in_review', assignee: String(assignee._id) },
      report: report._id,
    });
    await report.populate(POPULATE);
    return res.json({ report: reportJson(report) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
    throw error;
  }
}

async function decide(req, res) {
  try {
    const report = await loadReport(req.params.reportId);
    if (!Report.OPEN_STATUSES.includes(report.status)) content.fail(409, 'This report has already been decided.');
    const { action } = req.body;
    if (!ACTIONS[report.targetType].includes(action)) {
      content.fail(400, `For a ${report.targetType}, the action must be ${ACTIONS[report.targetType].join(' or ')}.`);
    }
    const reason = content.requireReason(req.body.reason);
    const notifyAuthor = req.body.notifyAuthor !== false;

    let event;
    if (action === 'dismiss') {
      event = await recordAudit(req.admin, {
        action: 'report.dismiss',
        area: 'moderation',
        target: { type: 'report', id: report._id, label: reportLabel(report.number) },
        reason,
        before: { status: report.status },
        after: { status: 'dismissed' },
        report: report._id,
        meta: report.targetUser ? { authorId: String(report.targetUser._id || report.targetUser) } : null,
      });
      await content.closeReports(report.targetType, report.targetId, req.admin, { action: 'dismiss', reason, auditEvent: event, status: 'dismissed' });
    } else if (action === 'remove_post') {
      const post = await content.loadPostIncludingRemoved(report.targetId);
      if (!post) content.fail(410, 'This post no longer exists.');
      event = await content.removePost(post, req.admin, { reason, notifyAuthor, report });
    } else if (action === 'remove_comment') {
      const comment = await PostComment.findById(report.targetId);
      if (!comment) content.fail(410, 'This comment no longer exists.');
      event = await content.removeComment(comment, req.admin, { reason, notifyAuthor, report });
    } else if (action === 'delete_message') {
      const message = await Message.findById(report.targetId);
      if (!message) content.fail(410, 'This message no longer exists.');
      event = await content.deleteMessage(message, req.admin, { reason, notifyAuthor, report });
    }

    const updated = await Report.findById(report._id).populate(POPULATE);
    return res.json({ report: reportJson(updated), auditEvent: event ? `EV-${event.number}` : null });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
    throw error;
  }
}

module.exports = { stats, list, detail, assign, decide, reportJson };
