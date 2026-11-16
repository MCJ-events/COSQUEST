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
//   sale:    debit processor_clearing   credit quest_pool:<questId>
//   refund:  debit quest_pool:<questId> credit processor_clearing
const LedgerTransaction = require('../models/LedgerTransaction');
const Counter = require('../models/Counter');

const ACCOUNTS = {
  processorClearing: 'processor_clearing',
  platformRevenue: 'platform_revenue',
  questPool: (questId) => `quest_pool:${questId}`,
  payoutsPayable: 'payouts_payable',
  refunds: 'refunds',
  taxPayable: 'tax_payable',
  userCostcoin: (userId) => `user_costcoin:${userId}`,
  costcoinIssued: 'costcoin_issued',
  costcoinSpent: 'costcoin_spent',
};

const label = (tx) => `TX-${tx.number}`;
// The same cents Stripe was asked for (src/utils/stripe.js).
const toMinor = (amount, currency) => require('./stripe').toMinor(amount, currency);

/** Records a balanced transaction once (by key). Returns { tx, created }. */
async function record({ key, kind, book, currency, lines, user = null, quest = null, order = null, jurisdiction = null, processorRef = null, priceVersion = null, memo = '', reverses = null, createdBy = null }) {
  const existing = await LedgerTransaction.findOne({ key });
  if (existing) return { tx: existing, created: false };
  try {
    const tx = await LedgerTransaction.create({
      number: await Counter.next('ledger', 1),
      key, kind, book, currency, lines, user, quest, order, jurisdiction, processorRef, priceVersion, memo, reverses, createdBy,
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
async function reverse(txId, { reason, by = null }) {
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
  const ok = books.every((b) => b.balanced);
  if (!ok) console.error('[ledger] ALERT: debits and credits differ', JSON.stringify(books.filter((b) => !b.balanced)));
  return { ok, books, checkedAt: new Date() };
}

// The background job checks the books at most once an hour.
let lastCheck = 0;
async function checkDue() {
  if (Date.now() - lastCheck < 60 * 60 * 1000) return null;
  lastCheck = Date.now();
  return check();
}

/** Balance per account (debits minus credits), optionally one book. */
async function balances({ book = null, prefix = null } = {}) {
  const match = book ? { book } : {};
  const rows = await LedgerTransaction.aggregate([
    { $match: match },
    { $unwind: '$lines' },
    ...(prefix ? [{ $match: { 'lines.account': { $regex: `^${prefix.replace(/[^a-z_:0-9]/gi, '')}` } } }] : []),
    { $group: { _id: { account: '$lines.account', currency: '$currency', book: '$book' }, debits: { $sum: '$lines.debit' }, credits: { $sum: '$lines.credit' } } },
    { $sort: { '_id.account': 1 } },
  ]);
  return rows.map((r) => ({ account: r._id.account, book: r._id.book, currency: r._id.currency, debits: r.debits, credits: r.credits, balance: r.debits - r.credits }));
}

function txJson(tx) {
  return {
    id: String(tx._id),
    number: label(tx),
    kind: tx.kind,
    book: tx.book,
    currency: tx.currency,
    lines: tx.lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit })),
    total: tx.lines.reduce((sum, l) => sum + l.debit, 0),
    user: tx.user ? String(tx.user) : null,
    quest: tx.quest ? String(tx.quest) : null,
    order: tx.order ? String(tx.order) : null,
    jurisdiction: tx.jurisdiction,
    processorRef: tx.processorRef,
    key: tx.key,
    priceVersion: tx.priceVersion,
    memo: tx.memo,
    reverses: tx.reverses ? String(tx.reverses) : null,
    createdAt: tx.createdAt,
  };
}

module.exports = { ACCOUNTS, record, reverse, recordOrder, recordOrderLater, syncDue, check, checkDue, balances, txJson, label };
