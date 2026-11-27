const mongoose = require('mongoose');

/**
 * What CosCoin can buy, one document per approved version (c1, c2...).
 * Append-only like the price table: a change is a new version, so each spend
 * records the catalog version its price came from.
 *
 *   items: [{ id: 'SK-07', name, kind, priceCosCoin, stackable, game, status, note }]
 *     kind: cosmetic | skin | weapon | ammo | bundle | faction_switch | other
 *           (never quest entry or XP: CosCoin can't buy those, payment brief)
 *     stackable: can be bought again and again (ammo); otherwise owned once
 *     game: all | social | costquest | trivia | parlay (where it's used)
 *     status 'active' on sale, 'open' not decided (never sold)
 *
 * Changed only through an approved ApprovalRequest (kind 'item_catalog').
 */
const KINDS = ['cosmetic', 'skin', 'weapon', 'ammo', 'bundle', 'faction_switch', 'other'];
const GAMES = ['all', 'social', 'costquest', 'trivia', 'parlay'];

const itemSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, maxlength: 28 },
    name: { type: String, required: true, maxlength: 60 },
    kind: { type: String, enum: KINDS, required: true },
    priceCosCoin: { type: Number, default: null, min: 1, validate: { validator: (v) => v === null || Number.isInteger(v), message: 'priceCosCoin must be a whole number.' } },
    stackable: { type: Boolean, default: false },
    // Only bought CosCoin can buy it (not coins earned in games).
    boughtCoinsOnly: { type: Boolean, default: false },
    // The Shop (Wale's design): picture, subtitle, which tab, NEW tag, when the offer ends,
    // and free rewards (Manny's Remix, claimed once per offer period).
    imageUrl: { type: String, default: '', maxlength: 500 },
    subtitle: { type: String, default: '', maxlength: 80 },
    section: { type: String, enum: ['elite_merch', 'remix', 'deals', 'wardrobe'], default: 'elite_merch' },
    newTag: { type: Boolean, default: false },
    dropEndsAt: { type: Date, default: null },
    free: { type: Boolean, default: false },
    game: { type: String, enum: GAMES, default: 'all' },
    status: { type: String, enum: ['active', 'open'], default: 'active' },
    note: { type: String, default: '', maxlength: 200 },
  },
  { _id: false }
);

const itemCatalogVersionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true }, // shown as c<version>
    items: { type: [itemSchema], required: true },
    approval: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovalRequest', required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

itemCatalogVersionSchema.index({ version: 1 }, { unique: true });
itemCatalogVersionSchema.index({ approval: 1 }, { unique: true });

const refuse = function refuse(next) {
  next(new Error('The item catalog is append-only: approve a new version instead.'));
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  itemCatalogVersionSchema.pre(op, refuse);
}
itemCatalogVersionSchema.pre('save', function onlyNew(next) {
  if (!this.isNew) return next(new Error('The item catalog is append-only: approve a new version instead.'));
  return next();
});

module.exports = mongoose.model('ItemCatalogVersion', itemCatalogVersionSchema);
module.exports.KINDS = KINDS;
module.exports.GAMES = GAMES;
