const mongoose = require('mongoose');

/**
 * Three flavors share one collection:
 *  - 'community': exactly one row for the whole app. Every onboarded user is
 *    an implicit member - membership isn't stored, it's just "is logged in".
 *  - 'faction': at most one row per faction key. Membership is implicit too -
 *    it's whoever currently has that `faction` on their User document, so
 *    switching factions moves you between faction rooms automatically.
 *  - 'dm': exactly 2 participants, created on demand. `dmKey` is the two
 *    participant ids sorted and joined, so a unique index can stop the same
 *    pair from getting a second conversation.
 *
 * `participants` is only populated for 'dm'; community/faction rooms don't
 * store a member list here (see ConversationMember for per-user lastReadAt,
 * which every type uses).
 */
const conversationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['community', 'faction', 'dm'], required: true },
    factionKey: { type: String, default: null },
    participants: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    dmKey: { type: String, default: null },
    pinnedMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    pinnedAt: { type: Date, default: null },
    pinnedUntil: { type: Date, default: null },
    pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    pinDuration: { type: String, enum: ['24h', '7d', '30d', null], default: null },
    messageCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

conversationSchema.index({ type: 1 }, { unique: true, partialFilterExpression: { type: 'community' } });
conversationSchema.index({ type: 1, factionKey: 1 }, { unique: true, partialFilterExpression: { type: 'faction' } });
conversationSchema.index({ dmKey: 1 }, { unique: true, partialFilterExpression: { type: 'dm' } });

module.exports = mongoose.model('Conversation', conversationSchema);
