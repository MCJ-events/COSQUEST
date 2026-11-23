// Disputes (chargebacks): recorded once, the ledger (5020), a CosCoin wallet frozen, won -> money back.
const Stripe = require('stripe');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Wallet = require('../src/models/Wallet');
const CostcoinOrder = require('../src/models/CostcoinOrder');
const Dispute = require('../src/models/Dispute');
const LedgerTransaction = require('../src/models/LedgerTransaction');
const Counter = require('../src/models/Counter');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let ok = 0;
  let bad = 0;
  const check = (cond, name, value) => {
    if (cond) { ok += 1; console.log(`  ok  - ${name}`); }
    else { bad += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1200)); }
  };
  const signer = new Stripe('sk_test_signer');
  const secret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test';
  let n = 0;
  async function webhook(type, object) {
    n += 1;
    const payload = JSON.stringify({ id: `evt_dp_${Date.now()}_${n}`, type, data: { object } });
    await fetch(`${baseUrl}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': signer.webhooks.generateTestHeaderString({ payload, secret }) }, body: payload });
  }
  async function request(method, path, token, body) {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  }
  const suffix = `${Date.now() % 1e7}${Math.floor(Math.random() * 100)}`;
  const member = await User.create({ profile: { username: `DpAna${suffix}`, usernameNormalized: `dpana${suffix}`, firstName: 'Ana', avatarKey: 'green-knight', age: 30 }, email: `dpana_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants' });
  const admin = await User.create({ profile: { username: `DpAdmin${suffix}`, usernameNormalized: `dpadmin${suffix}`, firstName: 'Ad', avatarKey: 'green-knight' }, email: `dpadmin_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants', platformRole: 'admin', adminSince: new Date() });
  const adminToken = (await request('POST', '/api/admin/auth/exchange', signToken(admin.id, admin.tokenVersion))).data.token;
  const pi = `pi_dispute_${suffix}`;
  const order = await CostcoinOrder.create({ number: await Counter.next('costcoinOrder', 1000), user: member._id, bundleId: 'B-500', priceVersion: 'v1', priceCents: 400, costcoin: 500, status: 'paid', paidAt: new Date(), expiresAt: new Date(), stripe: { paymentIntentId: pi } });
  await Wallet.create({ user: member._id, balance: 500, applied: [`buy:${order._id}`] });
  const dispute = { id: `dp_${suffix}`, object: 'dispute', amount: 400, currency: 'usd', reason: 'fraudulent', status: 'needs_response', payment_intent: pi, charge: `ch_${suffix}`, evidence_details: { due_by: Math.floor(Date.now() / 1000) + 7 * 86400 }, balance_transactions: [{ amount: -1900, fee: 1500 }] };

  await webhook('charge.dispute.created', dispute);
  await webhook('charge.dispute.created', dispute); // Stripe repeats itself
  await new Promise((r) => setTimeout(r, 200));
  const row = await Dispute.findOne({ stripeDisputeId: dispute.id });
  check(row && row.paymentType === 'coscoin' && row.orderLabel === `CC-${order.number}` && row.outcome === 'open', 'the dispute is recorded against the CosCoin top-up', row);
  const out = await LedgerTransaction.find({ key: { $in: [`dispute-open-${dispute.id}`, `dispute-fee-${dispute.id}`] } });
  check(out.length === 2 && out.find((t) => t.kind === 'dispute.withdrawn').lines.find((l) => l.account === '5020').debit === 400 && out.find((t) => t.kind === 'stripe.fee').lines.find((l) => l.account === '5010').debit === 1500, 'ledger once: 5020 Chargebacks $4.00 and the $15 dispute fee (5010)', out);
  check((await Wallet.findOne({ user: member._id })).frozen === true, "the member's CosCoin wallet is frozen", null);
  await webhook('charge.dispute.closed', { ...dispute, status: 'won' });
  await new Promise((r) => setTimeout(r, 200));
  const won = await LedgerTransaction.findOne({ key: `dispute-won-${dispute.id}` });
  check(won && won.lines.find((l) => l.account === '1010').debit === 400 && (await Dispute.findOne({ stripeDisputeId: dispute.id })).outcome === 'won', 'won: the money comes back (1010 / 5020)', won);
  check((await Wallet.findOne({ user: member._id })).frozen === true, 'the wallet stays frozen until an admin reviews it', null);
  const list = await request('GET', '/api/admin/disputes', adminToken);
  check(list.status === 200 && list.data.disputes.some((d) => d.stripeDisputeId === dispute.id && d.walletFrozen), 'admins see the dispute', list.data);
  const unf = await request('POST', `/api/admin/disputes/${row._id}/unfreeze`, adminToken, { reason: 'Dispute won' });
  check(unf.status === 200 && (await Wallet.findOne({ user: member._id })).frozen === false, 'an admin unfreezes it (with a reason, audited)', unf.data);
  void mongoose;

  console.log(`\ndisputes: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
