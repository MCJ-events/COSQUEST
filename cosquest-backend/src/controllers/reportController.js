// Members reporting a post, comment, chat message or profile.
//
//   POST /api/reports  { targetType, targetId, reason, statement? }
//     201 { report: { id, number, status }, alreadyReported: false }  a new report
//     200 { report, alreadyReported: false }  added to the open report on that target
//     200 { report, alreadyReported: true }   this person already reported it
//
// One open report per target (several reporters are added to it). The
// content is copied into `snapshot` when first reported, so the evidence
// survives an edit or a delete. Reviewing and deciding is the admin side
// (Moderation page).
const mongoose = require('mongoose');
const Report = require('../models/Report');
const Counter = require('../models/Counter');
const Post = require('../models/Post');
const PostComment = require('../models/PostComment');
const Message = require('../models/Message');
const User = require('../models/User');

const DAILY_LIMIT = 30;

const reportLabel = (number) => `CQ-${number}`;
const priorityFor = (reason) => (Report.HIGH_PRIORITY_REASONS.includes(reason) ? 'high' : 'standard');
const mediaUrls = (media) => (Array.isArray(media) ? media : media ? [media] : []).map((item) => item?.url).filter(Boolean);

function fail(status, message, code) {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

function usernameOf(user) {
  return user?.profile?.username || null;
}

// The reported thing: who wrote it, where it is, and a copy of it.
async function loadTarget(targetType, targetId, reporter) {
  if (targetType === 'post') {
    const post = await Post.findById(targetId).populate('author', 'profile.username');
    if (!post) fail(404, 'Post not found.');
    return {
      targetUser: post.author?._id || post.author,
      post: post._id,
      snapshot: {
        kind: 'post',
        postType: post.type,
        text: post.content || '',
        media: mediaUrls(post.media),
        author: usernameOf(post.author),
        createdAt: post.createdAt,
      },
    };
  }
  if (targetType === 'comment') {
    const comment = await PostComment.findById(targetId).populate('author', 'profile.username');
    if (!comment) fail(404, 'Comment not found.');
    return {
      targetUser: comment.author?._id || comment.author,
      post: comment.post,
      snapshot: {
        kind: 'comment',
        text: comment.body || comment.media?.transcript || '',
        media: mediaUrls(comment.media),
        author: usernameOf(comment.author),
        createdAt: comment.createdAt,
      },
    };
  }
  if (targetType === 'message') {
    const message = await Message.findById(targetId).populate('sender', 'profile.username');
    if (!message) fail(404, 'Message not found.');
    // Only people who can see the chat can report its messages.
    const { loadConversationForUser } = require('./chatController');
    const { conversation, error } = await loadConversationForUser(String(message.conversation), reporter);
    if (error) fail(404, 'Message not found.');
    return {
      targetUser: message.sender?._id || message.sender,
      conversation: conversation._id,
      snapshot: {
        kind: 'message',
        messageKind: message.kind,
        text: message.content || message.media?.transcript || '',
        media: mediaUrls(message.media).concat(mediaUrls(message.album)),
        author: usernameOf(message.sender),
        chat: { type: conversation.type, name: conversation.group?.name || null },
        createdAt: message.createdAt,
      },
    };
  }
  // profile
  const user = await User.findById(targetId);
  if (!user || !user.onboardingComplete) fail(404, 'Profile not found.');
  return {
    targetUser: user._id,
    snapshot: {
      kind: 'profile',
      username: usernameOf(user),
      name: user.profile?.displayName || [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(' '),
      bio: user.profile?.bio || '',
      photo: user.profile?.avatarPhotoUrl || null,
    },
  };
}

function reportJson(report) {
  return { id: String(report._id), number: reportLabel(report.number), status: report.status };
}

async function addReporter(report, reporterEntry) {
  if (report.reporters.some((r) => String(r.user) === String(reporterEntry.user))) {
    return { status: 200, body: { report: reportJson(report), alreadyReported: true } };
  }
  const update = { $push: { reporters: reporterEntry }, $inc: { reporterCount: 1 } };
  if (priorityFor(reporterEntry.reason) === 'high') update.$set = { priority: 'high' };
  const updated = await Report.findOneAndUpdate(
    { _id: report._id, 'reporters.user': { $ne: reporterEntry.user } },
    update,
    { new: true }
  );
  return { status: 200, body: { report: reportJson(updated || report), alreadyReported: !updated } };
}

async function createReport(req, res) {
  const { targetType, targetId, reason } = req.body;
  const statement = typeof req.body.statement === 'string' ? req.body.statement.trim() : '';
  if (!mongoose.isValidObjectId(targetId)) return res.status(400).json({ error: 'Invalid targetId.' });

  try {
    if (targetType === 'profile' && String(targetId) === String(req.userId)) fail(400, "You can't report yourself.");

    // A generous daily limit, so the queue can't be flooded.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const today = await Report.countDocuments({ reporters: { $elemMatch: { user: req.user._id, at: { $gte: since } } } });
    if (today >= DAILY_LIMIT) fail(429, 'You have sent a lot of reports today. Try again tomorrow.', 'report_limit');

    const target = await loadTarget(targetType, targetId, req.user);
    if (target.targetUser && String(target.targetUser) === String(req.userId)) fail(400, "You can't report your own content.");

    const reporterEntry = { user: req.user._id, reason, statement, at: new Date() };
    const open = await Report.findOne({ targetType, targetId, status: { $in: Report.OPEN_STATUSES } });
    if (open) {
      const result = await addReporter(open, reporterEntry);
      return res.status(result.status).json(result.body);
    }

    try {
      const report = await Report.create({
        number: await Counter.next('report', 1000),
        targetType,
        targetId,
        targetUser: target.targetUser || null,
        conversation: target.conversation || null,
        post: target.post || null,
        reason,
        priority: priorityFor(reason),
        reporters: [reporterEntry],
        reporterCount: 1,
        snapshot: { ...target.snapshot, capturedAt: new Date() },
      });
      return res.status(201).json({ report: reportJson(report), alreadyReported: false });
    } catch (error) {
      // Someone else opened a report on this target at the same moment.
      if (error?.code !== 11000) throw error;
      const raced = await Report.findOne({ targetType, targetId, status: { $in: Report.OPEN_STATUSES } });
      if (!raced) throw error;
      const result = await addReporter(raced, reporterEntry);
      return res.status(result.status).json(result.body);
    }
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
    throw error;
  }
}

module.exports = { createReport, reportLabel, reportJson };
