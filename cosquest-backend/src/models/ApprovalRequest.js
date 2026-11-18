const mongoose = require('mongoose');

/**
 * Two-person approval (payment brief 6.6): money settings change only when a
 * SECOND admin approves. The requester can never approve their own request.
 *
 *   kind     'region_rules' (now); later price tables, prize formulas, payouts
 *   changes  what will change, e.g. [{ region, name, status, note }]
 *   status   pending -> approved (applied) | rejected | withdrawn
 */
const approvalRequestSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true }, // AP-<number>
    kind: { type: String, enum: ['region_rules', 'payment_settings'], required: true },
    title: { type: String, required: true, maxlength: 160 },
    changes: { type: mongoose.Schema.Types.Mixed, required: true },
    reason: { type: String, required: true, maxlength: 500 },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'withdrawn'], default: 'pending', index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decisionNote: { type: String, default: '', maxlength: 500 },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

approvalRequestSchema.index({ number: 1 }, { unique: true });
approvalRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ApprovalRequest', approvalRequestSchema);
