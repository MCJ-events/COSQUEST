const mongoose = require('mongoose');

/**
 * What a member owns, bought with CosCoin: one row per member and item.
 * Owned-once items have quantity 1; stackable ones (ammo) add up, and a game
 * uses them up with its own rules. Each purchase is in the CosCoin ledger.
 */
const itemOwnershipSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    itemId: { type: String, required: true, maxlength: 28 },
    kind: { type: String, default: 'other' },
    quantity: { type: Number, default: 0, min: 0 },
    firstAt: { type: Date, default: Date.now },
    lastAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

itemOwnershipSchema.index({ user: 1, itemId: 1 }, { unique: true });

module.exports = mongoose.model('ItemOwnership', itemOwnershipSchema);
