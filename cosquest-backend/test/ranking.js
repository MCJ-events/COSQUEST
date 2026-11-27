// Results by points: scores, ranking with the tie-break, draft, publish once, settlement.
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Quest = require('../src/models/Quest');
const Ticket = require('../src/models/Ticket');
const PrizeClaim = require('../src/models/PrizeClaim');
const LedgerTransaction = require('../src/models/LedgerTransaction');
const ledger = require('../src/utils/ledger');
const ranking = require('../src/utils/questRanking');
const settlement = require('../src/utils/settlement');
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
  // Pure rules first.
  const t0 = new Date('2026-11-28T10:00:00Z');
  const rows = [{ ticket: 'a', points: 120, completedAt: new Date(t0.getTime() + 5e3) }, { ticket: 'b', points: 120, completedAt: t0 }, { ticket: 'c', points: 80, completedAt: t0 }];
  const early = ranking.rank(rows, 'earliest_completion');
  check(early[0].ticket === 'b' && early[0].place === 1 && early[1].place === 2 && early[2].place === 3, 'tie on points: the earlier completion wins', early);
  const split = ranking.rank(rows, 'split_prize');
  check(split[0].place === 1 && split[1].place === 1 && split[2].place === 3 && split[0].tied, 'tie with "prize shared": both 1st, next is 3rd', split);
  const shared = ranking.prizesFor(split, 2000, [60, 40]);
  check(shared.get('a') === 1000 && shared.get('b') === 1000 && !shared.get('c'), 'tied players share the 1st and 2nd prizes equally ($10 each)', [...shared]);

  const env = { key: process.env.GAME_REWARDS_KEY };
  process.env.GAME_REWARDS_KEY = 'test-game-key-123';
  const suffix = `${Date.now() % 1e7}${Math.floor(Math.random() * 100)}`;
  const admin = await User.create({ profile: { username: `RkA${suffix}`, usernameNormalized: `rka${suffix}`, firstName: 'A', avatarKey: 'green-knight' }, email: `rka_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants', platformRole: 'admin', adminSince: new Date() });
  const a = (await request('POST', '/api/admin/auth/exchange', signToken(admin.id, admin.tokenVersion))).data.token;
  const players = [];
  for (const n of ['Ada', 'Ben', 'Cy']) players.push(await User.create({ profile: { username: `Rk${n}${suffix}`, usernameNormalized: `rk${n.toLowerCase()}${suffix}`, firstName: n, avatarKey: 'green-knight' }, email: `rk${n.toLowerCase()}_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants' }));
  const start = new Date(Date.now() - 5 * 3600e3);
  const quest = await Quest.create({ title: `Ranked quest ${suffix}`, slug: `ranked-${suffix}`, kind: 'event', format: 'virtual', placeLabel: 'Online', status: 'upcoming', isPublished: true, startsAt: start, endsAt: new Date(Date.now() - 3600e3), entryFee: { amount: 10, currency: 'USD' }, prizePool: { amount: 20, currency: 'USD' }, prizeSplitPct: [60, 40], maxParticipants: 10, scoring: { rules: 'Points per checkpoint found; finishing bonus.', tieBreak: 'earliest_completion', version: 1 }, location: { name: '', address: '', lat: 0, lng: 0 } });
  const tickets = [];
  for (const p of players) {
    tickets.push(await Ticket.create({ code: `RK-${suffix}-${p.profile.firstName}`, order: new mongoose.Types.ObjectId(), user: p._id, quest: quest._id, ticketType: new mongoose.Types.ObjectId(), status: 'valid' }));
    await ledger.record({ key: `rk-entry-${suffix}-${p._id}`, kind: 'quest.entry', book: 'money', currency: 'USD', lines: [{ account: '1010', debit: 1000 }, { account: ledger.ACCOUNTS.questPool(quest._id), credit: 1000 }], quest: quest._id, user: p._id, memo: 'test entry' });
  }
  const game = { 'x-game-key': 'test-game-key-123' };
  check((await request('POST', `/api/quests/${quest._id}/scores`, null, { userId: players[0].id, points: 120 })).status === 401, 'scores need the game key', null);
  await request('POST', `/api/quests/${quest._id}/scores`, null, { userId: players[0].id, points: 120, completedAt: new Date(t0.getTime() + 5e3).toISOString() }, game);
  await request('POST', `/api/quests/${quest._id}/scores`, null, { userId: players[1].id, points: 120, completedAt: t0.toISOString() }, game);
  const noWhy = await request('PUT', `/api/admin/quests/${quest._id}/scores`, a, { scores: [{ ticketId: String(tickets[2]._id), points: 80 }] });
  check(noWhy.status === 400, 'an admin entering points must give a reason', noWhy.data);
  check((await request('PUT', `/api/admin/quests/${quest._id}/scores`, a, { scores: [{ ticketId: String(tickets[2]._id), points: 80 }], reason: 'Venue score sheet' })).status === 200, 'an admin enters points with a reason', null);
  const r = await request('GET', `/api/admin/quests/${quest._id}/ranking`, a);
  check(r.status === 200 && r.data.rows[0].user === players[1].id && r.data.rows[0].prizeCents === 1200 && r.data.rows[1].prizeCents === 800, 'ranking: Ben 1st ($12), Ada 2nd ($8): earlier completion breaks the tie', r.data);
  const drafted = await request('POST', `/api/admin/quests/${quest._id}/ranking/draft`, a, {});
  check(drafted.status === 200 && drafted.data.winners === 2, 'the draft is filled from the ranking (2 prize winners)', drafted.data);
  const pub = await request('POST', `/api/admin/quests/${quest._id}/results/publish`, a, {});
  check(pub.status === 200, 'results published once', pub.data);
  check((await request('POST', `/api/admin/quests/${quest._id}/results/publish`, a, {})).status === 409, 'publishing again is refused', null);
  check((await request('PUT', `/api/admin/quests/${quest._id}/scores`, a, { scores: [{ ticketId: String(tickets[2]._id), points: 500 }], reason: 'Late change' })).status === 409, 'after publishing, points are locked', null);
  const win = await LedgerTransaction.findOne({ key: `settlement-winner-${quest._id}` });
  const plat = await LedgerTransaction.findOne({ key: `settlement-platform-${quest._id}` });
  check(win && win.lines.find((l) => l.account === '2020').credit === 2000, 'settlement: $20 of prizes from the pool to Payouts Payable', win);
  check(plat && plat.lines.find((l) => l.account === '4020').credit === 1000, 'settlement: the $10 left goes to Platform Fees', plat);
  check((await settlement.poolBalance(quest._id)) === 0, 'the quest pool is zero after settlement', null);
  const claims = await PrizeClaim.find({ quest: quest._id }).sort({ place: 1 }).lean();
  check(claims.length === 2 && claims[0].amountCents === 1200 && claims[0].points === 120 && claims[0].scoringVersion === 1, 'prizes to claim are created with points and the scoring version', claims);
  const checks = await ledger.financeChecks();
  const pools = checks.find((c) => /pool/i.test(c.name) && /settle/i.test(c.name));
  check(!pools || pools.pass !== false, "finance check: this quest's pool is settled", pools);
  await PrizeClaim.collection.updateOne({ _id: claims[1]._id }, { $set: { claimDeadline: new Date(Date.now() - 1000) } });
  await require('../src/utils/prizes').forfeitDue();
  const back = await LedgerTransaction.findOne({ key: `prize-unpaid-${claims[1]._id}` });
  check(back && back.lines.find((l) => l.account === '4020').credit === 800, 'a forfeited prize goes back to the platform in the ledger', back);

  if (env.key === undefined) delete process.env.GAME_REWARDS_KEY; else process.env.GAME_REWARDS_KEY = env.key;
  console.log(`\nresults ranking: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
