const mongoose = require('mongoose');

/**
 * A member's CosCoin balance (fast to read and to spend from). The CosCoin
 * ledger is the record of every coin; finance's check "wallets equal coins
 * issued minus coins spent" (ledger.financeChecks) catches any drift.
 *
 * Coins are never cash: never withdrawable, never used for paid quests.
 *
 *   applied   the keys of every credit / spend already applied (each once,
 *             even if a webhook or a retry repeats it)
 *   frozen    set on a chargeback: the coins can't be spent until an admin
 *             reviews it (payment brief)
 */
const walletSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    balance: { type: Number, default: 0, min: 0 },
    applied: { type: [String], default: [] },
    frozen: { type: Boolean, default: false },
    frozenReason: { type: String, default: null, maxlength: 300 },
    // Coins bought (the rest of the balance is earned in games): some items take bought coins only.
    purchased: { type: Number, default: 0, min: 0 },
    // Fraud flags (games, admins, disputes): the last 50.
    flags: { type: [{ _id: false, reason: String, by: String, at: { type: Date, default: Date.now } }], default: [] },
    // Rewards earned today (UTC), for the daily cap.
    rewardDay: { type: String, default: null },
    rewardToday: { type: Number, default: 0 },
  },
  { timestamps: true }
);

walletSchema.index({ user: 1 }, { unique: true });

module.exports = mongoose.model('Wallet', walletSchema);
