const mongoose = require('mongoose');

/**
 * A ticket (one per order). `code` is what the QR code shows: 128 random
 * bits, unguessable. Check-in is one atomic valid -> checked_in, so a
 * copied ticket only gets in once.
 */
const ticketSchema = new mongoose.Schema(
  {
    code: { type: String, required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    quest: { type: mongoose.Schema.Types.ObjectId, ref: 'Quest', required: true, index: true },
    ticketType: { type: mongoose.Schema.Types.ObjectId, ref: 'TicketType', required: true },
    status: { type: String, enum: ['valid', 'checked_in', 'refunded', 'cancelled'], default: 'valid', index: true },
    checkedInAt: { type: Date, default: null },
    checkedInBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

ticketSchema.index({ code: 1 }, { unique: true });
ticketSchema.index({ order: 1 }, { unique: true });
// One live ticket per person per quest.
ticketSchema.index({ user: 1, quest: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['valid', 'checked_in'] } } });

module.exports = mongoose.model('Ticket', ticketSchema);
