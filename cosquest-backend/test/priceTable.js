// The Costcoin price table: versions, two-person approval, open bundles never on sale.
const User = require('../src/models/User');
const PriceTableVersion = require('../src/models/PriceTableVersion');
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
  const mk = async (name) => {
    const u = await User.create({ profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, avatarKey: 'green-knight' }, email: `${name.toLowerCase()}_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants', platformRole: 'admin', adminSince: new Date() });
    return (await request('POST', '/api/admin/auth/exchange', signToken(u.id, u.tokenVersion))).data.token;
  };
  const a = await mk('PtA');
  const b = await mk('PtB');
  const table = [
    { id: 'B-80', name: 'Small bundle', price: 1, costcoin: 80, status: 'active' },
    { id: 'B-500', name: 'Medium bundle', price: 4, costcoin: 500, status: 'active' },
    { id: 'B-STARTER', name: 'Starter pack', price: 20, costcoin: null, status: 'open' },
  ];
  const cheap = await request('POST', '/api/admin/price-table/requests', a, { bundles: [{ id: 'B-1', name: 'Too cheap', price: 0.2, costcoin: 10 }], reason: 'Test' });
  check(cheap.status === 400 && cheap.data.code === 'bad_price', "a price under Stripe's $0.50 minimum is refused", cheap.data);
  const noCoins = await request('POST', '/api/admin/price-table/requests', a, { bundles: [{ id: 'B-9', name: 'No coins', price: 5, status: 'active' }], reason: 'Test' });
  check(noCoins.status === 400 && noCoins.data.code === 'bad_costcoin', 'an active bundle needs its Costcoin amount', noCoins.data);
  const asked = await request('POST', '/api/admin/price-table/requests', a, { bundles: table, reason: 'Agreed bundles (Sep 2)' });
  check(asked.status === 201, 'a new table waits for approval', asked.data);
  check((await request('POST', `/api/admin/approvals/${asked.data.request.id}/approve`, a, {})).status === 403, "the requester can't approve it", null);
  check((await request('POST', `/api/admin/approvals/${asked.data.request.id}/approve`, b, { note: 'OK' })).status === 200, 'a second admin approves', null);
  const current = await request('GET', '/api/admin/price-table', a);
  const bundles = current.data.current.bundles;
  check(/^v\d+$/.test(current.data.current.priceVersion) && bundles.length === 3 && bundles.find((x) => x.id === 'B-500').costcoinPerDollar === 125, 'new version: 3 bundles, B-500 = 125 Costcoin per $1 (as the sheet)', current.data);
  const shop = await request('GET', '/api/costcoin/bundles');
  check(shop.status === 200 && shop.data.bundles.length === 2 && !shop.data.bundles.some((x) => x.id === 'B-STARTER'), 'the shop shows only bundles on sale (the open starter pack is hidden)', shop.data);
  let edited = true;
  try { await PriceTableVersion.updateOne({}, { $set: { bundles: [] } }); } catch { edited = false; }
  check(!edited, 'a price table version can never be edited (append-only)', null);

  console.log(`\nprice table: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
