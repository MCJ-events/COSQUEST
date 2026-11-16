const mongoose = require('mongoose');

/**
 * One super admin action (the Audit log page): who did what, to what, why,
 * and what it looked like before and after. Append-only: once written, an
 * event is never edited or deleted - a later decision creates a new event.
 * The hooks below refuse updates and deletes made through Mongoose.
 *
 * Write events with src/utils/audit.js (recordAudit), never directly.
 */
const AREAS = ['moderation', 'feeds', 'chats', 'members', 'groups', 'sparks', 'roles', 'settings', 'auth', 'quests', 'payments'];

const auditEventSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true }, // shown as EV-<number>
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // The actor's role when they acted (kept even if it changes later).
    actorRole: { type: String, default: 'super_admin' },
    // What happened, as a key: 'post.remove', 'report.dismiss', 'admin.invite'...
    action: { type: String, required: true, trim: true, maxlength: 80 },
    area: { type: String, enum: AREAS, required: true },
    // What it was done to.
    target: {
      type: { type: String, default: null }, // post, comment, message, user, group, report, settings, admin
      id: { type: String, default: null },
      label: { type: String, default: null, maxlength: 200 }, // "F-2812 · @ticketboost"
    },
    reason: { type: String, default: '', trim: true, maxlength: 1000 },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    evidence: { type: mongoose.Schema.Types.Mixed, default: null },
    report: { type: mongoose.Schema.Types.ObjectId, ref: 'Report', default: null },
    // Anything else worth keeping (e.g. "the author was notified").
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

// EV-<number> lookups, and numbers are never reused.
auditEventSchema.index({ number: 1 }, { unique: true });
// The Audit log page: newest first, filtered by admin and/or area.
auditEventSchema.index({ createdAt: -1 });
auditEventSchema.index({ actor: 1, createdAt: -1 });
auditEventSchema.index({ area: 1, createdAt: -1 });
// "What happened to this post / person": events about one target.
auditEventSchema.index({ 'target.type': 1, 'target.id': 1, createdAt: -1 });

function refuse() {
  throw Object.assign(new Error('Audit events cannot be changed or deleted.'), { status: 409 });
}
// Append-only: an existing event can't be saved again, updated or deleted.
auditEventSchema.pre('save', function onlyNew() {
  if (!this.isNew) refuse();
});
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  auditEventSchema.pre(op, refuse);
}

auditEventSchema.statics.AREAS = AREAS;

module.exports = mongoose.model('AuditEvent', auditEventSchema);
