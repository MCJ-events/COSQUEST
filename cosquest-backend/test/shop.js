// The Shop: one call for the screen, sections, timers, owned, the free reward once.
const mongoose = require('mongoose');
const User = require('../src/models/User');
const ItemCatalogVersion = require('../src/models/ItemCatalogVersion');
const Wallet = require('../src/models/Wallet');
const Counter = require('../src/models/Counter');
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
  const u = await User.create({ profile: { username: `ShAna${suffix}`, usernameNormalized: `shana${suffix}`, firstName: 'Ana', avatarKey: 'green-knight', age: 30 }, email: `shana_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants' });
  const token = signToken(u.id, u.tokenVersion);
  const soon = new Date(Date.now() + 2 * 864e5);
  await ItemCatalogVersion.create({ version: await Counter.next('itemCatalog', 1), approval: new mongoose.Types.ObjectId(), items: [
    { id: 'SK-CCC', name: 'CCC', subtitle: 'Guardian of Hours – Dimensional', imageUrl: 'https://example.com/ccc.png', kind: 'skin', priceCosCoin: 22, section: 'elite_merch', newTag: true, dropEndsAt: new Date(Date.now() + 22 * 864e5), game: 'all', status: 'active' },
    { id: 'SK-OLD', name: 'Old drop', kind: 'skin', priceCosCoin: 5, section: 'elite_merch', dropEndsAt: new Date(Date.now() - 1000), game: 'all', status: 'active' },
    { id: 'EM-BYE', name: 'Bye!', kind: 'cosmetic', priceCosCoin: 30, section: 'remix', dropEndsAt: soon, game: 'all', status: 'active' },
    { id: 'RW-FREE', name: 'Free reward', kind: 'cosmetic', priceCosCoin: null, free: true, section: 'remix', dropEndsAt: soon, game: 'all', status: 'active' },
  ] });
  await Wallet.updateOne({ user: u._id }, { $set: { balance: 40, purchased: 40 } }, { upsert: true });

  const s = await request('GET', '/api/shop', token);
  check(s.status === 200 && s.data.serverTime && /no cash value/i.test(s.data.notice), 'one call: server time and the no-cash-value notice', s.data);
  check(s.data.balance.balance === 40, 'the CosCoin balance', s.data.balance);
  check(s.data.eliteMerch.length === 1 && s.data.eliteMerch[0].subtitle && s.data.eliteMerch[0].isNew && s.data.eliteMerch[0].imageUrl, 'Elite Merch: picture, subtitle, NEW; an ended drop is gone', s.data.eliteMerch);
  check(s.data.remix.free?.id === 'RW-FREE' && s.data.remix.offers.length === 1 && s.data.remix.endsAt, "Manny's Remix: the free reward, the offers and when it ends", s.data.remix);
  check((await request('POST', '/api/costcoin/spend', token, { itemId: 'RW-FREE', key: `k-${suffix}-1` })).status === 409, 'a free reward cannot be "bought"', null);
  check((await request('POST', '/api/costcoin/spend', token, { itemId: 'SK-OLD', key: `k-${suffix}-2` })).status === 404, 'an ended drop cannot be bought', null);
  const claim = await request('POST', '/api/shop/free/RW-FREE', token);
  check(claim.status === 200 && claim.data.claimed, 'the free reward is claimed', claim.data);
  check((await request('POST', '/api/shop/free/RW-FREE', token)).status === 409, 'once only per period', null);
  check((await request('POST', '/api/shop/free/EM-BYE', token)).status === 404, 'only free rewards can be claimed', null);
  const buy = await request('POST', '/api/costcoin/spend', token, { itemId: 'SK-CCC', key: `k-${suffix}-3` });
  check(buy.status === 200 && buy.data.balance === 18, 'buying CCC for 22: 18 left', buy.data);
  const after = await request('GET', '/api/shop', token);
  check(after.data.eliteMerch[0].owned === 1 && after.data.remix.free.claimed === true && after.data.balance.balance === 18, 'the shop shows Owned, Claimed and the new balance', after.data);

  console.log(`\nshop: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
