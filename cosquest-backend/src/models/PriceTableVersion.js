const mongoose = require('mongoose');

/**
 * The Costcoin price table (finance's "Price Table" sheet), one document per
 * approved version: v1, v2... Append-only: a change is a new version, never
 * an edit, so each purchase records the version it was sold at (the ledger's
 * Price version column).
 *
 *   bundles: [{ id: 'B-500', name, priceCents, costcoin, status, note }]
 *     status 'active': on sale; 'open': not decided yet (e.g. the starter
 *     pack's coin amount), shown to admins, never sold.
 *
 * Changed only through an approved ApprovalRequest (kind 'price_table').
 */
const bundleSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, maxlength: 24 },
    name: { type: String, required: true, maxlength: 40 },
    priceCents: { type: Number, required: true, min: 50, max: 100000, validate: Number.isInteger },
    costcoin: { type: Number, default: null, min: 1, validate: { validator: (v) => v === null || Number.isInteger(v), message: 'costcoin must be a whole number.' } },
    status: { type: String, enum: ['active', 'open'], default: 'active' },
    note: { type: String, default: '', maxlength: 200 },
  },
  { _id: false }
);

const priceTableVersionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true }, // shown as v<version>
    bundles: { type: [bundleSchema], required: true },
    approval: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovalRequest', required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

priceTableVersionSchema.index({ version: 1 }, { unique: true });
priceTableVersionSchema.index({ approval: 1 }, { unique: true });

const refuse = function refuse(next) {
  next(new Error('The price table is append-only: approve a new version instead.'));
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  priceTableVersionSchema.pre(op, refuse);
}
priceTableVersionSchema.pre('save', function onlyNew(next) {
  if (!this.isNew) return next(new Error('The price table is append-only: approve a new version instead.'));
  return next();
});

module.exports = mongoose.model('PriceTableVersion', priceTableVersionSchema);
