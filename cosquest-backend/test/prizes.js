// Prizes: published results -> claim -> verify -> payout (two people) -> hold -> paid.
const mongoose = require('mongoose');
const User = require('../src/models/User');
const PrizeClaim = require('../src/models/PrizeClaim');
const LedgerTransaction = require('../src/models/LedgerTransaction');
const prizes = require('../src/utils/prizes');
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
  const env = { key: process.env.PAYEE_DATA_KEY, hold: process.env.PRIZE_HOLD_DAYS };
  const suffix = `${Date.now() % 1e7}${Math.floor(Math.random() * 100)}`;
  const mkAdmin = async (name) => {
    const u = await User.create({ profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, avatarKey: 'green-knight' }, email: `${name.toLowerCase()}_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants', platformRole: 'admin', adminSince: new Date() });
    return (await request('POST', '/api/admin/auth/exchange', signToken(u.id, u.tokenVersion))).data.token;
  };
  const a = await mkAdmin('PzA');
  const b = await mkAdmin('PzB');
  const w = await User.create({ profile: { username: `PzWin${suffix}`, usernameNormalized: `pzwin${suffix}`, firstName: 'Wren', avatarKey: 'green-knight' }, email: `pzwin_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants' });
  const wt = signToken(w.id, w.tokenVersion);
  const quest = { _id: new mongoose.Types.ObjectId(), title: `Glam Zone ${suffix}`, prizePool: { currency: 'USD' }, scoring: { version: 2 } };
  const [claim1] = await prizes.createForResults(quest, { publishedAt: new Date(), winners: [{ user: w._id, ticket: new mongoose.Types.ObjectId(), place: 1, prizeCents: 50000 }, { user: new mongoose.Types.ObjectId(), ticket: new mongoose.Types.ObjectId(), place: 2, prizeCents: 0 }] });
  check(claim1 && claim1.status === 'awaiting_claim' && claim1.amountCents === 50000 && claim1.scoringVersion === 2, 'publishing results creates a $500 prize to claim (only winners with an amount)', claim1);
  const again = await prizes.createForResults(quest, { publishedAt: new Date(), winners: [{ user: w._id, ticket: new mongoose.Types.ObjectId(), place: 1, prizeCents: 50000 }] });
  check(again.length === 0, 'publishing twice creates nothing more', again.length);

  delete process.env.PAYEE_DATA_KEY;
  const noKey = await request('POST', `/api/prizes/${claim1.id}/claim`, wt, {});
  check(noKey.status === 503, 'without the encryption key nothing sensitive can be saved (503)', noKey.data);
  process.env.PAYEE_DATA_KEY = 'test-payee-key-0123456789abcdef';
  process.env.PRIZE_HOLD_DAYS = '7';
  const good = { legalName: 'Wren Adeyemi', dateOfBirth: '1996-04-21', certify: true, payout: { type: 'ach', accountHolder: 'Wren Adeyemi', routingNumber: '121000248', accountNumber: '000123456789' }, tax: { form: 'w9', tin: '123456789' } };
  const young = await request('POST', `/api/prizes/${claim1.id}/claim`, wt, { ...good, dateOfBirth: `${new Date().getUTCFullYear() - 16}-01-01` });
  check(young.status === 403 && young.data.code === 'too_young', 'under 18: refused', young.data);
  const other = await User.create({ profile: { username: `PzOther${suffix}`, usernameNormalized: `pzother${suffix}`, firstName: 'O', avatarKey: 'green-knight' }, email: `pzother_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants' });
  check((await request('POST', `/api/prizes/${claim1.id}/claim`, signToken(other.id, other.tokenVersion), good)).status === 404, "nobody else can claim someone's prize", null);
  const claimed = await request('POST', `/api/prizes/${claim1.id}/claim`, wt, good);
  check(claimed.status === 200 && claimed.data.prize.status === 'submitted' && claimed.data.prize.payoutMethod.accountLast4 === '6789', 'the winner claims: submitted, only the last 4 digits come back', claimed.data);
  const raw = JSON.stringify(await PrizeClaim.findById(claim1.id).lean());
  check(!raw.includes('000123456789') && !raw.includes('123456789"') && raw.includes('v1:'), 'bank and tax numbers are stored encrypted, never in plain text', null);
  check((await request('POST', `/api/prizes/${claim1.id}/claim`, wt, good)).status === 409, 'a prize is claimed once', null);
  const mine = await request('GET', '/api/prizes', wt);
  check(mine.status === 200 && mine.data.prizes.length === 1 && mine.data.prizes[0].status === 'submitted', 'My prizes shows it', mine.data);

  const early = await request('POST', `/api/admin/prizes/${claim1.id}/payout-request`, a, {});
  check(early.status === 409, 'no payout before the claim is verified', early.data);
  check((await request('POST', `/api/admin/prizes/${claim1.id}/verify`, a, {})).status === 200, 'an admin verifies the claim', null);
  const asked = await request('POST', `/api/admin/prizes/${claim1.id}/payout-request`, a, {});
  check(asked.status === 200 && asked.data.request?.number, 'payout requested: waiting in Approvals', asked.data);
  check((await request('POST', `/api/admin/approvals/${asked.data.request.id}/approve`, a, {})).status === 403, "the requester can't approve the payout", null);
  check((await request('POST', `/api/admin/approvals/${asked.data.request.id}/approve`, b, { note: 'OK' })).status === 200, 'a second admin approves it', null);
  let c = await PrizeClaim.findById(claim1.id).lean();
  check(c.status === 'held' && c.holdUntil > new Date(Date.now() + 6 * 864e5), 'approved: held for the 7-day dispute window', { status: c.status, holdUntil: c.holdUntil });
  const payable = await LedgerTransaction.findOne({ kind: 'prize.payable', key: `prize-payable-${claim1.id}` });
  check(payable && payable.lines.find((l) => l.account === '2020').credit === 50000, 'ledger: Prize payable, Quest Pool > Payouts Payable', payable);
  const tooSoon = await request('POST', `/api/admin/prizes/${claim1.id}/paid`, a, { reference: 'ACH-778812' });
  check(tooSoon.status === 409 && tooSoon.data.code === 'on_hold', 'not paid before the hold ends', tooSoon.data);
  await PrizeClaim.collection.updateOne({ _id: c._id }, { $set: { holdUntil: new Date(Date.now() - 1000) } });
  check((await request('POST', `/api/admin/prizes/${claim1.id}/paid`, a, {})).status === 400, 'marking paid needs the payment reference', null);
  const paid = await request('POST', `/api/admin/prizes/${claim1.id}/paid`, a, { reference: 'ACH-778812' });
  c = await PrizeClaim.findById(claim1.id).lean();
  check(paid.status === 200 && c.status === 'paid' && c.paymentRef === 'ACH-778812', 'after the hold: paid with the reference', paid.data);
  const out = await LedgerTransaction.findOne({ kind: 'prize.paid', key: `prize-paid-${claim1.id}` });
  check(out && out.lines.find((l) => l.account === '2020').debit === 50000, 'ledger: Prize paid, Payouts Payable > Stripe Clearing', out);
  const shown = await request('POST', `/api/admin/prizes/${claim1.id}/reveal`, a, { reason: 'Sending the ACH' });
  check(shown.status === 200 && shown.data.payout.accountNumber === '000123456789' && shown.data.tax.tin === '123456789', 'a super admin can reveal the full numbers (with a reason, audited)', shown.data);
  const list = await request('GET', '/api/admin/prizes', a);
  check(list.status === 200 && !JSON.stringify(list.data).includes('000123456789'), 'the admin list never shows full numbers', null);

  const [late] = await prizes.createForResults({ ...quest, _id: new mongoose.Types.ObjectId() }, { publishedAt: new Date(Date.now() - 100 * 864e5), winners: [{ user: w._id, ticket: new mongoose.Types.ObjectId(), place: 1, prizeCents: 1000 }] });
  await prizes.forfeitDue();
  check((await PrizeClaim.findById(late._id).lean()).status === 'forfeited', 'unclaimed after 90 days: forfeited', null);

  if (env.key === undefined) delete process.env.PAYEE_DATA_KEY; else process.env.PAYEE_DATA_KEY = env.key;
  if (env.hold === undefined) delete process.env.PRIZE_HOLD_DAYS; else process.env.PRIZE_HOLD_DAYS = env.hold;
  console.log(`\nprizes: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
