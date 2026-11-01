// GET /api/quests/:questId/joins: the latest joiners, members only, public bits only.
const User = require('../src/models/User');
const Quest = require('../src/models/Quest');
const QuestRegistration = require('../src/models/QuestRegistration');
const Block = require('../src/models/Block');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;
  function check(ok, name, value) {
    if (ok) { pass += 1; console.log(`  ok  - ${name}`); }
    else { fail += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 800)); }
  }
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const users = [];
  for (const name of ['Bigtooth', 'Wagm', 'Bolt', 'Foxy', 'Late']) {
    users.push(await User.create({ profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, lastName: 'T', avatarKey: 'green-knight' }, email: `${name.toLowerCase()}_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants' }));
  }
  const quest = await Quest.create({ slug: `joins-${suffix}`, title: 'Joins', status: 'upcoming', isPublished: true, startsAt: new Date(Date.now() + 3600e3), endsAt: new Date(Date.now() + 7200e3), location: { name: 'P', lat: 1, lng: 1 }, prizePool: { amount: 0 }, entryFee: { amount: 0 }, maxParticipants: 10, registrationCount: 5 });
  for (let i = 0; i < users.length; i += 1) {
    await QuestRegistration.create({ quest: quest._id, user: users[i]._id, createdAt: new Date(Date.now() - (10 - i) * 1000) });
  }
  const token = signToken(users[0].id, users[0].tokenVersion);
  const res = await fetch(`${baseUrl}/api/quests/${quest.id}/joins`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  check(res.status === 200 && data.joins.length === 4 && data.joins[0].username === `Late${suffix}` && data.total === 5, 'the 4 newest joiners, newest first', data);
  check(data.joins.every((j) => !('email' in j)), 'no emails', data.joins);
  const anon = await fetch(`${baseUrl}/api/quests/${quest.id}/joins`);
  check(anon.status === 401, 'members only', anon.status);

  // Same privacy as the profile page's quest history.
  const [bigtooth, , , foxy, late] = users;
  const joinsFor = async (user) => (await (await fetch(`${baseUrl}/api/quests/${quest.id}/joins`, { headers: { Authorization: `Bearer ${signToken(user.id, user.tokenVersion)}` } })).json()).joins.map((j) => j.username);
  await Block.create({ blocker: late._id, blocked: bigtooth._id });
  await User.updateOne({ _id: foxy._id }, { $set: { 'privacy.profileVisibility': 'private' } });
  const seenByBigtooth = await joinsFor(bigtooth);
  check(!seenByBigtooth.includes(`Late${suffix}`) && !seenByBigtooth.includes(`Foxy${suffix}`) && seenByBigtooth.includes(`Bigtooth${suffix}`), 'blocked people and private profiles are left out', seenByBigtooth);
  const seenByLate = await joinsFor(late);
  check(seenByLate[0] === `Late${suffix}` && !seenByLate.includes(`Bigtooth${suffix}`) && !seenByLate.includes(`Foxy${suffix}`), 'blocking works both ways; you always see yourself', seenByLate);
  const badId = await fetch(`${baseUrl}/api/quests/not-an-id/joins`, { headers: { Authorization: `Bearer ${token}` } });
  check(badId.status === 404, 'a malformed quest ID is "not found"', badId.status);
  console.log(`\nquest joins: ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
