const mongoose = require('mongoose');

/**
 * Every Stripe webhook event handled, once (its id is the _id). Stripe
 * delivers at least once and retries, so a repeat is acknowledged and
 * skipped. Kept 90 days.
 */
const stripeEventSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // evt_...
    type: { type: String, required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    // false while a delivery is being handled; a second delivery meanwhile
    // is asked to retry instead of being told it's done.
    done: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now, expires: 90 * 24 * 60 * 60 },
  },
  { versionKey: false }
);

module.exports = mongoose.model('StripeEvent', stripeEventSchema);
