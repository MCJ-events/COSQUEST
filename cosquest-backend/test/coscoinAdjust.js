// Admin CosCoin adjustments: two people, logged, never below zero.
const User = require('../src/models/User');
const Wallet = require('../src/models/Wallet');
const LedgerTransaction = require('../src/models/LedgerTransaction');
const ledger = require('../src/utils/ledger');
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
  const suffix = `${Date.now() % 1e7}${Math.floor(Math.random() * 100)}`;
  const mkAdmin = async (name) => {
    const u = await User.create({ profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, avatarKey: 'green-knight' }, email: `${name.toLowerCase()}_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants', platformRole: 'admin', adminSince: new Date() });
    return (await request('POST', '/api/admin/auth/exchange', signToken(u.id, u.tokenVersion))).data.token;
  };
  const a = await mkAdmin('AdjA');
  const b = await mkAdmin('AdjB');
  const m = await User.create({ profile: { username: `AdjMem${suffix}`, usernameNormalized: `adjmem${suffix}`, firstName: 'Mo', avatarKey: 'green-knight' }, email: `adjmem_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants' });

  const zero = await request('POST', '/api/admin/wallets/adjustments', a, { username: `adjmem${suffix}`, amount: 0, reason: 'Test' });
  check(zero.status === 400, 'an amount of 0 is refused', zero.data);
  const noWhy = await request('POST', '/api/admin/wallets/adjustments', a, { username: `adjmem${suffix}`, amount: 200 });
  check(noWhy.status === 400, 'a reason is required', noWhy.data);
  const add = await request('POST', '/api/admin/wallets/adjustments', a, { username: `adjmem${suffix}`, amount: 200, reason: 'Compensation for a lost raid reward' });
  check(add.status === 201, 'adding 200 coins waits for approval', add.data);
  check(!(await Wallet.findOne({ user: m._id }))?.balance, 'nothing changes before approval', null);
  check((await request('POST', `/api/admin/approvals/${add.data.request.id}/approve`, a, {})).status === 403, "the requester can't approve it", null);
  check((await request('POST', `/api/admin/approvals/${add.data.request.id}/approve`, b, { note: 'OK' })).status === 200, 'a second admin approves', null);
  let w = await Wallet.findOne({ user: m._id }).lean();
  check(w.balance === 200 && (w.purchased || 0) === 0, 'the member has 200 (earned, not bought)', w);
  const tx = await LedgerTransaction.findOne({ kind: 'costcoin.adjustment', user: m._id });
  check(tx && tx.lines.find((l) => l.account === 'CC-ADJUST').debit === 200 && tx.approvedBy?.length === 1 && String(tx.createdBy) !== String(tx.approvedBy[0]), 'ledger: Adjustment with who asked and who approved', tx);

  const tooMuch = await request('POST', '/api/admin/wallets/adjustments', a, { username: `adjmem${suffix}`, amount: -500, reason: 'Fraud found' });
  check(tooMuch.status === 409, "removing more than the member has is refused (never below zero)", tooMuch.data);
  const remove = await request('POST', '/api/admin/wallets/adjustments', a, { username: `adjmem${suffix}`, amount: -150, reason: 'Duplicate compensation' });
  await Wallet.updateOne({ user: m._id }, { $set: { balance: 100 } });
  const blocked = await request('POST', `/api/admin/approvals/${remove.data.request.id}/approve`, b, { note: 'OK' });
  check(blocked.status === 409, 'coins spent meanwhile: approving the removal is refused, the request keeps waiting', blocked.data);
  await Wallet.updateOne({ user: m._id }, { $set: { balance: 200 } });
  const removed = await request('POST', `/api/admin/approvals/${remove.data.request.id}/approve`, b, { note: 'OK' });
  w = await Wallet.findOne({ user: m._id }).lean();
  check(removed.status === 200 && w.balance === 50, 'with the coins back: removed (200 - 150 = 50)', { status: removed.status, balance: w.balance });
  const checks = await ledger.financeChecks();
  const equal = checks.find((c) => /issued and rewarded/.test(c.name));
  check(equal && equal.pass !== false, 'wallets still match the books (adjustments counted)', equal);

  console.log(`\ncoscoin adjustments: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
