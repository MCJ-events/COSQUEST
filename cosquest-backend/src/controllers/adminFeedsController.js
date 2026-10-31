// The Feeds page (super admin dashboard, Phase 2).
//
//   GET  /api/admin/feeds/stats?from&to         posts, reactions, open post reports, removed
//   GET  /api/admin/feeds/posts?tab=all|reported|removed&type=&q=&offset=
//   GET  /api/admin/feeds/posts/:postId          the post, its reports and admin history
//   POST /api/admin/feeds/posts/:postId/remove   { reason, notifyAuthor? }   hidden, kept as evidence
//   POST /api/admin/feeds/posts/:postId/restore  { reason }
const mongoose = require('mongoose');
const Post = require('../models/Post');
const PostLike = require('../models/PostLike');
const Report = require('../models/Report');
const AuditEvent = require('../models/AuditEvent');
const User = require('../models/User');
const { auditJson } = require('../utils/audit');
const stats = require('../utils/adminStats');
const content = require('../utils/adminContent');
const { personJson } = require('./adminOverviewController');
const { reportJson } = require('./adminReportsController');

const PAGE = 25;

async function feedStats(req, res) {
  const { current } = stats.windows(req.query);
  const [posts, reactions, openReports, removed] = await Promise.all([
    Post.countDocuments(stats.inWindow(current)),
    PostLike.countDocuments(stats.inWindow(current)),
    Report.countDocuments({ targetType: { $in: ['post', 'comment'] }, status: { $in: Report.OPEN_STATUSES } }),
    Post.countDocuments({ removedAt: { $ne: null } }).setOptions({ includeRemoved: true }),
  ]);
  return res.json({ window: current, posts, reactions, openReports, removed });
}

function postJson(post, reportCount = 0) {
  return {
    id: String(post._id),
    label: content.postLabel(post),
    type: post.type,
    text: post.content,
    media: (post.media || []).map((m) => ({ url: m.url, kind: m.resourceType })),
    author: personJson(post.author),
    reactions: post.likeCount,
    comments: post.commentCount,
    shares: post.shareCount,
    status: post.removedAt ? 'removed' : 'published',
    removed: post.removedAt ? { at: post.removedAt, reason: post.removedReason, by: post.removedBy ? String(post.removedBy) : null } : null,
    openReports: reportCount,
    editedAt: post.editedAt,
    createdAt: post.createdAt,
  };
}

async function openReportCounts(postIds) {
  const rows = await Report.aggregate([
    { $match: { targetType: 'post', targetId: { $in: postIds }, status: { $in: Report.OPEN_STATUSES } } },
    { $group: { _id: '$targetId', count: { $sum: '$reporterCount' } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

async function listPosts(req, res) {
  const tab = req.query.tab || 'all';
  const filter = {};
  if (tab === 'removed') filter.removedAt = { $ne: null };
  if (tab === 'reported') {
    const ids = await Report.distinct('targetId', { targetType: 'post', status: { $in: Report.OPEN_STATUSES } });
    filter._id = { $in: ids };
  }
  if (req.query.type) filter.type = req.query.type;
  if (req.query.q) {
    const q = String(req.query.q).trim().replace(/^@/, '');
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const authors = await User.find({ 'profile.usernameNormalized': { $regex: `^${safe.toLowerCase()}` } }, '_id').limit(50);
    filter.$or = [{ content: { $regex: safe, $options: 'i' } }, { author: { $in: authors.map((a) => a._id) } }];
  }
  const offset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
  const [rows, total] = await Promise.all([
    Post.find(filter).setOptions({ includeRemoved: true }).sort({ createdAt: -1, _id: -1 }).skip(offset).limit(PAGE).populate('author', 'profile'),
    Post.countDocuments(filter).setOptions({ includeRemoved: true }),
  ]);
  const counts = await openReportCounts(rows.map((p) => p._id));
  return res.json({
    posts: rows.map((post) => postJson(post, counts.get(String(post._id)) || 0)),
    total,
    nextOffset: offset + rows.length < total ? offset + rows.length : null,
  });
}

async function loadPost(postId) {
  if (!mongoose.isValidObjectId(postId)) content.fail(404, 'Post not found.');
  const post = await content.loadPostIncludingRemoved(postId);
  if (!post) content.fail(404, 'Post not found.');
  return post;
}

function answer(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  throw error;
}

async function getPost(req, res) {
  try {
    const post = await loadPost(req.params.postId);
    const [reports, history] = await Promise.all([
      Report.find({ targetType: 'post', targetId: post._id }).sort({ createdAt: -1 }).limit(20).populate([{ path: 'targetUser', select: 'profile' }, { path: 'assignee', select: 'profile' }]),
      AuditEvent.find({ 'target.type': 'post', 'target.id': String(post._id) }).sort({ createdAt: -1 }).limit(20).populate('actor', 'profile'),
    ]);
    const open = reports.filter((r) => Report.OPEN_STATUSES.includes(r.status)).reduce((sum, r) => sum + r.reporterCount, 0);
    return res.json({ post: postJson(post, open), reports: reports.map((r) => reportJson(r)), history: history.map(auditJson) });
  } catch (error) {
    return answer(res, error);
  }
}

async function removePost(req, res) {
  try {
    const post = await loadPost(req.params.postId);
    const event = await content.removePost(post, req.admin, { reason: req.body.reason, notifyAuthor: req.body.notifyAuthor !== false });
    const updated = await content.loadPostIncludingRemoved(post._id);
    return res.json({ post: postJson(updated), auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

async function restorePost(req, res) {
  try {
    const post = await loadPost(req.params.postId);
    const event = await content.restorePost(post, req.admin, { reason: req.body.reason });
    const updated = await content.loadPostIncludingRemoved(post._id);
    return res.json({ post: postJson(updated), auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

module.exports = { feedStats, listPosts, getPost, removePost, restorePost };
