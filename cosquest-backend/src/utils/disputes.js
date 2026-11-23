// Card disputes (chargebacks), from Stripe's webhook (charge.dispute.*).
//
//   opened:     the case is recorded; the money leaves Stripe, in the ledger:
//                 "Chargeback": debit 5020 Chargebacks / credit 1010 Stripe Clearing
//                 + Stripe's dispute fee: debit 5010 Stripe Fees / credit 1010
//               a CosCoin top-up: the member's wallet is frozen (no spending) until an
//               admin reviews it (payment brief)
//   won:        the money comes back: "Chargeback won": debit 1010 / credit 5020
//   lost:       stays recorded; the wallet stays frozen until an admin unfreezes it
// Each step is recorded once (ledger keys), however often Stripe repeats the event.
const Dispute = require('../models/Dispute');
const Wallet = require('../models/Wallet');
const Order = require('../models/Order');
const CostcoinOrder = require('../models/CostcoinOrder');
const ledger = require('./ledger');

const step = (event, detail = '') => ({ at: new Date(), event, detail: String(detail).slice(0, 300) });

/** Which of our payments a dispute is about. */
async function paymentOf(paymentIntentId) {
  if (!paymentIntentId) return { paymentType: 'unknown' };
  const ticket = await Order.findOne({ 'stripe.paymentIntentId': paymentIntentId }).lean();
  if (ticket) return { paymentType: 'ticket', order: ticket._id, orderLabel: `ORD-${ticket.number}`, user: ticket.user, quest: ticket.quest };
  const coins = await CostcoinOrder.findOne({ 'stripe.paymentIntentId': paymentIntentId }).lean();
  if (coins) return { paymentType: 'coscoin', order: coins._id, orderLabel: `CC-${coins.number}`, user: coins.user };
  return { paymentType: 'unknown' };
}

const piOf = (d) => (typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id) || null;
const chargeOf = (d) => (typeof d.charge === 'string' ? d.charge : d.charge?.id) || null;
// Stripe's dispute fee: on the dispute's balance transactions.
const feeOf = (d) => (Array.isArray(d.balance_transactions) ? d.balance_transactions.reduce((sum, bt) => sum + (Number.isInteger(bt?.fee) ? bt.fee : 0), 0) : 0);

async function freezeWallet(userId, why) {
  await Wallet.updateOne({ user: userId }, { $set: { frozen: true, frozenReason: why } }, { upsert: true }).catch((error) => {
    if (error?.code !== 11000) throw error;
  });
}

/** Stripe's webhook: charge.dispute.created / updated / closed / funds_withdrawn / funds_reinstated. */
async function fromStripe(type, d) {
  if (!d?.id) return null;
  const pi = piOf(d);
  let dispute = await Dispute.findOne({ stripeDisputeId: d.id });
  if (!dispute) {
    const pay = await paymentOf(pi);
    try {
      dispute = await Dispute.create({
        stripeDisputeId: d.id,
        paymentIntentId: pi,
        chargeId: chargeOf(d),
        amount: d.amount,
        currency: String(d.currency || 'usd').toUpperCase(),
        reason: d.reason || '',
        status: d.status || 'needs_response',
        paymentType: pay.paymentType,
        order: pay.order || null,
        orderLabel: pay.orderLabel || null,
        user: pay.user || null,
        evidenceDueBy: d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000) : null,
        history: [step('opened', `${d.reason || 'dispute'} on ${pay.orderLabel || pi || 'an unknown payment'}`)],
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      dispute = await Dispute.findOne({ stripeDisputeId: d.id });
    }
    console.warn(`[disputes] ${d.id}: ${d.reason} on ${dispute.orderLabel || pi} (${d.amount} ${d.currency})`);
  }
  const refs = { user: dispute.user, order: dispute.paymentType === 'ticket' ? dispute.order : null, processorRef: pi };

  // The money leaves Stripe when the dispute opens (once).
  await ledger.record({
    key: `dispute-open-${d.id}`,
    kind: 'dispute.withdrawn',
    book: 'money',
    currency: dispute.currency,
    lines: [{ account: ledger.ACCOUNTS.chargebacks, debit: dispute.amount }, { account: ledger.ACCOUNTS.stripeClearing, credit: dispute.amount }],
    memo: `Chargeback on ${dispute.orderLabel || pi} (${dispute.reason || 'dispute'})`,
    ...refs,
  });
  const fee = feeOf(d);
  if (fee > 0) {
    await ledger.record({
      key: `dispute-fee-${d.id}`,
      kind: 'stripe.fee',
      book: 'money',
      currency: dispute.currency,
      lines: [{ account: ledger.ACCOUNTS.stripeFees, debit: fee }, { account: ledger.ACCOUNTS.stripeClearing, credit: fee }],
      memo: `Stripe dispute fee on ${dispute.orderLabel || pi}`,
      ...refs,
    });
  }

  // CosCoin bought with disputed money: no spending until an admin reviews it.
  if (dispute.paymentType === 'coscoin' && dispute.user && !dispute.walletFrozen) {
    await freezeWallet(dispute.user, `Card dispute on ${dispute.orderLabel}`);
    await Dispute.updateOne({ _id: dispute._id }, { $set: { walletFrozen: true }, $push: { history: step('wallet_frozen') } });
  }

  const status = d.status || dispute.status;
  const outcome = status === 'won' ? 'won' : status === 'lost' ? 'lost' : 'open';
  if (outcome === 'won' || type === 'charge.dispute.funds_reinstated') {
    await ledger.record({
      key: `dispute-won-${d.id}`,
      kind: 'dispute.reinstated',
      book: 'money',
      currency: dispute.currency,
      lines: [{ account: ledger.ACCOUNTS.stripeClearing, debit: dispute.amount }, { account: ledger.ACCOUNTS.chargebacks, credit: dispute.amount }],
      memo: `Chargeback won on ${dispute.orderLabel || pi}`,
      ...refs,
    });
  }
  await Dispute.updateOne(
    { _id: dispute._id },
    { $set: { status, outcome, ...(outcome !== 'open' ? { closedAt: dispute.closedAt || new Date() } : {}) }, ...(status !== dispute.status ? { $push: { history: step(status, type) } } : {}) }
  );
  return dispute._id;
}

/** Admin: lets a member spend again after reviewing the dispute. */
async function unfreeze(disputeId, admin, reason) {
  const dispute = await Dispute.findById(disputeId);
  if (!dispute) throw Object.assign(new Error('Dispute not found.'), { status: 404 });
  if (!dispute.user || !dispute.walletFrozen) throw Object.assign(new Error('No frozen wallet on this dispute.'), { status: 409, code: 'not_frozen' });
  await Wallet.updateOne({ user: dispute.user }, { $set: { frozen: false, frozenReason: null } });
  await Dispute.updateOne({ _id: dispute._id }, { $set: { walletFrozen: false }, $push: { history: step('wallet_unfrozen', `${reason} (by ${admin._id})`) } });
  return Dispute.findById(dispute._id).lean();
}

function disputeJson(d) {
  return { id: String(d._id), stripeDisputeId: d.stripeDisputeId, amount: d.amount, currency: d.currency, reason: d.reason, status: d.status, outcome: d.outcome, paymentType: d.paymentType, orderLabel: d.orderLabel, user: d.user ? String(d.user) : null, walletFrozen: d.walletFrozen, evidenceDueBy: d.evidenceDueBy, openedAt: d.openedAt, closedAt: d.closedAt };
}

module.exports = { fromStripe, unfreeze, disputeJson, paymentOf };
