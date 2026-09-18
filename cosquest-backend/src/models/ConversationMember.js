const mongoose = require('mongoose');

/**
 * One row per user per conversation, tracking only what's per-viewer:
 * `lastReadAt` drives the unread badge in the chat list and (for DMs) the
 * read-receipt checkmark on the other person's sent messages. Created lazily
 * the first time a user opens a conversation - even for community/faction
 * rooms, whose membership itself is never stored here (see Conversation.js).
 */
const conversationMemberSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    lastReadAt: { type: Date, default: () => new Date(0) },
  },
  { timestamps: true }
);

conversationMemberSchema.index({ conversation: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('ConversationMember', conversationMemberSchema);
