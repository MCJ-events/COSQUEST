const mongoose = require('mongoose');

/**
 * One row per user per notification, so "get my notifications" is a plain
 * indexed query and marking read doesn't touch anyone else's copy.
 *
 * `mention` notifications also point at the chat and message, so the app
 * can open the exact message when tapped.
 */
const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    message: { type: String, required: true },
    type: { type: String, enum: ['system', 'follow', 'mention'], default: 'system' },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
    chatMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', notificationSchema);
