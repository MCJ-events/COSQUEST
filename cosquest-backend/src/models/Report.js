const mongoose = require('mongoose');

/**
 * A member's report of a post, comment, chat message or profile (the
 * "Report" option in the app). Super admins review them on the Moderation
 * page of the admin dashboard.
 *
 * One OPEN report per target: when several people report the same thing,
 * they are added to `reporters` instead of opening a second report (the
 * queue shows "2 member reports"). A decided report stays as the record.
 *
 * `snapshot` keeps the reported content as it was when first reported, so
 * the evidence survives an edit or a delete by its author.
 */
const TARGET_TYPES = ['post', 'comment', 'message', 'profile'];
const REASONS = ['spam', 'harassment', 'impersonation', 'creator_credit', 'off_topic', 'hate', 'violence', 'self_harm', 'other'];
// Scams and member harm are surfaced first (the "Prioritize scams and member
// harm" moderation default).
const HIGH_PRIORITY_REASONS = ['spam', 'harassment', 'hate', 'violence', 'self_harm'];
const STATUSES = ['new', 'in_review', 'resolved', 'dismissed'];
const OPEN_STATUSES = ['new', 'in_review'];

const reporterSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, enum: REASONS, required: true },
    statement: { type: String, default: '', trim: true, maxlength: 1000 },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const reportSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true }, // shown as CQ-<number>
    targetType: { type: String, enum: TARGET_TYPES, required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    // Who wrote the reported content (or the reported profile).
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Messages: the chat it's in. Comments: the post it's on.
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },

    // The first reporter's reason; later reporters keep their own in `reporters`.
    reason: { type: String, enum: REASONS, required: true },
    priority: { type: String, enum: ['high', 'standard'], default: 'standard' },
    status: { type: String, enum: STATUSES, default: 'new' },
    reporters: { type: [reporterSchema], default: [] },
    reporterCount: { type: Number, default: 1, min: 1 },

    // The content as first reported (text, media links, author, where).
    snapshot: { type: mongoose.Schema.Types.Mixed, default: null },

    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assignedAt: { type: Date, default: null },

    // Filled once a super admin decides (the matching AuditEvent has the detail).
    decision: {
      action: { type: String, default: null }, // remove_post, delete_message, dismiss, mute, ban...
      reason: { type: String, default: null, trim: true, maxlength: 1000 },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      at: { type: Date, default: null },
      auditEvent: { type: mongoose.Schema.Types.ObjectId, ref: 'AuditEvent', default: null },
    },
  },
  { timestamps: true }
);

// CQ-<number> lookups, and numbers are never reused.
reportSchema.index({ number: 1 }, { unique: true });
// One open report per target (POST /api/reports adds reporters to it).
reportSchema.index(
  { targetType: 1, targetId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: OPEN_STATUSES } } }
);
// The moderation queue: by status, newest first.
reportSchema.index({ status: 1, createdAt: -1 });
// Overview / queue counters: open high-priority reports.
reportSchema.index({ status: 1, priority: 1 });
// Member safety history: reports about one person.
reportSchema.index({ targetUser: 1, createdAt: -1 });
// "2 reports" on a group in the Groups and Chats pages.
reportSchema.index({ conversation: 1, status: 1 });

reportSchema.statics.TARGET_TYPES = TARGET_TYPES;
reportSchema.statics.REASONS = REASONS;
reportSchema.statics.HIGH_PRIORITY_REASONS = HIGH_PRIORITY_REASONS;
reportSchema.statics.STATUSES = STATUSES;
reportSchema.statics.OPEN_STATUSES = OPEN_STATUSES;

module.exports = mongoose.model('Report', reportSchema);
