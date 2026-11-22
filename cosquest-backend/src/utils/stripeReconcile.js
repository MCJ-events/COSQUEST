// The daily check of our books against Stripe's own records (payment brief:
// reconciliation). Once a day, after 02:00 UTC, for yesterday:
//   - every payment Stripe received has its sale in the ledger, same amount
//     (tickets: "Quest entry", CosCoin: "CosCoin purchase"; matched by the
//     payment's id, the ledger's Processor ref)
//   - every sale we recorded that day was really paid in Stripe
//   - every payment's Stripe fee is in the ledger, same amount
//   - refunds, disputes and payouts: Stripe's totals beside ours
// Saved in StripeReconciliation (Admin > Ledger > Stripe check); problems are
// logged as an ALERT. Nothing is ever changed: this only reports.
const StripeReconciliation = require('../models/StripeReconciliation');
const LedgerTransaction = require('../models/LedgerTransaction');
const payments = require('./stripe');

const SALE_KINDS = ['ticket.sale', 'costcoin.purchase'];
const dayKey = (date) => date.toISOString().slice(0, 10);
const debitTotal = (tx) => tx.lines.reduce((sum, l) => sum + (l.debit || 0), 0);

/** Stripe's balance transactions of one UTC day, with each charge's payment id. */
async function stripeDay(day) {
  const start = Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000);
  const rows = [];
  const list = payments.stripe().balanceTransactions.list({ created: { gte: start, lt: start + 86400 }, limit: 100, expand: ['data.source'] });
  for await (const bt of list) {
    const source = bt.source && typeof bt.source === 'object' ? bt.source : null;
    rows.push({ id: bt.id, type: bt.type, amount: bt.amount, fee: bt.fee || 0, paymentIntent: source?.payment_intent && typeof source.payment_intent === 'object' ? source.payment_intent.id : source?.payment_intent || null });
  }
  return rows;
}

/**
 * Pure comparison (tested on its own).
 *   stripeRows: [{ type, amount, fee, paymentIntent }]
 *   sales: ledger sales (any day) for those payments + the sales recorded that day
 *   fees:  ledger fee entries for those payments
 *   paidInStripe(pi): for a sale Stripe's day list doesn't have (a payment just
 *     before midnight): asks Stripe; true if it was paid
 */
async function compare({ stripeRows, sales, fees, daySales, paidInStripe }) {
  const problems = [];
  const charges = stripeRows.filter((r) => (r.type === 'charge' || r.type === 'payment') && r.paymentIntent);
  const saleByPi = new Map();
  for (const tx of sales) if (tx.processorRef) saleByPi.set(tx.processorRef, (saleByPi.get(tx.processorRef) || 0) + debitTotal(tx));
  const feeByPi = new Map();
  for (const tx of fees) if (tx.processorRef) feeByPi.set(tx.processorRef, (feeByPi.get(tx.processorRef) || 0) + debitTotal(tx));

  for (const c of charges) {
    const ours = saleByPi.get(c.paymentIntent);
    if (ours === undefined) problems.push({ kind: 'missing_in_ledger', ref: c.paymentIntent, detail: `Stripe received ${c.amount} cents; no sale in the ledger` });
    else if (ours !== c.amount) problems.push({ kind: 'amount_differs', ref: c.paymentIntent, detail: `Stripe ${c.amount} cents, ledger ${ours} cents` });
    const fee = feeByPi.get(c.paymentIntent);
    if (c.fee > 0 && fee === undefined) problems.push({ kind: 'fee_missing', ref: c.paymentIntent, detail: `Stripe fee ${c.fee} cents not in the ledger` });
    else if (c.fee > 0 && fee !== c.fee) problems.push({ kind: 'fee_differs', ref: c.paymentIntent, detail: `Stripe fee ${c.fee} cents, ledger ${fee} cents` });
  }
  const stripePis = new Set(charges.map((c) => c.paymentIntent));
  for (const tx of daySales) {
    if (!tx.processorRef || stripePis.has(tx.processorRef)) continue;
    if (!(await paidInStripe(tx.processorRef))) problems.push({ kind: 'not_paid_in_stripe', ref: tx.processorRef, detail: `TX-${tx.number}: ${debitTotal(tx)} cents recorded, but Stripe has no payment` });
  }
  const sum = (rows, key = 'amount') => rows.reduce((s, r) => s + r[key], 0);
  const totals = {
    stripe: {
      payments: charges.length,
      received: sum(charges),
      fees: sum(charges, 'fee'),
      refunds: -sum(stripeRows.filter((r) => r.type === 'refund' || r.type === 'payment_refund')),
      disputes: -sum(stripeRows.filter((r) => r.type === 'adjustment' && r.amount < 0)),
      payoutsToBank: -sum(stripeRows.filter((r) => r.type === 'payout')),
    },
    ledger: { sales: daySales.length, received: sum(daySales.map((t) => ({ amount: debitTotal(t) }))) },
  };
  return { ok: !problems.length, problems, totals };
}

async function run(day) {
  if (!payments.isConfigured()) return null;
  let result;
  try {
    const stripeRows = await stripeDay(day);
    const pis = [...new Set(stripeRows.map((r) => r.paymentIntent).filter(Boolean))];
    const start = new Date(`${day}T00:00:00Z`);
    const end = new Date(start.getTime() + 86400e3);
    const [sales, fees, daySales] = await Promise.all([
      LedgerTransaction.find({ kind: { $in: SALE_KINDS }, processorRef: { $in: pis } }).lean(),
      LedgerTransaction.find({ kind: 'stripe.fee', processorRef: { $in: pis }, key: { $not: /^dispute-/ } }).lean(),
      LedgerTransaction.find({ kind: { $in: SALE_KINDS }, createdAt: { $gte: start, $lt: end } }).lean(),
    ]);
    const paidInStripe = async (pi) => {
      try {
        return (await payments.stripe().paymentIntents.retrieve(pi))?.status === 'succeeded';
      } catch {
        return false;
      }
    };
    result = await compare({ stripeRows, sales, fees, daySales, paidInStripe });
  } catch (error) {
    result = { ok: false, problems: [], totals: {}, error: error.message };
  }
  if (!result.ok) console.error(`[stripe-check] ALERT ${day}:`, result.error || JSON.stringify(result.problems.slice(0, 20)));
  await StripeReconciliation.updateOne({ day }, { $set: { ok: result.ok, problems: result.problems.slice(0, 500), totals: result.totals, error: result.error || null, ranAt: new Date() } }, { upsert: true });
  return { day, ...result };
}

/** Once a day after 02:00 UTC: yesterday, if not checked yet. */
let lastLook = 0;
async function runDue() {
  if (Date.now() - lastLook < 10 * 60 * 1000) return null;
  lastLook = Date.now();
  const now = new Date();
  if (now.getUTCHours() < 2) return null;
  const yesterday = dayKey(new Date(now.getTime() - 86400e3));
  if (await StripeReconciliation.exists({ day: yesterday })) return null;
  return run(yesterday);
}

async function recent(limit = 14) {
  const rows = await StripeReconciliation.find().sort({ day: -1 }).limit(limit).lean();
  return rows.map((r) => ({ day: r.day, ok: r.ok, problems: r.problems, totals: r.totals, error: r.error, ranAt: r.ranAt }));
}

module.exports = { run, runDue, recent, compare, dayKey };
