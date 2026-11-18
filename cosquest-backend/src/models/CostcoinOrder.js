const mongoose = require('mongoose');

/**
 * One CosCoin bundle bought on the CosQuest website (Stripe Checkout).
 * Paid only by Stripe's signed webhook (or the reconciler asking Stripe),
 * like ticket orders. On payment the cash ledger gets the sale (1010 / 4010),
 * the CosCoin ledger the coins (CosCoin Issued / the member's Wallet),
 * linked together, and the wallet is credited once.
 *
 *   pending  -> paid | expired | failed | refunded
 */
const costcoinOrderSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true }, // shown as CC-<number>
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    bundleId: { type: String, required: true, maxlength: 24 },
    bundleName: { type: String, default: '', maxlength: 40 },
    priceVersion: { type: String, required: true, maxlength: 20 },
    priceCents: { type: Number, required: true, min: 50 },
    currency: { type: String, default: 'USD' },
    costcoin: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['pending', 'paid', 'expired', 'failed', 'refunded'], default: 'pending', index: true },
    expiresAt: { type: Date, required: true },
    paidAt: { type: Date, default: null },
    stripe: {
      checkoutSessionId: { type: String, default: null },
      checkoutUrl: { type: String, default: null },
      paymentIntentId: { type: String, default: null },
    },
    lastCheckedAt: { type: Date, default: null },
    history: { type: [{ _id: false, at: { type: Date, default: Date.now }, event: String, detail: String }], default: [] },
  },
  { timestamps: true }
);

costcoinOrderSchema.index({ number: 1 }, { unique: true });
costcoinOrderSchema.index({ 'stripe.checkoutSessionId': 1 }, { unique: true, partialFilterExpression: { 'stripe.checkoutSessionId': { $type: 'string' } } });
costcoinOrderSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model('CostcoinOrder', costcoinOrderSchema);
