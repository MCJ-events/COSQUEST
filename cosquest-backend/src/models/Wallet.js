const mongoose = require('mongoose');

/**
 * A member's Costcoin balance (fast to read and to spend from). The Costcoin
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
  },
  { timestamps: true }
);

walletSchema.index({ user: 1 }, { unique: true });

module.exports = mongoose.model('Wallet', walletSchema);
