const mongoose = require('mongoose');

/**
 * One purchase (one ticket, for now). The webhook from Stripe is the ONLY
 * thing that turns a paid order into "paid" (src/utils/tickets.js fulfil):
 * the app's return page proves nothing.
 *
 *   pending    checkout open; one seat held until holdExpiresAt
 *   paid       Stripe confirmed (amount and currency checked) -> ticket issued
 *   free       a free ticket, issued at once
 *   expired    not paid in time; the seat went back on sale
 *   failed     could not start (e.g. Stripe unreachable); the seat went back
 *   refunded   money returned (by the member, an admin, or automatically)
 *   cancelled  a free ticket given back
 */
const STATUSES = ['pending', 'paid', 'free', 'expired', 'failed', 'refunded', 'cancelled'];

const orderSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true }, // shown as ORD-<number>
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    quest: { type: mongoose.Schema.Types.ObjectId, ref: 'Quest', required: true, index: true },
    ticketType: { type: mongoose.Schema.Types.ObjectId, ref: 'TicketType', required: true },
    quantity: { type: Number, default: 1, min: 1, max: 1 },
    amount: {
      amount: { type: Number, required: true, min: 0 },
      currency: { type: String, required: true, uppercase: true },
    },
    status: { type: String, enum: STATUSES, default: 'pending', index: true },
    // How it's paid: Stripe's page (website) or the payment sheet inside the app.
    method: { type: String, enum: ['checkout', 'sheet'], default: 'checkout' },
    // Where Stripe's page sends the person back: the app, or the website checkout.
    returnTo: { type: String, enum: ['app', 'web'], default: 'app' },
    // Whether this order still holds a seat (pending, not yet released).
    holding: { type: Boolean, default: false },
    holdExpiresAt: { type: Date, default: null },
    stripe: {
      checkoutSessionId: { type: String, default: null },
      checkoutUrl: { type: String, default: null },
      paymentIntentId: { type: String, default: null },
      refundId: { type: String, default: null },
    },
    paidAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    refundReason: { type: String, default: null, maxlength: 500 },
    refundedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Paid but no ticket can be issued (sold out, cancelled, ended, already
    // had one): the refund still owed, and why. Set before asking Stripe and
    // cleared once refunded, so a failed refund is retried (webhook retry,
    // reconciler) instead of leaving a paid order with no ticket.
    refundDue: { type: String, default: null, maxlength: 300 },
    // When the reconciler last asked Stripe about this order.
    lastCheckedAt: { type: Date, default: null },
    // What happened, in order (for support and the admin page).
    history: {
      type: [{ _id: false, at: { type: Date, default: Date.now }, event: String, detail: String }],
      default: [],
    },
  },
  { timestamps: true }
);

// ORD-<number> lookups.
orderSchema.index({ number: 1 }, { unique: true });
// One OPEN checkout per person per quest: a retry reuses it (no double charge).
orderSchema.index({ user: 1, quest: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });
// Stripe session -> order (webhooks).
orderSchema.index({ 'stripe.checkoutSessionId': 1 }, { unique: true, partialFilterExpression: { 'stripe.checkoutSessionId': { $type: 'string' } } });
orderSchema.index({ 'stripe.paymentIntentId': 1 }, { partialFilterExpression: { 'stripe.paymentIntentId': { $type: 'string' } } });
// The reconciler: pending orders past their hold.
orderSchema.index({ status: 1, holdExpiresAt: 1 });
// Admin: orders by quest, newest first.
orderSchema.index({ quest: 1, createdAt: -1 });

orderSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model('Order', orderSchema);
