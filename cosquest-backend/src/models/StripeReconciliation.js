const mongoose = require('mongoose');

/**
 * The daily check of our books against Stripe's own records (one per UTC day).
 * problems: what doesn't match (a payment missing in the ledger, a different
 * amount, a missing fee, a sale Stripe never received). totals: side by side.
 */
const stripeReconciliationSchema = new mongoose.Schema(
  {
    day: { type: String, required: true }, // YYYY-MM-DD (UTC)
    ok: { type: Boolean, default: true },
    ranAt: { type: Date, default: Date.now },
    totals: { type: mongoose.Schema.Types.Mixed, default: {} },
    problems: { type: [{ _id: false, kind: String, ref: String, detail: String }], default: [] },
    error: { type: String, default: null },
  },
  { timestamps: true }
);

stripeReconciliationSchema.index({ day: 1 }, { unique: true });

module.exports = mongoose.model('StripeReconciliation', stripeReconciliationSchema);
