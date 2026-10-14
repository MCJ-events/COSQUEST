/**
 * Backend pieces for the chat page designs: faction ranks (GET /api/ranks and
 * `rank` on senders / member lists), the online count in a chat's header
 * (GET /api/chats/:id onlineCount) and search by date range / oldest first.
 */
const User = require('../src/models/User');
const { signToken } = require('../src/utils/token');
const { rankFor, getLadder } = require('../src/utils/ranks');

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;

  function check(ok, name, value) {
    if (ok) {
      pass += 1;
      console.log(`  ok  - ${name}`);
    } else {
      fail += 1;
      console.log(`FAIL - ${name}`, JSON.stringify(value));
    }
  }

  async function request(method, path, token, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  }

  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const make = async (index, extra = {}) => {
    const user = await User.create({
      profile: {
        username: `Pg${index}${suffix}`,
        usernameNormalized: `pg${index}${suffix}`,
        firstName: 'Pg',
        lastName: `User${index}`,
        avatarKey: 'green-knight',
      },
      onboardingComplete: true,
      faction: 'celestials',
      ...extra,
    });
    return { id: user.id, username: user.profile.username, token: signToken(user.id, user.tokenVersion) };
  };

  // a: 0 points (Private). b: 1600 (Sergeant). c: set to Major by hand, hides
  // online status. d: unknown override key, 600 points (Corporal). e: outsider.
  const a = await make(1);
  const b = await make(2, { pointsBalance: 1600 });
  const c = await make(3, { rankOverride: 'major', privacy: { showOnlineStatus: false } });
  const d = await make(4, { rankOverride: 'no_such_rank', pointsBalance: 600 });
  const e = await make(5, { faction: 'icons' });

  console.log('\n--- chat pages: rank ladder ---');
  const ranks = await request('GET', '/api/ranks');
  const list = ranks.data.ranks || [];
  check(ranks.status === 200 && list.length === 8, 'GET /api/ranks is public and lists 8 ranks', ranks);
  check(
    list.map((r) => r.short).join() === 'PVT,CPL,SGT,SSG,LT,CPT,MAJ,CDR' && list.every((r, i) => r.level === i + 1),
    'lowest first, levels 1..8',
    list.map((r) => [r.short, r.level])
  );
  check(
    list.every((r) => typeof r.key === 'string' && typeof r.name === 'string' && Number.isInteger(r.chevrons) && Number.isInteger(r.bars) && typeof r.star === 'boolean' && typeof r.minPoints === 'number'),
    'every rank has key, name, short, level, chevrons, bars, star, minPoints',
    list
  );
  const byKey = Object.fromEntries(list.map((r) => [r.key, r]));
  check(
    byKey.private.minPoints === 0 && byKey.private.chevrons === 1 && byKey.corporal.minPoints === 500 && byKey.sergeant.minPoints === 1500 &&
      byKey.staff_sergeant.minPoints === 3500 && byKey.staff_sergeant.chevrons === 3 && byKey.staff_sergeant.bars === 1 &&
      byKey.lieutenant.bars === 1 && byKey.lieutenant.chevrons === 0 && byKey.captain.bars === 2 && byKey.major.star === true && byKey.commander.star === true && byKey.commander.bars === 1,
    'the default ladder (insignia and placeholder point levels)',
    byKey
  );

  const saved = process.env.RANKS_JSON;
  process.env.RANKS_JSON = JSON.stringify([
    { key: 'cadet', name: 'Cadet', minPoints: 0, chevrons: 1 },
    { key: 'hero', name: 'Hero', short: 'HRO', minPoints: 100, star: true },
  ]);
  const custom = await request('GET', '/api/ranks');
  check(
    custom.data.ranks?.length === 2 && custom.data.ranks[0].key === 'cadet' && custom.data.ranks[0].short === 'CAD' && custom.data.ranks[1].level === 2 && custom.data.ranks[1].star === true,
    'RANKS_JSON replaces the whole ladder (short and level filled in)',
    custom.data
  );
  check(rankFor({ pointsBalance: 150 }).key === 'hero', 'and ranks follow it');
  process.env.RANKS_JSON = '[{"key":"x","name":"X","minPoints":5}]';
  check(getLadder().length === 8, 'a RANKS_JSON with no rank at 0 points is ignored (default ladder)');
  process.env.RANKS_JSON = 'not json';
  check(getLadder()[0].key === 'private', 'an unreadable RANKS_JSON is ignored (default ladder)');
  if (saved === undefined) delete process.env.RANKS_JSON;
  else process.env.RANKS_JSON = saved;

  check(rankFor({ pointsBalance: 1499 }).key === 'corporal' && rankFor({ pointsBalance: 1500 }).key === 'sergeant' && rankFor({ pointsBalance: 10 ** 9 }).key === 'commander', 'points pick the highest rung reached');
  check(rankFor({ pointsBalance: 0, rankOverride: 'captain' }).overridden === true && rankFor({ pointsBalance: 99999 }).overridden === undefined, 'a hand-set rank says overridden: true');

  console.log('\n--- chat pages: rank on senders and members ---');
  const created = await request('POST', '/api/groups', a.token, { name: 'Pages Club', kind: 'private', members: [b.id, c.id, d.id] });
  const groupId = created.data.group?.id;
  check(created.status === 201 && groupId, 'a group to test in', created);
  await request('POST', `/api/chats/${groupId}/messages`, b.token, { content: 'hello from the sergeant' });
  await request('POST', `/api/chats/${groupId}/messages`, c.token, { content: 'hello from the major' });
  const messages = (await request('GET', `/api/chats/${groupId}/messages`, a.token)).data.messages || [];
  const fromB = messages.find((m) => m.sender?.id === b.id)?.sender;
  const fromC = messages.find((m) => m.sender?.id === c.id)?.sender;
  check(
    fromB?.rank?.key === 'sergeant' && fromB.rank.short === 'SGT' && fromB.rank.level === 3 && fromB.rank.chevrons === 3 && fromB.rank.overridden === undefined,
    'message.sender.rank follows points',
    fromB
  );
  check(fromC?.rank?.key === 'major' && fromC.rank.overridden === true && fromC.rank.star === true, 'a hand-set rank shows on the sender with overridden: true', fromC);
  check(fromB && !('minPoints' in fromB.rank) && !('pointsBalance' in fromB) && !('rankOverride' in fromB), 'previews never show points or the override field', fromB);

  const chatMembers = (await request('GET', `/api/chats/${groupId}/members`, a.token)).data.members || [];
  const rankOf = (people, id) => people.find((m) => m.id === id)?.rank;
  check(
    rankOf(chatMembers, b.id)?.key === 'sergeant' && rankOf(chatMembers, c.id)?.key === 'major' && rankOf(chatMembers, d.id)?.key === 'corporal' && rankOf(chatMembers, d.id)?.overridden === undefined,
    'GET /api/chats/:id/members: rank on each member (an unknown override key falls back to points)',
    chatMembers
  );
  const groupMembers = (await request('GET', `/api/groups/${groupId}/members`, a.token)).data.members || [];
  check(
    rankOf(groupMembers, a.id)?.key === 'private' && rankOf(groupMembers, b.id)?.key === 'sergeant' && rankOf(groupMembers, c.id)?.overridden === true,
    'GET /api/groups/:id/members: rank on each member',
    groupMembers
  );

  return { pass, fail };
}

module.exports = { run };
