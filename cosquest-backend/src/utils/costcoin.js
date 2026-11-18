// CosCoin: buying bundles on the CosQuest website (payment brief: a closed-loop
// game currency, bought with money, never cash, never paid quest entry).
//
//   startPurchase()   a Stripe Checkout page for one bundle on sale (18+), like tickets
//   paidFromSession() Stripe's signed webhook: the purchase is paid
//   credit()          both ledgers, linked, and the wallet: each exactly once
//       cash:     debit 1010 Stripe Clearing / credit 4010 CosCoin Sales   (CosCoin purchase)
//       costcoin: debit CosCoin Issued / credit <user> Wallet              (Purchase, linked)
//   reconcileDue()    missed webhooks and expired pages (the 2-minute job)
//   wallet(), history()  the balance and its entries
const CostcoinOrder = require('../models/CostcoinOrder');
const Wallet = require('../models/Wallet');
const Counter = require('../models/Counter');
const LedgerTransaction = require('../models/LedgerTransaction');
const payments = require('./stripe');
const priceTable = require('./priceTable');
const ledger = require('./ledger');
const { checkEligibility } = require('./eligibility');

const PAGE_MS = 31 * 60 * 1000; // Stripe's minimum Checkout session is 30 minutes
const MAX_PER_10_MIN = 8;
const label = (order) => `CC-${order.number}`;
const step = (event, detail = '') => ({ at: new Date(), event, detail: String(detail).slice(0, 300) });

function fail(status, message, code, extra) {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}), ...(extra ? { extra } : {}) });
}

/** The bundle on sale now, or a refusal. */
async function bundleOnSale(bundleId) {
  const { priceVersion, bundles } = await priceTable.onSale();
  const bundle = bundles.find((b) => b.id === String(bundleId || '').toUpperCase());
  if (!bundle || !priceVersion) fail(404, 'This bundle is not on sale.', 'not_on_sale');
  return { bundle, priceVersion };
}

/** 18+ (and, with live payments, the region): the same rule as paid quests. */
async function mayBuy(user, ip) {
  const eligible = await checkEligibility(user, { paid: true, ip });
  if (!eligible.allowed) fail(403, eligible.message, eligible.code, { reason: eligible.reason });
}

async function startPurchase({ user, bundleId, ip = null }) {
  await mayBuy(user, ip);
  const { bundle, priceVersion } = await bundleOnSale(bundleId);
  if (!payments.isConfigured()) fail(503, 'Payments are not set up yet. Please try again later.', 'payments_unavailable');
  const now = new Date();
  // A retry (network drop, double tap) gets the same open page back.
  const open = await CostcoinOrder.findOne({ user: user._id, bundleId: bundle.id, priceVersion, status: 'pending', expiresAt: { $gt: new Date(now.getTime() + 60 * 1000) } });
  if (open?.stripe?.checkoutUrl) return { order: open, reused: true };
  const recent = await CostcoinOrder.countDocuments({ user: user._id, createdAt: { $gte: new Date(now.getTime() - 10 * 60 * 1000) } });
  if (recent >= MAX_PER_10_MIN) fail(429, 'Too many attempts. Please wait a few minutes.', 'too_many_checkouts');

  let order = await CostcoinOrder.create({
    number: await Counter.next('costcoinOrder', 1000),
    user: user._id,
    bundleId: bundle.id,
    bundleName: bundle.name,
    priceVersion,
    priceCents: bundle.priceCents,
    costcoin: bundle.costcoin,
    expiresAt: new Date(now.getTime() + PAGE_MS),
    history: [step('created', `${bundle.id} ${bundle.costcoin} CosCoin for ${bundle.priceCents} cents (${priceVersion})`)],
  });
  const meta = { purpose: 'costcoin', costcoinOrderId: String(order._id), userId: String(user._id), bundleId: bundle.id };
  try {
    const session = await payments.stripe().checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: bundle.priceCents, product_data: { name: `${bundle.costcoin} CosCoin (${bundle.name})`.slice(0, 120), description: 'CosQuest game currency. Not cash, not withdrawable.' } } }],
        client_reference_id: `cc-${order._id}`,
        metadata: meta,
        payment_intent_data: { metadata: meta },
        ...(user.email ? { customer_email: user.email } : {}),
        expires_at: Math.floor(order.expiresAt.getTime() / 1000),
        success_url: `${payments.appWebUrl()}/checkout/costcoin-return?order=${order._id}&result=success`,
        cancel_url: `${payments.appWebUrl()}/checkout/costcoin-return?order=${order._id}&result=cancelled`,
      },
      { idempotencyKey: `costcoin-${order._id}` }
    );
    order = await CostcoinOrder.findByIdAndUpdate(order._id, { $set: { 'stripe.checkoutSessionId': session.id, 'stripe.checkoutUrl': session.url }, $push: { history: step('checkout_opened', session.id) } }, { new: true });
    return { order };
  } catch (error) {
    await CostcoinOrder.updateOne({ _id: order._id, status: 'pending' }, { $set: { status: 'failed' }, $push: { history: step('failed', `Stripe: ${error.message}`) } });
    console.error(`[costcoin] ${label(order)}: could not open Stripe Checkout:`, error.message);
    fail(502, "Couldn't reach the payment service. Nothing was charged. Please try again.", 'payment_service_unreachable');
  }
}

/** Applies a wallet change once per key (a repeated webhook or retry does nothing). */
async function applyToWallet(userId, key, amount) {
  try {
    const result = await Wallet.updateOne({ user: userId, applied: { $ne: key } }, { $inc: { balance: amount }, $push: { applied: key } }, { upsert: true });
    return Boolean(result.modifiedCount || result.upsertedCount);
  } catch (error) {
    if (error?.code === 11000) return false; // the wallet exists and already has this key
    throw error;
  }
}

/** Both ledgers (linked) and the wallet, each exactly once. Safe to call many times. */
async function credit(order) {
  if (order.status !== 'paid') return null;
  const memo = `${label(order)}: ${order.costcoin} CosCoin (${order.bundleId})`;
  const cash = await ledger.record({
    key: `cc-paid-${order._id}`,
    kind: 'costcoin.purchase',
    book: 'money',
    currency: order.currency,
    lines: [{ account: ledger.ACCOUNTS.stripeClearing, debit: order.priceCents }, { account: ledger.ACCOUNTS.costcoinSales, credit: order.priceCents }],
    user: order.user,
    itemId: order.bundleId,
    priceVersion: order.priceVersion,
    processorRef: order.stripe?.paymentIntentId || null,
    memo,
  });
  await ledger.record({
    key: `cc-issue-${order._id}`,
    kind: 'costcoin.issue',
    book: 'costcoin',
    currency: 'CQC',
    lines: [{ account: ledger.ACCOUNTS.costcoinIssued, debit: order.costcoin }, { account: ledger.ACCOUNTS.wallet(order.user), credit: order.costcoin }],
    user: order.user,
    itemId: order.bundleId,
    priceVersion: order.priceVersion,
    linkedTx: cash.tx._id,
    memo: `Coins issued for bundle ${order.bundleId} (${label(order)})`,
  });
  const added = await applyToWallet(order.user, `buy:${order._id}`, order.costcoin);
  if (added) {
    const wallet = await Wallet.findOne({ user: order.user }).lean();
    try {
      require('../realtime/socket').emitToUser(String(order.user), 'costcoin:credited', { orderId: String(order._id), added: order.costcoin, balance: wallet?.balance ?? null });
    } catch {}
    require('./push').sendToUsers([String(order.user)], { title: 'CosCoin added', body: `${order.costcoin} CosCoin are in your wallet.`, data: { type: 'costcoin', orderId: String(order._id) }, channel: 'default', skipOnline: false }).catch(() => {});
  }
  recordFee(order, cash.tx).catch((error) => console.warn(`[costcoin] ${label(order)}: Stripe fee not recorded yet:`, error.message));
  return cash.tx;
}

/** Stripe's real fee on the purchase (finance's "Processor fee" row), once known. */
async function recordFee(order, saleTx) {
  const paymentIntentId = order.stripe?.paymentIntentId;
  if (!paymentIntentId || !payments.isConfigured()) return null;
  const key = `cc-fee-${order._id}`;
  if (await LedgerTransaction.exists({ key })) return null;
  const intent = await payments.stripe().paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge.balance_transaction'] });
  const balance = intent?.latest_charge?.balance_transaction;
  if (!balance || typeof balance !== 'object' || !Number.isInteger(balance.fee) || balance.fee <= 0) return null;
  return ledger.record({
    key,
    kind: 'stripe.fee',
    book: 'money',
    currency: String(balance.currency || order.currency).toUpperCase(),
    lines: [{ account: ledger.ACCOUNTS.stripeFees, debit: balance.fee }, { account: ledger.ACCOUNTS.stripeClearing, credit: balance.fee }],
    user: order.user,
    processorRef: paymentIntentId,
    linkedTx: saleTx?._id || null,
    memo: `Stripe fee on ${label(order)}`,
  });
}

/** Paid (Stripe's webhook or the reconciler): check the amount, mark paid once, credit. */
async function fulfil(order, { paymentIntentId = null, amountTotal = null, currency = null, via = 'webhook' } = {}) {
  if (amountTotal !== order.priceCents || String(currency).toUpperCase() !== order.currency) {
    // Should never happen: refund rather than credit the wrong amount.
    console.error(`[costcoin] ${label(order)}: amount mismatch, refunding`);
    if (paymentIntentId) await payments.stripe().refunds.create({ payment_intent: paymentIntentId, metadata: { costcoinOrderId: String(order._id) } }, { idempotencyKey: `costcoin-refund-${order._id}` });
    await CostcoinOrder.updateOne({ _id: order._id }, { $set: { status: 'refunded' }, $push: { history: step('amount_mismatch', `expected ${order.priceCents}, got ${amountTotal} ${currency}`) } });
    return null;
  }
  const paid = await CostcoinOrder.findOneAndUpdate(
    { _id: order._id, status: { $in: ['pending', 'expired', 'failed'] } },
    { $set: { status: 'paid', paidAt: new Date(), ...(paymentIntentId ? { 'stripe.paymentIntentId': paymentIntentId } : {}) }, $push: { history: step('paid', via) } },
    { new: true }
  );
  return credit(paid || (await CostcoinOrder.findById(order._id)));
}

/** Stripe's webhook: checkout.session.completed / async_payment_succeeded for a CosCoin page. */
async function paidFromSession(session, via) {
  const order = await CostcoinOrder.findById(session.metadata?.costcoinOrderId).catch(() => null);
  if (!order) return null;
  await fulfil(order, { paymentIntentId: session.payment_intent, amountTotal: session.amount_total, currency: session.currency, via });
  return order._id;
}

/** Stripe's webhook: the page expired or the payment failed. */
async function expiredFromSession(session, via) {
  const order = await CostcoinOrder.findOneAndUpdate({ _id: session.metadata?.costcoinOrderId, status: 'pending' }, { $set: { status: 'expired' }, $push: { history: step('expired', via) } }, { new: true }).catch(() => null);
  return order?._id || null;
}

/** Asks Stripe where a pending purchase stands (the return page, the 2-minute job). */
async function reconcileOrder(order) {
  if (order.status !== 'pending' || !order.stripe?.checkoutSessionId) return order;
  await CostcoinOrder.updateOne({ _id: order._id }, { $set: { lastCheckedAt: new Date() } });
  let session;
  try {
    session = await payments.stripe().checkout.sessions.retrieve(order.stripe.checkoutSessionId);
  } catch (error) {
    console.warn(`[costcoin] ${label(order)}: could not ask Stripe:`, error.message);
    return order;
  }
  if (session.payment_status === 'paid') await fulfil(order, { paymentIntentId: session.payment_intent, amountTotal: session.amount_total, currency: session.currency, via: 'reconciled' });
  else if (session.status === 'expired' || order.expiresAt <= new Date()) await expiredFromSession({ metadata: { costcoinOrderId: String(order._id) } }, 'reconciled');
  return CostcoinOrder.findById(order._id);
}

/** The 2-minute job: pending purchases quiet for 5 minutes or past their page, and paid ones never credited. */
async function reconcileDue() {
  if (!payments.isConfigured()) return;
  const now = Date.now();
  const due = await CostcoinOrder.find({ status: 'pending', $or: [{ expiresAt: { $lte: new Date(now) } }, { createdAt: { $lte: new Date(now - 5 * 60 * 1000) }, $or: [{ lastCheckedAt: null }, { lastCheckedAt: { $lte: new Date(now - 5 * 60 * 1000) } }] }] }).limit(50);
  for (const order of due) await reconcileOrder(order).catch((error) => console.error(`[costcoin] reconcile ${label(order)}:`, error.message));
  // Paid in the last day: make sure both ledgers and the wallet have it (all once-only).
  const paid = await CostcoinOrder.find({ status: 'paid', paidAt: { $gte: new Date(now - 24 * 3600e3) } }).limit(200);
  for (const order of paid) await credit(order).catch((error) => console.error(`[costcoin] credit ${label(order)}:`, error.message));
}

async function wallet(userId) {
  const w = await Wallet.findOne({ user: userId }).lean();
  return { balance: w?.balance || 0, frozen: Boolean(w?.frozen), frozenReason: w?.frozen ? w.frozenReason || null : null };
}

/** The wallet's entries (the CosCoin ledger), newest first. */
async function history(userId, { offset = 0, limit = 30 } = {}) {
  const account = ledger.ACCOUNTS.wallet(userId);
  const rows = await LedgerTransaction.find({ book: 'costcoin', 'lines.account': account }).sort({ createdAt: -1, number: -1 }).skip(offset).limit(Math.min(limit, 50)).lean();
  return rows.map((tx) => {
    const line = tx.lines.find((l) => l.account === account);
    return { id: `TX-${tx.number}`, type: ledger.typeOf(tx.kind), amount: (line?.credit || 0) - (line?.debit || 0), itemId: tx.itemId || null, description: tx.memo || '', at: tx.createdAt };
  });
}

function orderJson(order) {
  return { id: String(order._id), number: label(order), bundleId: order.bundleId, bundleName: order.bundleName, costcoin: order.costcoin, priceCents: order.priceCents, priceVersion: order.priceVersion, status: order.status, checkoutUrl: order.status === 'pending' ? order.stripe?.checkoutUrl || null : null, paidAt: order.paidAt, createdAt: order.createdAt };
}

module.exports = { startPurchase, mayBuy, bundleOnSale, paidFromSession, expiredFromSession, fulfil, credit, reconcileOrder, reconcileDue, wallet, history, orderJson, applyToWallet, label };
