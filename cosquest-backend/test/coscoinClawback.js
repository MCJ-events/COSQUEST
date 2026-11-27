// Wallet spec, flow 7: a disputed CosCoin top-up takes the coins back (once, even below zero).
const User = require('../src/models/User');
const Wallet = require('../src/models/Wallet');
const CostcoinOrder = require('../src/models/CostcoinOrder');
const LedgerTransaction = require('../src/models/LedgerTransaction');
const Counter = require('../src/models/Counter');
const disputes = require('../src/utils/disputes');
const ledger = require('../src/utils/ledger');

async function run() {
  let ok = 0;
  let bad = 0;
  const check = (cond, name, value) => {
    if (cond) { ok += 1; console.log(`  ok  - ${name}`); }
    else { bad += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1200)); }
  };
  const suffix = `${Date.now() % 1e7}${Math.floor(Math.random() * 100)}`;
  const u = await User.create({ profile: { username: `CbAna${suffix}`, usernameNormalized: `cbana${suffix}`, firstName: 'Ana', avatarKey: 'green-knight', age: 30 }, email: `cbana_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants' });
  const pi = `pi_cb_${suffix}`;
  const order = await CostcoinOrder.create({ number: await Counter.next('costcoinOrder', 1000), user: u._id, bundleId: 'B-500', priceVersion: 'v1', priceCents: 400, costcoin: 500, expiresAt: new Date(Date.now() + 3600e3), status: 'paid', stripe: { paymentIntentId: pi } });
  // Bought 500, spent 300 (200 left), all bought coins.
  await Wallet.create({ user: u._id, balance: 200, purchased: 200, applied: [`buy:${order._id}`] });
  await ledger.record({ key: `cc-test-issue-${suffix}`, kind: 'costcoin.issue', book: 'costcoin', currency: 'CQC', lines: [{ account: ledger.ACCOUNTS.costcoinIssued, debit: 500 }, { account: ledger.ACCOUNTS.wallet(u._id), credit: 500 }], user: u._id, memo: 'test' });
  await ledger.record({ key: `cc-test-spend-${suffix}`, kind: 'costcoin.spend', book: 'costcoin', currency: 'CQC', lines: [{ account: ledger.ACCOUNTS.wallet(u._id), debit: 300 }, { account: ledger.ACCOUNTS.costcoinSpent, credit: 300 }], user: u._id, memo: 'test' });

  const dp = { id: `dp_cb_${suffix}`, payment_intent: pi, amount: 400, currency: 'usd', reason: 'fraudulent', status: 'needs_response' };
  await disputes.fromStripe('charge.dispute.created', dp);
  let w = await Wallet.findOne({ user: u._id }).lean();
  check(w.balance === -300 && w.purchased === 0 && w.frozen === true, 'the 500 coins are taken back: 200 - 500 = -300 owed, frozen', { balance: w.balance, purchased: w.purchased, frozen: w.frozen });
  const claw = await LedgerTransaction.findOne({ kind: 'costcoin.clawback', user: u._id });
  check(claw && claw.lines.find((l) => l.account === `CC-WALLET:${u._id}`).debit === 500, 'ledger: Clawback, Wallet > CosCoin Issued, 500', claw);
  await disputes.fromStripe('charge.dispute.updated', { ...dp, status: 'under_review' });
  w = await Wallet.findOne({ user: u._id }).lean();
  check(w.balance === -300 && (await LedgerTransaction.countDocuments({ kind: 'costcoin.clawback', user: u._id })) === 1, 'Stripe repeating the event takes nothing more', w.balance);
  const checks = await ledger.financeChecks();
  const below = checks.find((c) => /below zero/.test(c.name));
  check(below && (below.pass === true || !/Wallet/.test(String(below.detail))), 'the finance check accepts a wallet owing coins after a chargeback', below);
  const equal = checks.find((c) => /issued and rewarded/.test(c.name));
  check(equal && equal.pass !== false, 'wallets still equal coins issued and rewarded minus spent', equal);

  await disputes.fromStripe('charge.dispute.closed', { ...dp, status: 'won' });
  w = await Wallet.findOne({ user: u._id }).lean();
  check(w.balance === 200 && w.frozen === true, 'dispute won: the coins come back (200), the wallet stays frozen for review', { balance: w.balance, frozen: w.frozen });
  await disputes.fromStripe('charge.dispute.funds_reinstated', { ...dp, status: 'won' });
  w = await Wallet.findOne({ user: u._id }).lean();
  check(w.balance === 200 && (await LedgerTransaction.countDocuments({ kind: 'costcoin.clawback_returned', user: u._id })) === 1, 'given back once only', w.balance);

  console.log(`\ncoscoin clawback: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
