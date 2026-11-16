// The ledger, regions and two-person approvals (payment brief 6.1, 6.4, 6.6).
const Stripe = require('stripe');
const User = require('../src/models/User');
const Quest = require('../src/models/Quest');
const Order = require('../src/models/Order');
const LedgerTransaction = require('../src/models/LedgerTransaction');
const RegionRule = require('../src/models/RegionRule');
const payments = require('../src/utils/stripe');
const ledger = require('../src/utils/ledger');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let ok = 0;
  let bad = 0;
  const check = (cond, name, value) => {
    if (cond) { ok += 1; console.log(`  ok  - ${name}`); }
    else { bad += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1500)); }
  };
  async function request(method, path, token, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test';
  const signer = new Stripe('sk_test_signer');
  let n = 0;
  async function webhook(type, object) {
    n += 1;
    const payload = JSON.stringify({ id: `evt_ledger_${Date.now()}_${n}`, type, data: { object } });
    const header = signer.webhooks.generateTestHeaderString({ payload, secret });
    return fetch(`${baseUrl}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload });
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300)); // recordOrderLater is fire-and-forget
  const fake = payments._fake();
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  async function makeUser(name, extra = {}) {
    const user = await User.create({
      profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, lastName: 'Test', avatarKey: 'green-knight', age: 30 },
      email: `${name.toLowerCase()}_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants', ...extra,
    });
    return { user, token: signToken(user.id, user.tokenVersion) };
  }
  const adminA = await makeUser('LedgerAdminA', { platformRole: 'admin', adminSince: new Date() });
  const adminB = await makeUser('LedgerAdminB', { platformRole: 'admin', adminSince: new Date() });
  const member = await makeUser('LedgerMember');
  const tokenA = (await request('POST', '/api/admin/auth/exchange', adminA.token)).data.token;
  const tokenB = (await request('POST', '/api/admin/auth/exchange', adminB.token)).data.token;
  const venue = { name: 'Waterfront Plaza', address: '1 Harbor Dr', city: 'San Diego', country: 'United States', lat: 32.7157, lng: -117.1611 };
  const quest = await Quest.create({ slug: `ledger-${suffix}`, title: 'Ledger Night', status: 'upcoming', isPublished: true, startsAt: new Date(Date.now() + 72 * 3600e3), endsAt: new Date(Date.now() + 75 * 3600e3), location: venue, prizePool: { amount: 100, currency: 'USD' }, entryFee: { amount: 12, currency: 'USD' }, maxParticipants: 5 });
  const pool = `quest_pool:${quest.id}`;

  console.log('\n--- ticket money in the ledger ---');
  const started = await request('POST', `/api/quests/${quest.id}/checkout`, member.token, {});
  await webhook('checkout.session.completed', fake._pay((await Order.findById(started.data.order.id)).stripe.checkoutSessionId));
  await settle();
  const sale = await LedgerTransaction.findOne({ key: `order-paid-${started.data.order.id}` });
  check(sale && sale.kind === 'ticket.sale' && sale.lines.find((l) => l.account === 'processor_clearing').debit === 1200 && sale.lines.find((l) => l.account === pool).credit === 1200, 'a paid ticket: 1200 cents into the quest prize pool', sale);
  await ledger.recordOrder(started.data.order.id);
  await ledger.recordOrder(started.data.order.id);
  check((await LedgerTransaction.countDocuments({ order: started.data.order.id })) === 1, 'recorded once, however often it is called', null);
  // tickets.js passes an order's id (an ObjectId, which has an _id of its own).
  const byId = await Order.findById(started.data.order.id).select('_id');
  check((await ledger.recordOrder(byId._id)).length === 1, 'recordOrder takes an order id as well as the order', null);
  const refunded = await request('POST', `/api/admin/orders/${started.data.order.id}/refund`, tokenA, { reason: 'Ledger test' });
  await settle();
  const refund = await LedgerTransaction.findOne({ key: `order-refund-${started.data.order.id}` });
  check(refunded.status === 200 && refund?.kind === 'ticket.refund' && refund.lines.find((l) => l.account === pool).debit === 1200, 'a refund: 1200 cents back out of the pool', refund);
  const bal = await request('GET', `/api/admin/ledger/balances?book=money&prefix=quest_pool:${quest.id}`, tokenA);
  check(bal.status === 200 && bal.data.balances.length === 1 && bal.data.balances[0].balance === 0, 'the pool is back to 0 after the refund', bal.data);
  const books = await request('GET', '/api/admin/ledger/check', tokenA);
  check(books.status === 200 && books.data.ok === true && books.data.books.every((b) => Number.isInteger(b.transactions) && b.transactions > 0), 'debits = credits for every book (with how many transactions)', books.data);

  console.log('\n--- missed entries are filled in ---');
  const other = await request('POST', `/api/quests/${quest.id}/checkout`, member.token, {});
  const otherOrder = await Order.findById(other.data.order.id);
  fake._pay(otherOrder.stripe.checkoutSessionId);
  await require('../src/utils/tickets').fulfil(otherOrder, { paymentIntentId: 'pi_ledger_late', amountTotal: 1200, currency: 'usd', via: 'test' });
  await settle();
  await LedgerTransaction.collection.deleteMany({ order: otherOrder._id }); // as if the entry had been lost (test only, raw driver)
  const added = await ledger.syncDue();
  check(added >= 1 && (await LedgerTransaction.countDocuments({ order: otherOrder._id })) === 1, 'the background sync fills in a missing entry', added);

  console.log('\n--- corrections, never edits ---');
  const list = await request('GET', `/api/admin/ledger/transactions?kind=ticket.sale`, tokenA);
  check(list.status === 200 && list.data.transactions.length >= 1, 'the transaction list', list.data);
  const target = list.data.transactions[0];
  const noReason = await request('POST', `/api/admin/ledger/transactions/${target.id}/reverse`, tokenA, { reason: '' });
  check(noReason.status === 400, 'a correction needs a reason', noReason.data);
  const reversed = await request('POST', `/api/admin/ledger/transactions/${target.id}/reverse`, tokenA, { reason: 'Booked twice by mistake' });
  check(reversed.status === 201 && reversed.data.transaction.kind === 'reversal' && reversed.data.transaction.reverses === target.id, 'a reversal transaction (debits and credits swapped)', reversed.data);
  const twice = await request('POST', `/api/admin/ledger/transactions/${target.id}/reverse`, tokenA, { reason: 'Again' });
  check(twice.status === 409, 'a transaction is reversed only once', twice.data);
  let edited = true;
  try { await LedgerTransaction.updateOne({ _id: target.id }, { $set: { memo: 'changed' } }); } catch { edited = false; }
  check(!edited, 'editing an entry is refused (append-only)', null);

  console.log('\n--- export ---');
  const csv = await fetch(`${baseUrl}/api/admin/ledger/export?book=money`, { headers: { Authorization: `Bearer ${tokenA}` } });
  const body = await csv.text();
  check(csv.status === 200 && /^"?transaction"?,/.test(body) && body.includes(pool), 'CSV export, one row per line', body.slice(0, 200));
  const memberExport = await request('GET', '/api/admin/ledger/export', member.token);
  check(memberExport.status === 401, 'only admins see the ledger', memberExport.status);

  console.log('\n--- regions need a second admin ---');
  const requested = await request('POST', '/api/admin/regions/requests', tokenA, { changes: [{ region: 'us-ca', name: 'California', status: 'allowed' }], reason: 'Per legal advice' });
  check(requested.status === 201 && requested.data.request.status === 'pending' && requested.data.request.changes[0].region === 'US-CA', 'a region change waits for approval', requested.data);
  check(!(await RegionRule.findOne({ region: 'US-CA' })), '...and nothing changes yet', null);
  const own = await request('POST', `/api/admin/approvals/${requested.data.request.id}/approve`, tokenA, {});
  check(own.status === 403 && own.data.code === 'own_request', "the requester can't approve their own request", own.data);
  const badRegion = await request('POST', '/api/admin/regions/requests', tokenA, { changes: [{ region: 'California', status: 'allowed' }], reason: 'Typo test' });
  check(badRegion.status === 400 && badRegion.data.code === 'bad_region', 'region codes are checked (US-CA)', badRegion.data);
  const approved = await request('POST', `/api/admin/approvals/${requested.data.request.id}/approve`, tokenB, { note: 'Checked with Peter' });
  const rule = await RegionRule.findOne({ region: 'US-CA' });
  check(approved.status === 200 && approved.data.request.status === 'approved' && rule?.status === 'allowed', 'a second admin approves: the rule is applied', { approved: approved.data, rule });
  const again = await request('POST', `/api/admin/approvals/${requested.data.request.id}/approve`, tokenB, {});
  check(again.status === 409, 'a request is decided once', again.data);
  const second = await request('POST', '/api/admin/regions/requests', tokenA, { changes: [{ region: 'US-TX', status: 'blocked' }], reason: 'Per legal advice' });
  const noNote = await request('POST', `/api/admin/approvals/${second.data.request.id}/reject`, tokenB, { note: '' });
  check(noNote.status === 400, 'a rejection needs a note', noNote.data);
  const rejected = await request('POST', `/api/admin/approvals/${second.data.request.id}/reject`, tokenB, { note: 'Wait for the final list' });
  check(rejected.status === 200 && !(await RegionRule.findOne({ region: 'US-TX' })), 'rejected: nothing changes', rejected.data);
  const regions = await request('GET', '/api/admin/regions', tokenA);
  check(regions.status === 200 && regions.data.regions.some((r) => r.region === 'US-CA' && r.status === 'allowed'), 'the region table', regions.data);
  const pending = await request('GET', '/api/admin/approvals?status=approved', tokenA);
  check(pending.status === 200 && pending.data.requests.some((r) => r.id === requested.data.request.id), 'the approvals list', pending.data);

  console.log(`\nledger: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
