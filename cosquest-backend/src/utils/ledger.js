// The financial ledger (payment brief 6.1). See src/models/LedgerTransaction.js.
//
//   record()       one balanced transaction, once per key (repeats return the first)
//   reverse()      corrects one: a new transaction with debits and credits swapped
//   recordOrder()  a ticket order's money: the sale when paid, the refund when refunded
//   syncDue()      fills in orders whose entries are missing (e.g. a crash between steps)
//   check()        debits = credits for every book and currency; logs an alert if not
//   balances()     per account
//
// Ticket money (book 'money'): a paid entry fee is booked to that quest's
// prize pool (brief 5: "funds are booked to that quest's prize pool"). The
// platform's share is taken only at settlement, by the prize formula saved on
// the quest (not built: the formula isn't approved yet).
//   sale:    debit 1010 Stripe Clearing     credit 2010 Quest Pool <quest>
//   refund:  debit 2010 Quest Pool <quest>  credit 1010 Stripe Clearing
// Account codes: finance's chart of accounts (src/utils/ledgerAccounts.js).
const LedgerTransaction = require('../models/LedgerTransaction');
const Counter = require('../models/Counter');

// New entries use the chart's codes (1010, 2010:<questId>, ...); entries
// written before keep their old names and are read under the new codes.
const chart = require('./ledgerAccounts');
const ACCOUNTS = {
  ...chart.ACCOUNTS,
  // The names this file used before, so other code keeps working.
  processorClearing: chart.ACCOUNTS.stripeClearing,
  platformRevenue: chart.ACCOUNTS.platformFees,
  userCosCoin: chart.ACCOUNTS.wallet,
};

const label = (tx) => `TX-${tx.number}`;

// Finance's "Type" column for each kind of entry (the sample ledger's words).
const TYPES = {
  'ticket.sale': 'Quest entry',
  'ticket.refund': 'Quest entry refund',
  'stripe.fee': 'Processor fee',
  'costcoin.purchase': 'CosCoin purchase',
  'costcoin.issue': 'Purchase',
  'costcoin.spend': 'Spend',
  'costcoin.reward': 'Reward',
  'costcoin.clawback': 'Clawback',
  'costcoin.clawback_returned': 'Clawback returned',
  'costcoin.adjustment': 'Adjustment',
  'prize.payable': 'Prize payable',
  'prize.paid': 'Prize paid',
  'settlement.platform': 'Settlement: platform share',
  'settlement.winner': 'Settlement: winner share',
  payout: 'Payout',
  'dispute.withdrawn': 'Chargeback',
  'dispute.reinstated': 'Chargeback won',
  reversal: 'Reversal',
};
const typeOf = (kind) => TYPES[kind] || kind;
// The same cents Stripe was asked for (src/utils/stripe.js).
const toMinor = (amount, currency) => require('./stripe').toMinor(amount, currency);

/** Records a balanced transaction once (by key). Returns { tx, created }. */
async function record({ key, kind, book, currency, lines, user = null, quest = null, order = null, jurisdiction = null, processorRef = null, priceVersion = null, memo = '', reverses = null, createdBy = null, itemId = null, formulaVersion = null, approvedBy = [], linkedTx = null }) {
  const existing = await LedgerTransaction.findOne({ key });
  if (existing) return { tx: existing, created: false };
  try {
    const tx = await LedgerTransaction.create({
      number: await Counter.next('ledger', 1),
      key, kind, book, currency, lines, user, quest, order, jurisdiction, processorRef, priceVersion, memo, reverses, createdBy,
      itemId, formulaVersion, approvedBy, linkedTx,
    });
    return { tx, created: true };
  } catch (error) {
    if (error?.code === 11000) {
      const won = await LedgerTransaction.findOne({ key });
      if (won) return { tx: won, created: false };
    }
    throw error;
  }
}

/** Corrects a transaction: debits and credits swapped (once per transaction). */
async function reverse(txId, { reason, by = null, approvedBy = [] }) {
  const original = await LedgerTransaction.findById(txId);
  if (!original) throw Object.assign(new Error('Ledger transaction not found.'), { status: 404 });
  if (original.reverses) throw Object.assign(new Error('A reversal cannot itself be reversed: record a new correction.'), { status: 409 });
  const result = await record({
    key: `reverse-${original._id}`,
    kind: 'reversal',
    book: original.book,
    currency: original.currency,
    lines: original.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })),
    user: original.user,
    quest: original.quest,
    order: original.order,
    jurisdiction: original.jurisdiction,
    processorRef: original.processorRef,
    memo: `Reverses ${label(original)}: ${String(reason || '').slice(0, 400)}`,
    reverses: original._id,
    createdBy: by,
    approvedBy,
  });
  if (!result.created) throw Object.assign(new Error(`${label(original)} was already reversed.`), { status: 409 });
  return result.tx;
}

/** A ticket order's money in the ledger (safe to call any number of times). */
async function recordOrder(orderOrId) {
  const Order = require('../models/Order');
  // An order, or its id (an ObjectId has an _id too, so ask the model).
  const order = orderOrId instanceof Order ? orderOrId : await Order.findById(orderOrId);
  if (!order || !order.amount?.amount || !order.paidAt) return [];
  const amount = toMinor(order.amount.amount, order.amount.currency);
  const currency = order.amount.currency;
  const pool = ACCOUNTS.questPool(order.quest);
  const refs = { user: order.user, quest: order.quest, order: order._id, processorRef: order.stripe?.paymentIntentId || null };
  const done = [];
  done.push(await record({
    key: `order-paid-${order._id}`,
    kind: 'ticket.sale',
    book: 'money',
    currency,
    lines: [{ account: ACCOUNTS.processorClearing, debit: amount }, { account: pool, credit: amount }],
    memo: `ORD-${order.number} entry fee`,
    ...refs,
  }));
  // Stripe's real fee on it (finance's "Processor fee" row), once Stripe has it.
  const fee = await recordFee(order, done[0]?.tx).catch((error) => {
    console.warn(`[ledger] ORD-${order.number}: Stripe fee not recorded yet:`, error.message);
    return null;
  });
  if (fee) done.push(fee);
  if (order.status === 'refunded') {
    done.push(await record({
      key: `order-refund-${order._id}`,
      kind: 'ticket.refund',
      book: 'money',
      currency,
      lines: [{ account: pool, debit: amount }, { account: ACCOUNTS.processorClearing, credit: amount }],
      memo: `ORD-${order.number} refunded${order.refundReason ? `: ${order.refundReason}` : ''}`.slice(0, 500),
      ...refs,
    }));
  }
  return done;
}

/**
 * The real Stripe fee of a paid order, as finance's "Processor fee" row
 * (sample T-0002): debit 5010 Stripe Fees, credit 1010 Stripe Clearing, linked
 * to the sale. Stripe knows it once the charge has its balance transaction;
 * until then nothing is recorded and syncDue asks again (payments of the last
 * 30 days only). On a refund Stripe keeps its fee, so the fee entry stays.
 */
async function recordFee(order, saleTx) {
  const paymentIntentId = order.stripe?.paymentIntentId;
  if (!paymentIntentId || !order.paidAt || Date.now() - new Date(order.paidAt).getTime() > 30 * 24 * 3600e3) return null;
  const key = `order-fee-${order._id}`;
  if (await LedgerTransaction.exists({ key })) return null;
  const payments = require('./stripe');
  if (!payments.isConfigured()) return null;
  const intent = await payments.stripe().paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge.balance_transaction'] });
  const balance = intent?.latest_charge?.balance_transaction;
  if (!balance || typeof balance !== 'object' || !Number.isInteger(balance.fee) || balance.fee <= 0) return null;
  return record({
    key,
    kind: 'stripe.fee',
    book: 'money',
    currency: String(balance.currency || order.amount.currency).toUpperCase(),
    lines: [{ account: ACCOUNTS.stripeFees, debit: balance.fee }, { account: ACCOUNTS.stripeClearing, credit: balance.fee }],
    memo: `Stripe fee on ORD-${order.number}`,
    user: order.user,
    quest: order.quest,
    order: order._id,
    processorRef: paymentIntentId,
    linkedTx: saleTx?._id || null,
  });
}

/** Fire and forget from the payment code: a ledger hiccup never blocks a payment; syncDue fills it in. */
function recordOrderLater(orderOrId) {
  recordOrder(orderOrId).catch((error) => console.error('[ledger] order not recorded yet (syncDue will retry):', error.message));
}

/**
 * Paid / refunded orders whose ledger entries are missing, most recently
 * changed first (a refund weeks after the sale changes the order then), a
 * batch at a time.
 */
async function syncDue({ limit = 200 } = {}) {
  const Order = require('../models/Order');
  const orders = await Order.find({ paidAt: { $ne: null }, 'amount.amount': { $gt: 0 }, status: { $in: ['paid', 'refunded'] } }).sort({ updatedAt: -1 }).limit(limit);
  let added = 0;
  for (const order of orders) {
    const results = await recordOrder(order).catch((error) => {
      console.error(`[ledger] ORD-${order.number}:`, error.message);
      return [];
    });
    added += results.filter((r) => r.created).length;
  }
  return added;
}

/** Debits = credits per book and currency. { ok, books: [{ book, currency, debits, credits }] } */
async function check() {
  // Totals per transaction first, then per book: counting, not collecting,
  // the transactions (a set of every id would outgrow MongoDB's 16 MB limit).
  const rows = await LedgerTransaction.aggregate([
    { $project: { book: 1, currency: 1, debits: { $sum: '$lines.debit' }, credits: { $sum: '$lines.credit' } } },
    { $group: { _id: { book: '$book', currency: '$currency' }, debits: { $sum: '$debits' }, credits: { $sum: '$credits' }, transactions: { $sum: 1 } } },
  ]);
  const books = rows.map((r) => ({ book: r._id.book, currency: r._id.currency, debits: r.debits, credits: r.credits, transactions: r.transactions, balanced: r.debits === r.credits }));
  const balanced = books.every((b) => b.balanced);
  if (!balanced) console.error('[ledger] ALERT: debits and credits differ', JSON.stringify(books.filter((b) => !b.balanced)));
  // Finance's checks (the sample ledger's Balances sheet).
  const checks = await financeChecks().catch((error) => [{ name: 'Finance checks', pass: false, detail: `Could not run: ${error.message}` }]);
  const failed = checks.filter((c) => c.pass === false);
  if (failed.length) console.error('[ledger] ALERT: finance checks failed', JSON.stringify(failed));
  return { ok: balanced && !failed.length, books, checks, checkedAt: new Date() };
}

/**
 * Finance's checks (CosQuest Sample Ledger, "Balances and checks"):
 * { name, pass: true | false | null (not applicable yet), detail }.
 */
async function financeChecks() {
  const all = await balances();
  const money = all.filter((r) => r.book === 'money');
  const coins = all.filter((r) => r.book === 'costcoin');
  const sum = (rows, key) => rows.reduce((total, r) => total + r[key], 0);
  const checks = [];
  const cash = sum(money, 'debits') - sum(money, 'credits');
  checks.push({ name: 'Cash book: total debits equal total credits', pass: cash === 0, detail: cash });
  const coinDiff = sum(coins, 'debits') - sum(coins, 'credits');
  checks.push({ name: 'CosCoin book: debits equal credits', pass: coinDiff === 0, detail: coinDiff });
  const unknown = all.filter((r) => r.type === 'Unknown').map((r) => r.account);
  checks.push({ name: 'Every ledger row uses an account from the chart', pass: !unknown.length, detail: unknown.length ? unknown.join(', ') : 0 });

  // Quest pools: zero once a quest is settled or cancelled (everything paid out or refunded).
  const pools = money.filter((r) => r.code === '2010');
  const poolQuest = (p) => p.account.slice(5);
  const settled = new Set((await LedgerTransaction.distinct('quest', { kind: /^settlement\./ })).map(String));
  const ids = pools.map(poolQuest).filter((id) => /^[a-f\d]{24}$/i.test(id));
  const quests = ids.length ? await require('../models/Quest').find({ _id: { $in: ids } }, 'status endsAt').lean() : [];
  const cancelled = new Set(quests.filter((q) => q.status === 'cancelled').map((q) => String(q._id)));
  const ended = new Set(quests.filter((q) => q.status !== 'cancelled' && new Date(q.endsAt) <= new Date()).map((q) => String(q._id)));
  const closedPools = pools.filter((p) => settled.has(poolQuest(p)) || cancelled.has(poolQuest(p)));
  const notEmpty = closedPools.filter((p) => p.balance !== 0);
  const waiting = pools.filter((p) => ended.has(poolQuest(p)) && !settled.has(poolQuest(p)) && p.balance !== 0);
  checks.push({
    name: 'Quest pools are zero after settlement (or cancellation)',
    pass: closedPools.length ? !notEmpty.length : null,
    detail: notEmpty.length ? notEmpty.map((p) => `${p.label}: ${p.balance}`).join('; ') : `${waiting.length} ended quest(s) waiting for settlement (the prize formula isn't approved yet)`,
  });

  // Payouts: never more than the winner shares approved.
  const payable = money.find((r) => r.code === '2020');
  checks.push({
    name: 'Payouts payable is never below zero (paid out at most what was won)',
    pass: payable ? payable.balance >= 0 : null,
    detail: payable ? `${payable.balance} cents approved, not yet paid out` : 'No payouts yet',
  });

  // CosCoin: what wallets hold = coins issued - coins spent, and no wallet below zero.
  const issued = coins.find((r) => r.code === 'CC-ISSUED');
  const spent = coins.find((r) => r.code === 'CC-SPENT');
  const wallets = coins.filter((r) => r.code === 'CC-WALLET');
  const held = sum(wallets, 'balance');
  // Coins earned in games come in through CosCoin Rewards.
  const rewarded = coins.find((r) => r.code === 'CC-REWARDS');
  // Coins added or removed by admins come in through CosCoin Adjustments.
  const adjusted = coins.find((r) => r.code === 'CC-ADJUST');
  const expected = (issued?.balance || 0) + (rewarded?.balance || 0) + (adjusted?.balance || 0) - (spent?.balance || 0);
  checks.push({ name: 'Wallets equal coins issued and rewarded minus coins spent', pass: coins.length ? held === expected : null, detail: coins.length ? held - expected : 'No CosCoin yet' });
  // A wallet goes below zero only when a chargeback took back coins already spent (it owes coins and stays frozen).
  const clawed = new Set((await LedgerTransaction.distinct('user', { kind: 'costcoin.clawback' })).map(String));
  const owed = wallets.filter((r) => r.balance < 0 && clawed.has(r.account.slice('CC-WALLET:'.length)));
  const below = [...wallets.filter((r) => !owed.includes(r)), ...pools].filter((r) => r.balance < 0);
  checks.push({
    name: 'No wallet or quest pool is below zero (except coins owed after a chargeback)',
    pass: !below.length,
    detail: below.length ? below.map((r) => `${r.label}: ${r.balance}`).join('; ') : owed.length ? `${owed.length} wallet(s) owe coins after a chargeback (frozen)` : 0,
  });
  return checks;
}

// The background job checks the books at most once an hour.
let lastCheck = 0;
async function checkDue() {
  if (Date.now() - lastCheck < 60 * 60 * 1000) return null;
  lastCheck = Date.now();
  // Once a day after 02:00 UTC: yesterday's payments checked against Stripe (stripeReconcile.js).
  require('./stripeReconcile').runDue().catch((error) => console.error('[stripe-check] failed:', error.message));
  // Prizes not claimed by their deadline are forfeited (published rule).
  require('./prizes').forfeitDue().catch((error) => console.error('[prizes] forfeit failed:', error.message));
  return check();
}

/**
 * Balance per chart account, optionally one book and one account (prefix,
 * e.g. 2010:<questId>; an old name works too). Old and new names are merged;
 * the balance is on the account's normal side (finance's Balances sheet).
 */
async function balances({ book = null, prefix = null } = {}) {
  const match = book ? { book } : {};
  const rows = await LedgerTransaction.aggregate([
    { $match: match },
    { $unwind: '$lines' },
    { $group: { _id: { account: '$lines.account', currency: '$currency', book: '$book' }, debits: { $sum: '$lines.debit' }, credits: { $sum: '$lines.credit' } } },
  ]);
  const raw = rows.map((r) => ({ account: r._id.account, book: r._id.book, currency: r._id.currency, debits: r.debits, credits: r.credits }));
  const merged = chart.mergeBalances(raw, { questLabels: await questLabels(raw.map((r) => chart.normalize(r.account))) });
  const want = prefix ? chart.normalize(String(prefix).replace(/[^a-z_:0-9-]/gi, '')) : null;
  return want ? merged.filter((r) => r.account.startsWith(want)) : merged;
}

// "2010 Quest Pool <title>": the quests' titles, for the accounts' labels.
async function questLabels(accounts) {
  const ids = [...new Set(accounts.filter((a) => a.startsWith('2010:')).map((a) => a.slice(5)))].filter((id) => /^[a-f\d]{24}$/i.test(id));
  if (!ids.length) return {};
  const quests = await require('../models/Quest').find({ _id: { $in: ids } }, 'title').lean();
  return Object.fromEntries(quests.map((q) => [String(q._id), q.title]));
}

function txJson(tx) {
  return {
    id: String(tx._id),
    number: label(tx),
    kind: tx.kind,
    type: typeOf(tx.kind),
    status: tx.status || 'posted',
    book: tx.book,
    currency: tx.currency,
    // The chart's code and name (old entries read under the new codes).
    lines: tx.lines.map((l) => ({ account: chart.normalize(l.account), label: chart.describe(l.account).label, debit: l.debit, credit: l.credit })),
    total: tx.lines.reduce((sum, l) => sum + l.debit, 0),
    user: tx.user ? String(tx.user) : null,
    quest: tx.quest ? String(tx.quest) : null,
    order: tx.order ? String(tx.order) : null,
    jurisdiction: tx.jurisdiction,
    processorRef: tx.processorRef,
    key: tx.key,
    priceVersion: tx.priceVersion,
    formulaVersion: tx.formulaVersion || null,
    itemId: tx.itemId || null,
    approvedBy: (tx.approvedBy || []).map(String),
    linkedTx: tx.linkedTx ? String(tx.linkedTx) : null,
    memo: tx.memo,
    reverses: tx.reverses ? String(tx.reverses) : null,
    createdAt: tx.createdAt,
  };
}

/** One entry by its key (lean), or null: lets callers repeat a request safely. */
async function findByKey(key) {
  return LedgerTransaction.findOne({ key }).lean();
}

module.exports = { findByKey, financeChecks, recordFee, TYPES, typeOf, CHART: chart.CHART, ACCOUNTS, record, reverse, recordOrder, recordOrderLater, syncDue, check, checkDue, balances, txJson, label };
