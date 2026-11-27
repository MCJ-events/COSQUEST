const mongoose = require('mongoose');

/**
 * One prize won by one member in one quest (PrizeClaim contract, 27 Nov 2026).
 * awaiting_claim -> submitted -> verified -> payout_requested -> held -> paid
 * (or forfeited after the claim deadline, or rejected with a reason).
 * Bank and tax numbers are only ever stored encrypted (utils/payeeCrypto.js);
 * the rest of the record shows the last 4 digits.
 */
const STATUSES = ['awaiting_claim', 'submitted', 'verified', 'payout_requested', 'held', 'paid', 'forfeited', 'rejected'];

const prizeClaimSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true }, // PC-<number>
    quest: { type: mongoose.Schema.Types.ObjectId, ref: 'Quest', required: true },
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    place: { type: Number, required: true },
    points: { type: Number, default: null },
    amountCents: { type: Number, required: true, min: 1 },
    currency: { type: String, default: 'USD' },
    scoringVersion: { type: Number, default: null },
    formulaVersion: { type: String, default: null },
    resultsPublishedAt: { type: Date, required: true },
    claimDeadline: { type: Date, required: true, index: true },
    status: { type: String, enum: STATUSES, default: 'awaiting_claim', index: true },
    identity: { legalName: { type: String, default: null }, dateOfBirth: { type: String, default: null }, confirmedAt: { type: Date, default: null } },
    payoutMethod: {
      type: { type: String, enum: ['ach', 'check', null], default: null },
      accountHolder: { type: String, default: null },
      routingLast4: { type: String, default: null },
      accountLast4: { type: String, default: null },
      mailingAddress: { type: String, default: null },
      encrypted: { type: String, default: null },
    },
    tax: {
      form: { type: String, enum: ['w9', 'w8ben', null], default: null },
      status: { type: String, enum: ['missing', 'received', 'verified'], default: 'missing' },
      tinLast4: { type: String, default: null },
      country: { type: String, default: null },
      encrypted: { type: String, default: null },
      receivedAt: { type: Date, default: null },
    },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null },
    approval: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovalRequest', default: null },
    holdUntil: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    paymentRef: { type: String, default: null },
    rejectedReason: { type: String, default: null },
    history: { type: [{ _id: false, at: { type: Date, default: Date.now }, status: String, by: String, note: String }], default: [] },
  },
  { timestamps: true }
);

prizeClaimSchema.index({ quest: 1, user: 1 }, { unique: true });
prizeClaimSchema.index({ number: 1 }, { unique: true });

prizeClaimSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], function noDelete(next) {
  next(new Error('Prize claims are never deleted.'));
});

module.exports = mongoose.model('PrizeClaim', prizeClaimSchema);
module.exports.STATUSES = STATUSES;
