// Costcoin: buying a bundle on the website, both ledgers linked, the wallet credited once, 18+.
const Stripe = require('stripe');
const User = require('../src/models/User');
const CostcoinOrder = require('../src/models/CostcoinOrder');
const Wallet = require('../src/models/Wallet');
const LedgerTransaction = require('../src/models/LedgerTransaction');
const PriceTableVersion = require('../src/models/PriceTableVersion');
const Counter = require('../src/models/Counter');
const payments = require('../src/utils/stripe');
const mongoose = require('mongoose');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let ok = 0;
  let bad = 0;
  const check = (cond, name, value) => {
    if (cond) { ok += 1; console.log(`  ok  - ${name}`); }
    else { bad += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1200)); }
  };
  async function request(method, path, token, body) {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  }
  const signer = new Stripe('sk_test_signer');
  const secret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test';
  let n = 0;
  async function webhook(type, object) {
    n += 1;
    const payload = JSON.stringify({ id: `evt_cc_${Date.now()}_${n}`, type, data: { object } });
    await fetch(`${baseUrl}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': signer.webhooks.generateTestHeaderString({ payload, secret }) }, body: payload });
    return payload;
  }
  const fake = payments._fake();
  const suffix = `${Date.now() % 1e7}${Math.floor(Math.random() * 100)}`;
  const mk = async (name, age) => {
    const u = await User.create({ profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, avatarKey: 'green-knight', age }, email: `${name.toLowerCase()}_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants' });
    return { user: u, token: signToken(u.id, u.tokenVersion) };
  };
  const adult = await mk('CcAna', 30);
  const teen = await mk('CcTeen', 16);
  // An approved price table (the Sep 2 bundles).
  await PriceTableVersion.create({ version: await Counter.next('priceTable', 1), approval: new mongoose.Types.ObjectId(), bundles: [
    { id: 'B-80', name: 'Small bundle', priceCents: 100, costcoin: 80, status: 'active' },
    { id: 'B-500', name: 'Medium bundle', priceCents: 400, costcoin: 500, status: 'active' },
    { id: 'B-STARTER', name: 'Starter pack', priceCents: 2000, costcoin: null, status: 'open' },
  ] });

  const young = await request('POST', '/api/costcoin/handoff', teen.token, { bundleId: 'B-500' });
  check(young.status === 403 && young.data.code === 'too_young', 'buying Costcoin is 18+', young.data);
  const open = await request('POST', '/api/costcoin/handoff', adult.token, { bundleId: 'B-STARTER' });
  check(open.status === 404 && open.data.code === 'not_on_sale', 'an OPEN bundle is not on sale', open.data);
  const link = await request('POST', '/api/costcoin/handoff', adult.token, { bundleId: 'B-500' });
  check(link.status === 201 && /\/checkout\/costcoin\?h=/.test(link.data.url), 'a 20-minute link to the website', link.data);
  const h = new URL(link.data.url).searchParams.get('h');
  const ticketRedeem = await request('POST', '/api/payments/handoff/redeem', null, { h });
  check(ticketRedeem.status !== 200, "a Costcoin link can't be used to buy a ticket", ticketRedeem.status);
  const link2 = await request('POST', '/api/costcoin/handoff', adult.token, { bundleId: 'B-500' });
  const redeemed = await request('POST', '/api/costcoin/handoff/redeem', null, { h: new URL(link2.data.url).searchParams.get('h') });
  check(redeemed.status === 200 && redeemed.data.bundle.costcoin === 500 && /^v\d+$/.test(redeemed.data.priceVersion), 'the website gets the pass and the bundle', redeemed.data);
  const cp = redeemed.data.checkoutToken;
  const started = await request('POST', '/api/costcoin/checkout', cp, {});
  check(started.status === 201 && started.data.checkoutUrl, "Stripe's page", started.data);
  const order = await CostcoinOrder.findById(started.data.order.id);
  const session = fake._pay(order.stripe.checkoutSessionId);
  const payload = await webhook('checkout.session.completed', session);
  await new Promise((r) => setTimeout(r, 200));
  const wallet = await Wallet.findOne({ user: adult.user._id });
  check(wallet?.balance === 500, "Stripe's webhook: 500 Costcoin in the wallet", wallet);
  const cash = await LedgerTransaction.findOne({ key: `cc-paid-${order._id}` });
  const coins = await LedgerTransaction.findOne({ key: `cc-issue-${order._id}` });
  check(cash && cash.kind === 'costcoin.purchase' && cash.lines.find((l) => l.account === '4010').credit === 400 && cash.lines.find((l) => l.account === '1010').debit === 400 && cash.itemId === 'B-500', 'cash ledger: 1010 Stripe Clearing / 4010 Costcoin Sales, $4.00, item B-500', cash);
  check(coins && coins.book === 'costcoin' && coins.lines.find((l) => l.account === 'CC-ISSUED').debit === 500 && String(coins.linkedTx) === String(cash._id), 'Costcoin ledger: Costcoin Issued / Wallet, 500, linked to the cash entry', coins);
  // The same webhook again (Stripe retries): nothing more.
  const header = signer.webhooks.generateTestHeaderString({ payload: payload.replace(/evt_cc_\d+_\d+/, `evt_cc_retry_${suffix}`), secret });
  await fetch(`${baseUrl}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload.replace(/evt_cc_\d+_\d+/, `evt_cc_retry_${suffix}`) });
  check((await Wallet.findOne({ user: adult.user._id })).balance === 500 && (await LedgerTransaction.countDocuments({ key: { $in: [`cc-paid-${order._id}`, `cc-issue-${order._id}`] } })) === 2, 'paid twice by a retry: credited once', null);
  const back = await request('GET', `/api/costcoin/orders/${order._id}`, cp);
  check(back.data.order.status === 'paid' && back.data.wallet.balance === 500, 'the return page: paid, balance 500', back.data);
  const mine = await request('GET', '/api/costcoin/wallet', adult.token);
  check(mine.data.balance === 500 && mine.data.history.length === 1 && mine.data.history[0].amount === 500 && mine.data.history[0].type === 'Purchase', 'the wallet: balance and history', mine.data);
  const checks = await request('GET', '/api/admin/ledger/check', null);
  void checks; // (admin only; finance checks are covered in test/ledger.js)

  console.log(`\ncostcoin purchases: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
