// Settling a quest's prize pool when results are published (lock-in WE3).
// Money book, kinds the finance checks already know:
//   settlement.winner    debit 2010 Quest Pool / credit 2020 Payouts Payable   (the prizes)
//                        when prizes are bigger than the pool, the difference is
//                        debit 5030 Prizes funded by CosQuest
//   settlement.platform  debit 2010 Quest Pool / credit 4020 Platform Fees     (what is left)
// The pool ends at zero; each entry saves the money settings version (formula f1, f2...).
// A prize that is never paid (forfeited or rejected) goes back: debit 2020 / credit 4020.
const LedgerTransaction = require('../models/LedgerTransaction');
const ledger = require('./ledger');

async function poolBalance(questId) {
  const accounts = [`2010:${questId}`, `quest_pool:${questId}`];
  const [row] = await LedgerTransaction.aggregate([{ $unwind: '$lines' }, { $match: { 'lines.account': { $in: accounts } } }, { $group: { _id: null, credit: { $sum: '$lines.credit' }, debit: { $sum: '$lines.debit' } } }]);
  return row ? (row.credit || 0) - (row.debit || 0) : 0;
}

async function settle(quest, result, admin) {
  const prizes = (result.winners || []).reduce((s, w) => s + (w.prizeCents || 0), 0);
  const pool = await poolBalance(quest._id);
  const settings = await require('./paymentSettings').current();
  const formulaVersion = settings.formulaVersion || null;
  const currency = (quest.prizePool?.currency || quest.entryFee?.currency || 'USD').toUpperCase();
  const fromPool = Math.max(0, Math.min(pool, prizes));
  const shortfall = prizes - fromPool;
  if (prizes > 0) {
    await ledger.record({
      key: `settlement-winner-${quest._id}`,
      kind: 'settlement.winner',
      book: 'money',
      currency,
      lines: [
        ...(fromPool > 0 ? [{ account: ledger.ACCOUNTS.questPool(quest._id), debit: fromPool }] : []),
        ...(shortfall > 0 ? [{ account: '5030', debit: shortfall }] : []),
        { account: ledger.ACCOUNTS.payoutsPayable, credit: prizes },
      ],
      quest: quest._id,
      memo: `Prizes for ${quest.title} (${(result.winners || []).filter((w) => w.prizeCents > 0).length} winner(s))${shortfall > 0 ? `, ${shortfall} cents funded by CosQuest` : ''}`.slice(0, 300),
      formulaVersion,
      createdBy: admin?._id || null,
    });
  }
  const rest = pool - fromPool;
  if (rest > 0) {
    await ledger.record({
      key: `settlement-platform-${quest._id}`,
      kind: 'settlement.platform',
      book: 'money',
      currency,
      lines: [{ account: ledger.ACCOUNTS.questPool(quest._id), debit: rest }, { account: '4020', credit: rest }],
      quest: quest._id,
      memo: `Platform share of ${quest.title} (what is left after prizes)`.slice(0, 300),
      formulaVersion,
      createdBy: admin?._id || null,
    });
  }
  return { pool, prizes, platform: rest, shortfall, formulaVersion };
}

/** A prize that will never be paid goes back to the platform (once). */
async function unpaidPrize(claim, why) {
  if (!(await ledger.findByKey(`settlement-winner-${claim.quest}`))) return null;
  return ledger.record({
    key: `prize-unpaid-${claim._id}`,
    kind: 'prize.forfeited',
    book: 'money',
    currency: claim.currency || 'USD',
    lines: [{ account: ledger.ACCOUNTS.payoutsPayable, debit: claim.amountCents }, { account: '4020', credit: claim.amountCents }],
    user: claim.user,
    quest: claim.quest,
    memo: `PC-${claim.number} ${why}: back to the platform`.slice(0, 300),
  });
}

module.exports = { settle, poolBalance, unpaidPrize };
