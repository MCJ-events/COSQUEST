const mongoose = require('mongoose');

/**
 * A quest's results: who won, in which place, and a prize note (e.g. "$50,
 * paid at the venue"). Prize money is handed out by the team, not the app
 * (payouts wait for Stripe's approval and the legal review). Only people who
 * were checked in can win. Draft until published; publishing tells the
 * winners (notification + push) and shows the place on their ticket.
 */
const winnerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
    place: { type: Number, required: true, min: 1, max: 100 },
    prizeNote: { type: String, default: '', maxlength: 200 },
    // The prize in cents (0 = none): publishing creates a PrizeClaim to claim and pay out.
    prizeCents: { type: Number, default: 0, min: 0 },
    // Verified points when the results come from the points ranking.
    points: { type: Number, default: null },
  },
  { _id: false }
);

const questResultSchema = new mongoose.Schema(
  {
    quest: { type: mongoose.Schema.Types.ObjectId, ref: 'Quest', required: true },
    winners: { type: [winnerSchema], default: [] },
    publishedAt: { type: Date, default: null },
    // Filled from the points ranking (questRanking.js), with the quest's scoring version.
    rankedFromPoints: { type: Boolean, default: false },
    scoringVersion: { type: Number, default: null },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

questResultSchema.index({ quest: 1 }, { unique: true });

module.exports = mongoose.model('QuestResult', questResultSchema);
