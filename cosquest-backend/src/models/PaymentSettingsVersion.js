const mongoose = require('mongoose');

/**
 * The money settings (finance's "Assumptions" sheet), one document per
 * approved version: f1, f2... Append-only, like the ledger: a change is a new
 * version, never an edit, so a settlement can always say which version it
 * used (the ledger's Formula version column).
 *
 *   platformShareBps          CosQuest's share of a quest pool, in basis points
 *                             (3000 = 30%); null = OPEN (Mark hasn't decided)
 *   payoutApprovalLimitCents  payouts above this need a second admin; null = OPEN
 *
 * Changed only through an approved ApprovalRequest (kind 'payment_settings').
 * The Stripe fee is not a setting: the ledger records Stripe's real fee.
 */
const paymentSettingsVersionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true }, // shown as f<version>
    platformShareBps: { type: Number, default: null, min: 0, max: 10000, validate: { validator: (v) => v === null || Number.isInteger(v), message: 'platformShareBps must be a whole number.' } },
    payoutApprovalLimitCents: { type: Number, default: null, min: 0, validate: { validator: (v) => v === null || Number.isInteger(v), message: 'payoutApprovalLimitCents must be a whole number.' } },
    note: { type: String, default: '', maxlength: 500 },
    approval: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovalRequest', required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

paymentSettingsVersionSchema.index({ version: 1 }, { unique: true });
paymentSettingsVersionSchema.index({ approval: 1 }, { unique: true });

// Append-only.
const refuse = function refuse(next) {
  next(new Error('Payment settings are append-only: approve a new version instead.'));
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  paymentSettingsVersionSchema.pre(op, refuse);
}
paymentSettingsVersionSchema.pre('save', function onlyNew(next) {
  if (!this.isNew) return next(new Error('Payment settings are append-only: approve a new version instead.'));
  return next();
});

module.exports = mongoose.model('PaymentSettingsVersion', paymentSettingsVersionSchema);
