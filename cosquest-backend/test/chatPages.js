/**
 * Backend pieces for the chat page designs: faction ranks (GET /api/ranks and
 * `rank` on senders / member lists), the online count in a chat's header
 * (GET /api/chats/:id onlineCount) and search by date range / oldest first.
 */
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Message = require('../src/models/Message');
const { signToken } = require('../src/utils/token');
const presence = require('../src/realtime/presence');
const { getRedisClient } = require('../src/config/redis');
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

  console.log('\n--- chat pages: online count ---');
  const redis = getRedisClient();
  const detail = async (id, token = a.token) => (await request('GET', `/api/chats/${id}`, token)).data.chat;
  check((await detail(groupId)).onlineCount === 0, 'nobody connected -> onlineCount 0');
  await Promise.all([a, b, c, e].map((user) => presence.markOnline(user.id)));
  const counted = await detail(groupId);
  check(counted.onlineCount === 2, 'counts online members (me included), not people hiding their status, not outsiders', counted.onlineCount);
  // More people online than members: the member list is checked against Redis instead.
  const strangers = Array.from({ length: 20 }, () => String(new mongoose.Types.ObjectId()));
  await redis.sadd('presence:online', ...strangers);
  check((await detail(groupId)).onlineCount === 2, 'same answer when the online set is bigger than the group (SMISMEMBER path)');
  await redis.srem('presence:online', ...strangers);
  await presence.markOffline(b.id);
  check((await detail(groupId)).onlineCount === 1, 'someone going offline drops the count');

  const rooms = (await request('GET', '/api/chats', a.token)).data.chats || [];
  const factionRoom = rooms.find((chat) => chat.type === 'faction');
  const community = rooms.find((chat) => chat.type === 'community');
  const factionBefore = (await detail(factionRoom.id)).onlineCount;
  await presence.markOnline(d.id);
  const factionAfter = (await detail(factionRoom.id)).onlineCount;
  check(Number.isInteger(factionBefore) && factionAfter === factionBefore + 1, 'faction room: members with no member rows are counted', { factionBefore, factionAfter });
  const communityCount = (await detail(community.id)).onlineCount;
  await presence.markOnline(b.id);
  check(Number.isInteger(communityCount) && (await detail(community.id)).onlineCount === communityCount + 1, 'community: counted too');
  check(
    !rooms.some((chat) => 'onlineCount' in chat),
    'the chat list does not compute it (detail only)',
    rooms.map((chat) => Object.keys(chat))
  );
  const dm = await request('POST', '/api/chats/dm', a.token, { username: b.username });
  check((await detail(dm.data.chat.id)).onlineCount === null, 'DMs: onlineCount null (they have isOnline on the other person)');
  await Promise.all([a, b, c, d, e].map((user) => presence.markOffline(user.id)));

  console.log('\n--- chat pages: search by date ---');
  const say = async (content, at) => {
    const sent = await request('POST', `/api/chats/${groupId}/messages`, a.token, { content });
    // Native driver: Mongoose treats createdAt as immutable.
    await Message.collection.updateOne({ _id: new mongoose.Types.ObjectId(sent.data.message.id) }, { $set: { createdAt: new Date(at) } });
    return sent.data.message.id;
  };
  const jan5 = await say('dragonfruit smoothie one', '2026-01-05T10:00:00.000Z');
  const jan10 = await say('dragonfruit smoothie two', '2026-01-10T10:00:00.000Z');
  const jan15 = await say('dragonfruit smoothie three', '2026-01-15T23:59:59.000Z');
  const search = (query) => request('GET', `/api/chats/${groupId}/search?q=dragonfruit${query}`, b.token);
  const ids = (response) => (response.data.results || []).map((result) => result.message.id).join();

  const all = await search('');
  check(all.status === 200 && ids(all) === [jan15, jan10, jan5].join() && all.data.pagination.total === 3, 'no range: everything, newest first (unchanged)', all.data);
  check(ids(await search('&sort=oldest')) === [jan5, jan10, jan15].join(), 'sort=oldest: oldest first');
  check(ids(await search('&sort=newest')) === [jan15, jan10, jan5].join(), 'sort=newest is the default order');
  const fromTen = await search('&from=2026-01-10');
  check(ids(fromTen) === [jan15, jan10].join() && fromTen.data.pagination.total === 2, 'from (a date) is inclusive', fromTen.data);
  check(ids(await search('&to=2026-01-10')) === [jan10, jan5].join(), 'to (a date) includes that whole day');
  check(ids(await search('&from=2026-01-10&to=2026-01-10')) === jan10, 'from = to: just that day');
  check(ids(await search('&to=2026-01-15')) === [jan15, jan10, jan5].join(), 'to includes a message at 23:59:59 that day');
  check(ids(await search('&from=2026-01-10T10:00:00Z&to=2026-01-15T23:59:59.000Z&sort=oldest')) === [jan10, jan15].join(), 'date-times are inclusive to the second');
  check(ids(await search('&to=2026-01-10T09:59:59Z')) === jan5, 'a date-time bound is exact');
  const offset = await search(`&from=${encodeURIComponent('2026-01-10T11:00:00+01:00')}&to=${encodeURIComponent('2026-01-10T11:00:00+01:00')}`);
  check(ids(offset) === jan10, 'time zone offsets are understood', offset.data);
  const shape = all.data;
  check(typeof shape.query === 'string' && Array.isArray(shape.results) && shape.results[0].context && shape.pagination, 'response shape unchanged ({ query, results: [{ message, context }], pagination })');

  const bad = await search('&from=yesterday');
  check(bad.status === 400 && /from/.test(bad.data.error), 'an invalid from -> 400 with an error', bad);
  const badTo = await search('&to=2026-02-31');
  check(badTo.status === 400 && /to/.test(badTo.data.error), 'an impossible date -> 400', badTo);
  const backwards = await search('&from=2026-01-15&to=2026-01-05');
  check(backwards.status === 400 && /before/.test(backwards.data.error), 'from after to -> 400', backwards);
  const badSort = await search('&sort=sideways');
  check(badSort.status === 400 && /sort/.test(badSort.data.error), 'an unknown sort -> 400', badSort);
  check((await request('GET', `/api/chats/${groupId}/search?q=dragonfruit&from=2026-01-01`, e.token)).status === 403, 'outsiders still cannot search the chat');

  // ---------- senderGroupRole: "Owner" / "Admin" beside names ----------
  await request('POST', `/api/groups/${groupId}/members/${b.id}/role`, a.token, { role: 'admin' });
  const ownerSent = await request('POST', `/api/chats/${groupId}/messages`, a.token, { content: 'owner here' });
  check(ownerSent.data.message?.senderGroupRole === 'owner', 'a new message says its sender is the owner', ownerSent.data);
  const roleList = (await request('GET', `/api/chats/${groupId}/messages`, d.token)).data.messages || [];
  check(
    roleList.find((m) => m.sender?.id === b.id)?.senderGroupRole === 'admin' &&
      roleList.find((m) => m.sender?.id === c.id)?.senderGroupRole === null &&
      roleList.find((m) => m.sender?.id === a.id)?.senderGroupRole === 'owner',
    'the message list marks owner and admins, and members get null',
    roleList.map((m) => [m.sender?.id, m.senderGroupRole])
  );
  const single = await request('GET', `/api/chats/${groupId}/messages/${ownerSent.data.message?.id}`, d.token);
  check(single.data.message?.senderGroupRole === 'owner', 'a single message carries it too', single.data);
  const roleSearch = await request('GET', `/api/chats/${groupId}/search?q=owner`, d.token);
  check(roleSearch.data.results?.[0]?.message?.senderGroupRole === 'owner', 'search results carry it too', roleSearch.data);

  return { pass, fail };
}

module.exports = { run };
