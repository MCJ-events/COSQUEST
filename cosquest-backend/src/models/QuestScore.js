const mongoose = require('mongoose');

/**
 * A player's points in one quest (lock-in WE1): reported by the game server
 * (secret key) or entered by an admin with a reason. Only verified points
 * count in the ranking; every change is kept in history.
 */
const questScoreSchema = new mongoose.Schema(
  {
    quest: { type: mongoose.Schema.Types.ObjectId, ref: 'Quest', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
    points: { type: Number, required: true, min: 0 },
    completedAt: { type: Date, default: null },
    source: { type: String, enum: ['game', 'admin'], required: true },
    verified: { type: Boolean, default: false },
    history: { type: [{ _id: false, at: { type: Date, default: Date.now }, points: Number, completedAt: Date, source: String, by: String, reason: String }], default: [] },
  },
  { timestamps: true }
);

questScoreSchema.index({ quest: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('QuestScore', questScoreSchema);
