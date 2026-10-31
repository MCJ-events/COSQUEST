// Admin actions on content, shared by the Moderation, Feeds and Chats pages
// (super admin dashboard, Phase 2). Each one: does it, records it in the
// audit log, tells the author (a CosQuest notice) and closes the open
// reports about it. Nothing is done without a reason.
const Post = require('../models/Post');
const PostComment = require('../models/PostComment');
const CommentLike = require('../models/CommentLike');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const GroupBan = require('../models/GroupBan');
const GroupJoinRequest = require('../models/GroupJoinRequest');
const Report = require('../models/Report');
const notificationModel = require('../models/notificationModel');
const { recordAudit } = require('./audit');
const { emitToConversation, emitToUsers } = require('../realtime/socket');

const MUTE_DURATIONS = {
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  forever: 100 * 365 * 24 * 60 * 60 * 1000,
};
const MUTE_LABELS = { '1h': '1 hour', '1d': '1 day', '1w': '1 week', forever: 'until unmuted' };
const SLOW_MODE_VALUES = [0, 10, 30, 60, 300, 3600];

function fail(status, message, code) {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

/** "F-2B9C": a short, readable label for a post (its id's last characters). */
const postLabel = (post) => `F-${String(post._id || post).slice(-4).toUpperCase()}`;
const handle = (user) => (user?.profile?.username ? `@${user.profile.username}` : null);
const clip = (text, max = 160) => {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

function requireReason(reason) {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text.length < 3) fail(400, 'A reason is required.', 'reason_required');
  return text.slice(0, 1000);
}

/** A CosQuest notice to the person affected (never fails the action). */
function tell(userId, message) {
  if (!userId) return;
  notificationModel
    .createForUser(userId, message, { type: 'system' })
    .catch((error) => console.error('[admin] notice failed:', error.message));
}

/** Closes the open reports about something, pointing at the audit event. */
async function closeReports(targetType, targetId, admin, { action, reason, auditEvent, status = 'resolved', except = null }) {
  const filter = { targetType, targetId, status: { $in: Report.OPEN_STATUSES } };
  if (except) filter._id = { $ne: except };
  await Report.updateMany(filter, {
    $set: {
      status,
      'decision.action': action,
      'decision.reason': reason,
      'decision.by': admin._id,
      'decision.at': new Date(),
      'decision.auditEvent': auditEvent?._id || null,
    },
  });
}

// ---------- posts ----------
async function loadPostIncludingRemoved(postId) {
  return Post.findOne({ _id: postId }).setOptions({ includeRemoved: true }).populate('author', 'profile');
}

/** Hide a post from everyone; it stays in the database as evidence. */
async function removePost(post, admin, { reason, notifyAuthor = true, report = null }) {
  const why = requireReason(reason);
  if (post.removedAt) fail(409, 'This post was already removed.');
  const removedAt = new Date();
  await Post.updateOne({ _id: post._id }, { $set: { removedAt, removedBy: admin._id, removedReason: why } }).setOptions({ includeRemoved: true });
  // Its notifications go, so nobody taps into a missing post.
  try {
    require('./postNotifications').postDeleted(post._id);
  } catch {}
  const event = await recordAudit(admin, {
    action: 'post.remove',
    area: 'feeds',
    target: { type: 'post', id: post._id, label: [postLabel(post), handle(post.author)].filter(Boolean).join(' · ') },
    reason: why,
    before: { status: 'published', visible: true },
    after: { status: 'removed', visible: false },
    evidence: { text: post.content, media: (post.media || []).map((m) => m.url), type: post.type, createdAt: post.createdAt },
    report: report?._id || null,
    meta: { authorId: String(post.author?._id || post.author), authorNotified: notifyAuthor },
  });
  if (notifyAuthor) tell(post.author?._id || post.author, `A CosQuest admin removed your post. Reason: ${why}`);
  await closeReports('post', post._id, admin, { action: 'remove_post', reason: why, auditEvent: event });
  return event;
}

async function restorePost(post, admin, { reason }) {
  const why = requireReason(reason);
  if (!post.removedAt) fail(409, 'This post is not removed.');
  await Post.updateOne({ _id: post._id }, { $set: { removedAt: null, removedBy: null, removedReason: null } }).setOptions({ includeRemoved: true });
  return recordAudit(admin, {
    action: 'post.restore',
    area: 'feeds',
    target: { type: 'post', id: post._id, label: [postLabel(post), handle(post.author)].filter(Boolean).join(' · ') },
    reason: why,
    before: { status: 'removed' },
    after: { status: 'published' },
    meta: { authorId: String(post.author?._id || post.author) },
  });
}

// ---------- comments (same as the author deleting it, plus the record) ----------
async function removeComment(comment, admin, { reason, notifyAuthor = true, report = null }) {
  const why = requireReason(reason);
  await comment.populate('author', 'profile');
  const query = comment.parentComment ? { _id: comment._id } : { $or: [{ _id: comment._id }, { parentComment: comment._id }] };
  const removed = await PostComment.find(query).select('_id');
  const ids = removed.map((item) => item._id);
  const result = await PostComment.deleteMany(query);
  await CommentLike.deleteMany({ comment: { $in: ids } });
  if (comment.parentComment) await PostComment.updateOne({ _id: comment.parentComment }, { $inc: { replyCount: -1 } });
  await Post.updateOne({ _id: comment.post }, { $inc: { commentCount: -result.deletedCount } }).setOptions({ includeRemoved: true });
  const event = await recordAudit(admin, {
    action: 'comment.remove',
    area: 'feeds',
    target: { type: 'comment', id: comment._id, label: [`Comment on ${postLabel(comment.post)}`, handle(comment.author)].filter(Boolean).join(' · ') },
    reason: why,
    before: { visible: true, replies: Math.max(0, result.deletedCount - 1) },
    after: { visible: false },
    evidence: { text: comment.body || comment.media?.transcript || '', media: comment.media?.url || null, createdAt: comment.createdAt },
    report: report?._id || null,
    meta: { authorId: String(comment.author?._id || comment.author), postId: String(comment.post), authorNotified: notifyAuthor },
  });
  if (notifyAuthor) tell(comment.author?._id || comment.author, `A CosQuest admin removed your comment. Reason: ${why}`);
  await closeReports('comment', comment._id, admin, { action: 'remove_comment', reason: why, auditEvent: event });
  return event;
}

// ---------- chat messages (the same "deleted by an admin" tombstone groups use) ----------
async function deleteMessage(message, admin, { reason, notifyAuthor = true, report = null }) {
  const why = requireReason(reason);
  if (message.deletedForEveryone) fail(409, 'This message was already deleted.');
  await message.populate('sender', 'profile');
  const conversation = await Conversation.findById(message.conversation);
  message.deletedForEveryone = true;
  message.deletedAt = new Date();
  message.deletedByAdmin = true;
  await message.save();
  await Conversation.updateOne(
    { _id: message.conversation, pinnedMessage: message._id },
    { $set: { pinnedMessage: null, pinnedAt: null, pinnedUntil: null, pinnedBy: null, pinDuration: null } }
  );
  emitToConversation(String(message.conversation), 'message:deleted', {
    conversationId: String(message.conversation),
    messageId: String(message._id),
    scope: 'everyone',
    byAdmin: true,
  });
  const where = conversation?.group?.name || (conversation?.type === 'community' ? 'Community' : conversation?.type === 'faction' ? 'Faction room' : 'Chat');
  const event = await recordAudit(admin, {
    action: 'message.delete',
    area: 'chats',
    target: { type: 'message', id: message._id, label: [`Message in ${where}`, handle(message.sender)].filter(Boolean).join(' · ') },
    reason: why,
    before: { visible: true },
    after: { visible: false, shownAs: 'deleted by an admin' },
    evidence: { text: message.content || message.media?.transcript || '', media: message.media?.url || null, kind: message.kind, createdAt: message.createdAt },
    report: report?._id || null,
    meta: { authorId: String(message.sender?._id || message.sender), conversationId: String(message.conversation), authorNotified: notifyAuthor },
  });
  if (notifyAuthor) tell(message.sender?._id || message.sender, `A CosQuest admin deleted your message in ${where}. Reason: ${why}`);
  await closeReports('message', message._id, admin, { action: 'delete_message', reason: why, auditEvent: event });
  return event;
}

// ---------- groups: slow mode and members (super admins act in any group) ----------
async function loadGroup(conversationId) {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation || conversation.type !== 'group' || conversation.group?.archived) {
    fail(conversation && conversation.type !== 'group' ? 400 : 404, conversation ? 'Member actions here are for groups. Community and faction rooms come with the Members page.' : 'Group not found.');
  }
  return conversation;
}

async function broadcastGroupChange(conversation, extraUserIds = []) {
  const { explicitGroupMemberIds } = require('../controllers/chatController');
  const ids = [...new Set([...(await explicitGroupMemberIds(conversation)).map(String), ...extraUserIds.map(String)])];
  if (!ids.length) return;
  emitToUsers(ids, 'group:updated', { conversationId: String(conversation._id) });
  emitToUsers(ids, 'chat:preview', { conversationId: String(conversation._id) });
}

async function setSlowMode(conversation, admin, { seconds, reason }) {
  const why = typeof reason === 'string' ? reason.trim().slice(0, 1000) : '';
  if (!SLOW_MODE_VALUES.includes(seconds)) fail(400, 'seconds must be 0, 10, 30, 60, 300 or 3600.');
  const before = conversation.group.slowModeSeconds || 0;
  if (before === seconds) return null;
  await Conversation.updateOne({ _id: conversation._id }, { $set: { 'group.slowModeSeconds': seconds } });
  await broadcastGroupChange(conversation);
  return recordAudit(admin, {
    action: seconds ? 'group.slow_mode' : 'group.slow_mode_off',
    area: 'chats',
    target: { type: 'group', id: conversation._id, label: conversation.group.name },
    reason: why,
    before: { slowModeSeconds: before },
    after: { slowModeSeconds: seconds },
  });
}

async function muteInGroup(conversation, target, admin, { duration, reason }) {
  const why = requireReason(reason);
  if (!MUTE_DURATIONS[duration]) fail(400, 'duration must be 1h, 1d, 1w or forever.');
  const mutedUntil = new Date(Date.now() + MUTE_DURATIONS[duration]);
  await ConversationMember.updateOne(
    { conversation: conversation._id, user: target._id },
    { $set: { mutedByAdminUntil: mutedUntil, mutedBy: admin._id }, $setOnInsert: { lastReadAt: new Date(0) } },
    { upsert: true }
  );
  tell(target._id, `A CosQuest admin muted you in ${conversation.group.name} (${MUTE_LABELS[duration]}). You can still read it. Reason: ${why}`);
  await broadcastGroupChange(conversation, [target._id]);
  return recordAudit(admin, {
    action: 'member.mute',
    area: 'chats',
    target: { type: 'user', id: target._id, label: [handle(target), conversation.group.name].filter(Boolean).join(' · ') },
    reason: why,
    before: { canPost: true },
    after: { canPost: false, until: mutedUntil },
    meta: { authorId: String(target._id), conversationId: String(conversation._id), duration },
  });
}

async function unmuteInGroup(conversation, target, admin, { reason }) {
  await ConversationMember.updateOne({ conversation: conversation._id, user: target._id }, { $set: { mutedByAdminUntil: null, mutedBy: null } });
  await broadcastGroupChange(conversation, [target._id]);
  return recordAudit(admin, {
    action: 'member.unmute',
    area: 'chats',
    target: { type: 'user', id: target._id, label: [handle(target), conversation.group.name].filter(Boolean).join(' · ') },
    reason: typeof reason === 'string' ? reason.trim() : '',
    before: { canPost: false },
    after: { canPost: true },
    meta: { authorId: String(target._id), conversationId: String(conversation._id) },
  });
}

async function removeFromGroup(conversation, target, admin, { reason, ban = false }) {
  const why = requireReason(reason);
  const row = await ConversationMember.findOne({ conversation: conversation._id, user: target._id });
  const inByRole = Boolean(row?.role);
  // People in a faction group because of their faction can only be kept out with a ban.
  if (!ban && !inByRole) fail(400, "They're in this group because of their faction. Ban them to keep them out.", 'use_ban');
  if (ban) {
    await GroupBan.updateOne({ conversation: conversation._id, user: target._id }, { $set: { bannedBy: admin._id, reason: why.slice(0, 200) } }, { upsert: true });
    await GroupJoinRequest.updateMany(
      { conversation: conversation._id, user: target._id, status: 'pending' },
      { $set: { status: 'declined', decidedBy: admin._id, decidedAt: new Date() } }
    );
  }
  await ConversationMember.updateOne({ conversation: conversation._id, user: target._id }, { $set: { role: null, mutedByAdminUntil: null } });
  // Removing the owner hands the group on, the same way as the owner leaving
  // (groupController.leaveGroup): the longest-serving admin, else member.
  let newOwner = null;
  if (row?.role === 'owner') {
    const successor =
      (await ConversationMember.findOne({ conversation: conversation._id, role: 'admin' }).sort({ joinedAt: 1 })) ||
      (await ConversationMember.findOne({ conversation: conversation._id, role: 'member' }).sort({ joinedAt: 1 }));
    if (successor) {
      await ConversationMember.updateOne({ _id: successor._id }, { $set: { role: 'owner' } });
      newOwner = String(successor.user);
    } else if (conversation.group.kind !== 'faction') {
      await Conversation.updateOne({ _id: conversation._id }, { $set: { 'group.archived': true } });
    }
  }
  tell(target._id, `You were removed from ${conversation.group.name} by a CosQuest admin. Reason: ${why}`);
  emitToUsers([String(target._id)], 'group:removed', { conversationId: String(conversation._id), reason: ban ? 'banned' : 'removed' });
  await broadcastGroupChange(conversation);
  return recordAudit(admin, {
    action: ban ? 'member.ban' : 'member.remove',
    area: 'chats',
    target: { type: 'user', id: target._id, label: [handle(target), conversation.group.name].filter(Boolean).join(' · ') },
    reason: why,
    before: { member: inByRole || conversation.group.kind === 'faction', role: row?.role || null },
    after: { member: false, banned: ban, ...(row?.role === 'owner' ? { newOwner } : {}) },
    meta: { authorId: String(target._id), conversationId: String(conversation._id) },
  });
}

module.exports = {
  MUTE_DURATIONS,
  SLOW_MODE_VALUES,
  fail,
  postLabel,
  clip,
  requireReason,
  closeReports,
  loadPostIncludingRemoved,
  removePost,
  restorePost,
  removeComment,
  deleteMessage,
  loadGroup,
  setSlowMode,
  muteInGroup,
  unmuteInGroup,
  removeFromGroup,
};
