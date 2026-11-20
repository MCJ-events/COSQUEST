const mongoose = require('mongoose');

/**
 * The financial ledger (payment brief 6.1): double-entry and APPEND-ONLY.
 * One document = one transaction: lines whose debits equal their credits.
 * Nothing is ever edited or deleted; a mistake is corrected by a new
 * transaction that reverses it (src/utils/ledger.js reverse()).
 *
 *   book      'money' (USD and other real currencies) or 'costcoin'. Never mixed.
 *   amounts   integers in the smallest unit (cents; whole CosCoin).
 *   accounts  processor_clearing, platform_revenue, quest_pool:<questId>,
 *             payouts_payable, refunds, tax_payable, user_costcoin:<userId>,
 *             costcoin_issued, costcoin_spent (src/utils/ledger.js ACCOUNTS)
 *   key       idempotency key, unique: the same event is recorded once.
 */
const lineSchema = new mongoose.Schema(
  {
    account: { type: String, required: true, maxlength: 120 },
    debit: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    credit: { type: Number, default: 0, min: 0, validate: Number.isInteger },
  },
  { _id: false }
);

const ledgerTransactionSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true }, // shown as TX-<number>
    kind: { type: String, required: true, maxlength: 60 }, // ticket.sale, ticket.refund, reversal, ...
    book: { type: String, enum: ['money', 'costcoin'], required: true },
    currency: { type: String, required: true, uppercase: true, maxlength: 10 }, // USD, ... or CQC for CosCoin
    lines: { type: [lineSchema], required: true },
    // References (brief 6.1: user, quest, jurisdiction, processor, key, version).
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    quest: { type: mongoose.Schema.Types.ObjectId, ref: 'Quest', default: null },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    jurisdiction: { type: String, default: null, maxlength: 20 },
    processorRef: { type: String, default: null, maxlength: 200 },
    key: { type: String, required: true, maxlength: 200 },
    priceVersion: { type: String, default: null, maxlength: 60 },
    // The rest of finance's columns (CosQuest Sample Ledger):
    //   itemId          the bundle, skin or weapon (B-500, SK-07); tickets use the quest
    //   formulaVersion  the prize formula used at settlement (f0, f1...)
    //   status          every row is "posted"; a mistake is fixed by a new reversing row
    //   approvedBy      who approved it (payouts and money changes: two people)
    //   linkedTx        a CosCoin entry's cash payment (and the other way round)
    itemId: { type: String, default: null, maxlength: 60 },
    formulaVersion: { type: String, default: null, maxlength: 60 },
    status: { type: String, enum: ['posted'], default: 'posted' },
    approvedBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    linkedTx: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerTransaction', default: null },
    memo: { type: String, default: '', maxlength: 500 },
    reverses: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerTransaction', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ledgerTransactionSchema.index({ key: 1 }, { unique: true });
ledgerTransactionSchema.index({ number: 1 }, { unique: true });
ledgerTransactionSchema.index({ book: 1, createdAt: -1 });
ledgerTransactionSchema.index({ 'lines.account': 1, createdAt: -1 });
ledgerTransactionSchema.index({ order: 1 });
ledgerTransactionSchema.index({ linkedTx: 1 }, { partialFilterExpression: { linkedTx: { $type: 'objectId' } } });
// One reversal per transaction.
ledgerTransactionSchema.index({ reverses: 1 }, { unique: true, partialFilterExpression: { reverses: { $type: 'objectId' } } });

// Balanced, integers, at least two lines.
ledgerTransactionSchema.pre('validate', function balanced(next) {
  const lines = this.lines || [];
  const debits = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const credits = lines.reduce((sum, l) => sum + (l.credit || 0), 0);
  if (lines.length < 2) return next(new Error('A ledger transaction needs at least two lines.'));
  if (lines.some((l) => (l.debit > 0) === (l.credit > 0))) return next(new Error('Each ledger line is either a debit or a credit.'));
  if (debits !== credits || debits <= 0) return next(new Error(`Ledger transaction not balanced (debits ${debits}, credits ${credits}).`));
  return next();
});

// Append-only: no updates, no deletes, from anywhere in the code.
const refuse = function refuse(next) {
  next(new Error('The ledger is append-only: record a reversal instead.'));
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  ledgerTransactionSchema.pre(op, refuse);
}
ledgerTransactionSchema.pre('save', function onlyNew(next) {
  if (!this.isNew) return next(new Error('The ledger is append-only: record a reversal instead.'));
  return next();
});

module.exports = mongoose.model('LedgerTransaction', ledgerTransactionSchema);
