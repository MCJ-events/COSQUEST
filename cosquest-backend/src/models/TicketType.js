const mongoose = require('mongoose');

/**
 * A kind of ticket for a quest or event (e.g. "General admission $10",
 * "VIP $25", "Free"). The seats are counted here, atomically:
 *   sold  tickets issued (paid or free)
 *   held  seats reserved by an open checkout (30 minutes, then released)
 * A checkout only starts if sold + held < quantity (one findOneAndUpdate),
 * so the last seat can never be sold twice.
 * Prices are whole currency units (10 = $10.00), like Quest.entryFee.
 */
const ticketTypeSchema = new mongoose.Schema(
  {
    // No `index: true`: { quest, sortOrder } below covers lookups by quest,
    // and a plain { quest: 1 } took the name the unique index needs.
    quest: { type: mongoose.Schema.Types.ObjectId, ref: 'Quest', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, default: '', trim: true, maxlength: 300 },
    price: {
      amount: { type: Number, required: true, min: 0 },
      currency: { type: String, default: () => (process.env.QUEST_CURRENCY || 'USD').toUpperCase(), uppercase: true },
    },
    quantity: { type: Number, required: true, min: 1 },
    sold: { type: Number, default: 0, min: 0 },
    held: { type: Number, default: 0, min: 0 },
    salesStartAt: { type: Date, default: null },
    salesEndAt: { type: Date, default: null }, // null = until the quest ends
    active: { type: Boolean, default: true },
    // The one made automatically from the quest's entry fee and places,
    // when an admin hasn't set ticket types up.
    isDefault: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// A quest's ticket types in order.
ticketTypeSchema.index({ quest: 1, sortOrder: 1 });
// At most one default ticket type per quest (created once, even under races).
// Named, so it never clashes with the plain quest_1 index older deploys built.
ticketTypeSchema.index({ quest: 1 }, { name: 'one_default_per_quest', unique: true, partialFilterExpression: { isDefault: true } });

module.exports = mongoose.model('TicketType', ticketTypeSchema);
