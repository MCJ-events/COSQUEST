const mongoose = require('mongoose');

/**
 * One row per user per notification, so "get my notifications" is a plain
 * indexed query and marking read doesn't touch anyone else's copy.
 *
 * `mention` and `group` notifications also point at the chat (and message),
 * so the app can open it when tapped. Post activity (`like`, `comment`,
 * `repost`, and `post` = someone you follow posted or reposted) points at the
 * post (and comment).
 */
const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    message: { type: String, required: true },
    type: { type: String, enum: ['system', 'follow', 'mention', 'group', 'like', 'comment', 'repost', 'post'], default: 'system' },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
    chatMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    scheduledCall: { type: mongoose.Schema.Types.ObjectId, ref: 'ScheduledCall', default: null },
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },
    postComment: { type: mongoose.Schema.Types.ObjectId, ref: 'PostComment', default: null },
    deliveryKey: { type: String },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ deliveryKey: 1 }, { unique: true, sparse: true });
// The inbox, newest first, and removing a deleted post's notifications.
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ post: 1 }, { sparse: true });
module.exports = mongoose.model('Notification', notificationSchema);
