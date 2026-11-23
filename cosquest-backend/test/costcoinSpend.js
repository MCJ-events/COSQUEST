// Spending CosCoin: atomic, once per key, never below zero, owned-once items, frozen wallets.
const User = require('../src/models/User');
const Wallet = require('../src/models/Wallet');
const LedgerTransaction = require('../src/models/LedgerTransaction');
const ItemCatalogVersion = require('../src/models/ItemCatalogVersion');
const Counter = require('../src/models/Counter');
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
  const suffix = `${Date.now() % 1e7}${Math.floor(Math.random() * 100)}`;
  const u = await User.create({ profile: { username: `CsAna${suffix}`, usernameNormalized: `csana${suffix}`, firstName: 'Ana', avatarKey: 'green-knight', age: 30 }, email: `csana_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants' });
  const token = signToken(u.id, u.tokenVersion);
  await ItemCatalogVersion.create({ version: await Counter.next('itemCatalog', 1), approval: new mongoose.Types.ObjectId(), items: [
    { id: 'SK-07', name: 'Neon skin', kind: 'skin', priceCosCoin: 300, game: 'all', status: 'active' },
    { id: 'AM-50', name: '50 arrows', kind: 'ammo', priceCosCoin: 40, stackable: true, game: 'costquest', status: 'active' },
    { id: 'WP-AXE', name: 'War axe', kind: 'weapon', priceCosCoin: null, game: 'costquest', status: 'open' },
  ] });
  await Wallet.create({ user: u._id, balance: 500, applied: ['buy:seed'] });

  const list = await request('GET', '/api/costcoin/items?game=costquest', token);
  check(list.status === 200 && list.data.items.length === 2 && !list.data.items.some((i) => i.id === 'WP-AXE'), 'items on sale for CostQuest (the open axe is hidden)', list.data);
  const noKey = await request('POST', '/api/costcoin/spend', token, { itemId: 'SK-07' });
  check(noKey.status === 400 && noKey.data.code === 'key_required', 'a spend needs a unique key', noKey.data);
  const key = `spend-${suffix}-1`;
  const bought = await request('POST', '/api/costcoin/spend', token, { itemId: 'SK-07', key, game: 'costquest' });
  check(bought.status === 200 && bought.data.spent === 300 && bought.data.balance === 200 && !bought.data.replay, 'spend 300 on the Neon skin: balance 200', bought.data);
  const again = await request('POST', '/api/costcoin/spend', token, { itemId: 'SK-07', key, game: 'costquest' });
  check(again.status === 200 && again.data.replay && again.data.balance === 200, 'the same key again (a retry): no second charge', again.data);
  const owned = await request('POST', '/api/costcoin/spend', token, { itemId: 'SK-07', key: `spend-${suffix}-2` });
  check(owned.status === 409 && owned.data.code === 'already_owned', "a skin can't be bought twice (nothing charged)", owned.data);
  const ammo1 = await request('POST', '/api/costcoin/spend', token, { itemId: 'AM-50', key: `spend-${suffix}-3`, game: 'costquest' });
  const ammo2 = await request('POST', '/api/costcoin/spend', token, { itemId: 'AM-50', key: `spend-${suffix}-4`, game: 'costquest' });
  check(ammo1.status === 200 && ammo2.status === 200 && ammo2.data.balance === 120, 'ammo stacks: bought twice, balance 120', ammo2.data);
  const short = await request('POST', '/api/costcoin/spend', token, { itemId: 'AM-50', key: `spend-${suffix}-5`, game: 'costquest' });
  const poor = await request('POST', '/api/costcoin/spend', token, { itemId: 'SK-07', key: `spend-${suffix}-6` });
  check(short.status === 200 && poor.status === 409, 'balance 80 after a third ammo', [short.data, poor.data]);
  await Wallet.updateOne({ user: u._id }, { $set: { balance: 20 } });
  const broke = await request('POST', '/api/costcoin/spend', token, { itemId: 'AM-50', key: `spend-${suffix}-7`, game: 'costquest' });
  check(broke.status === 402 && broke.data.code === 'not_enough_coins' && broke.data.topUp === true && broke.data.price === 40, 'not enough coins: 402 with "top up on the web"', broke.data);
  // Two taps at once with 40 coins and two 40-coin items: only one goes through.
  await Wallet.updateOne({ user: u._id }, { $set: { balance: 40 } });
  const [t1, t2] = await Promise.all([
    request('POST', '/api/costcoin/spend', token, { itemId: 'AM-50', key: `spend-${suffix}-8`, game: 'costquest' }),
    request('POST', '/api/costcoin/spend', token, { itemId: 'AM-50', key: `spend-${suffix}-9`, game: 'costquest' }),
  ]);
  const w = await Wallet.findOne({ user: u._id });
  check([t1.status, t2.status].sort().join() === '200,402' && w.balance === 0, 'two taps at once: one spend, never below zero', [t1.status, t2.status, w.balance]);
  await Wallet.updateOne({ user: u._id }, { $set: { balance: 500, frozen: true } });
  const frozen = await request('POST', '/api/costcoin/spend', token, { itemId: 'AM-50', key: `spend-${suffix}-10`, game: 'costquest' });
  check(frozen.status === 423 && frozen.data.code === 'wallet_frozen', 'a frozen wallet (dispute) cannot spend', frozen.data);
  const spends = await LedgerTransaction.find({ kind: 'costcoin.spend', user: u._id });
  check(spends.length === 5 && spends.every((t) => t.lines.find((l) => l.account === 'CC-SPENT').credit > 0), 'the CosCoin ledger has each spend once (5 spends)', spends.length);
  const inv = await request('GET', '/api/costcoin/inventory', token);
  check(inv.data.items.find((i) => i.itemId === 'AM-50').quantity === 4 && inv.data.items.find((i) => i.itemId === 'SK-07').quantity === 1, 'inventory: the skin once, 4 lots of ammo', inv.data);

  console.log(`\ncoscoin spending: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
