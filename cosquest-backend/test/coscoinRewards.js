// CosCoin earned in games, bought-only items, fraud flags (agreed with Subomi, 23 Nov).
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Wallet = require('../src/models/Wallet');
const LedgerTransaction = require('../src/models/LedgerTransaction');
const ItemCatalogVersion = require('../src/models/ItemCatalogVersion');
const Counter = require('../src/models/Counter');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let ok = 0;
  let bad = 0;
  const check = (cond, name, value) => {
    if (cond) { ok += 1; console.log(`  ok  - ${name}`); }
    else { bad += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1200)); }
  };
  async function request(method, path, token, body, headers = {}) {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  }
  const before = { key: process.env.GAME_REWARDS_KEY, cap: process.env.COSCOIN_REWARD_DAILY_CAP };
  process.env.GAME_REWARDS_KEY = 'test-game-key-123';
  process.env.COSCOIN_REWARD_DAILY_CAP = '150';
  const game = { 'x-game-key': 'test-game-key-123' };
  const suffix = `${Date.now() % 1e7}${Math.floor(Math.random() * 100)}`;
  const u = await User.create({ profile: { username: `RwAna${suffix}`, usernameNormalized: `rwana${suffix}`, firstName: 'Ana', avatarKey: 'green-knight', age: 30 }, email: `rwana_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants' });
  const token = signToken(u.id, u.tokenVersion);

  const noKey = await request('POST', '/api/costcoin/game/rewards', null, { userId: u.id, amount: 10, reason: 'Won', key: `rw-${suffix}-0` });
  check(noKey.status === 401, 'rewards need the game key (an app can never give itself coins)', noKey.data);
  const r1 = await request('POST', '/api/costcoin/game/rewards', null, { userId: u.id, amount: 100, reason: 'Won raid R-12', key: `rw-${suffix}-1`, game: 'costquest' }, game);
  check(r1.status === 200 && r1.data.granted === 100 && r1.data.balance === 100, 'the game gives 100 CosCoin', r1.data);
  const again = await request('POST', '/api/costcoin/game/rewards', null, { userId: u.id, amount: 100, reason: 'Won raid R-12', key: `rw-${suffix}-1` }, game);
  check(again.status === 200 && again.data.replay && again.data.balance === 100, 'the same reward again (a retry): paid once', again.data);
  const capped = await request('POST', '/api/costcoin/game/rewards', null, { userId: u.id, amount: 100, reason: 'Won again', key: `rw-${suffix}-2` }, game);
  check(capped.status === 429 && capped.data.code === 'daily_cap', 'over the daily cap (150): refused', capped.data);
  const reward = await LedgerTransaction.findOne({ kind: 'costcoin.reward', user: u._id });
  check(reward && reward.lines.find((l) => l.account === 'CC-REWARDS').debit === 100, 'ledger: Reward, CosCoin Rewards > Wallet', reward);
  const mine = await request('GET', '/api/costcoin/wallet', token);
  check(mine.data.balance === 100 && mine.data.earned === 100 && mine.data.bought === 0, 'the wallet shows 100 earned, 0 bought', mine.data);

  // Bought-only items and earned-first spending.
  await Wallet.updateOne({ user: u._id }, { $set: { balance: 300, purchased: 200 } });
  await ItemCatalogVersion.create({ version: await Counter.next('itemCatalog', 1), approval: new mongoose.Types.ObjectId(), items: [
    { id: 'SK-GOLD', name: 'Gold skin', kind: 'skin', priceCosCoin: 250, boughtCoinsOnly: true, game: 'all', status: 'active' },
    { id: 'SK-BLUE', name: 'Blue skin', kind: 'skin', priceCosCoin: 150, game: 'all', status: 'active' },
  ] });
  const gold = await request('POST', '/api/costcoin/spend', token, { itemId: 'SK-GOLD', key: `sp-${suffix}-1` });
  check(gold.status === 402 && gold.data.code === 'not_enough_bought_coins' && gold.data.bought === 200, 'a bought-only item needs 250 bought coins (has 200): refused', gold.data);
  const blue = await request('POST', '/api/costcoin/spend', token, { itemId: 'SK-BLUE', key: `sp-${suffix}-2` });
  const w = await Wallet.findOne({ user: u._id });
  check(blue.status === 200 && w.balance === 150 && w.purchased === 150, 'a normal item takes earned coins first (100 earned + 50 bought): 150 bought left', { status: blue.status, balance: w.balance, purchased: w.purchased });

  // Fraud flags.
  const flagged = await request('POST', '/api/costcoin/game/flags', null, { userId: u.id, reason: 'Rewards farmed by a script', game: 'costquest' }, game);
  check(flagged.status === 200 && flagged.data.frozen === true, 'the game flags the wallet for fraud: frozen', flagged.data);
  const frozenReward = await request('POST', '/api/costcoin/game/rewards', null, { userId: u.id, amount: 10, reason: 'Won', key: `rw-${suffix}-3` }, game);
  check(frozenReward.status === 423, 'a frozen wallet earns nothing', frozenReward.data);
  const gw = await request('GET', `/api/costcoin/game/wallet/${u.id}`, null, undefined, game);
  check(gw.data.frozen === true && gw.data.balance === 150, 'the game can read the wallet (frozen, 150)', gw.data);

  process.env.GAME_REWARDS_KEY = before.key;
  process.env.COSCOIN_REWARD_DAILY_CAP = before.cap;
  if (before.key === undefined) delete process.env.GAME_REWARDS_KEY;
  if (before.cap === undefined) delete process.env.COSCOIN_REWARD_DAILY_CAP;
  console.log(`\ncoscoin rewards: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
