const mongoose = require('mongoose');

/**
 * A card dispute (chargeback) on one of our payments, from Stripe's webhook.
 * The money moves are in the ledger (5020 Chargebacks); this is the case file
 * admins review (Admin > Ledger & approvals > Disputes).
 */
const disputeSchema = new mongoose.Schema(
  {
    stripeDisputeId: { type: String, required: true },
    paymentIntentId: { type: String, default: null },
    chargeId: { type: String, default: null },
    amount: { type: Number, required: true }, // cents
    currency: { type: String, default: 'USD' },
    reason: { type: String, default: '' }, // Stripe's: fraudulent, product_not_received...
    status: { type: String, default: 'needs_response' }, // Stripe's dispute status
    outcome: { type: String, enum: ['open', 'won', 'lost'], default: 'open' },
    paymentType: { type: String, enum: ['ticket', 'coscoin', 'unknown'], default: 'unknown' },
    order: { type: mongoose.Schema.Types.ObjectId, default: null }, // Order or CostcoinOrder
    orderLabel: { type: String, default: null }, // ORD-1042 / CC-1001
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    walletFrozen: { type: Boolean, default: false },
    evidenceDueBy: { type: Date, default: null },
    openedAt: { type: Date, default: Date.now },
    closedAt: { type: Date, default: null },
    history: { type: [{ _id: false, at: { type: Date, default: Date.now }, event: String, detail: String }], default: [] },
  },
  { timestamps: true }
);

disputeSchema.index({ stripeDisputeId: 1 }, { unique: true });
disputeSchema.index({ outcome: 1, openedAt: -1 });

module.exports = mongoose.model('Dispute', disputeSchema);
