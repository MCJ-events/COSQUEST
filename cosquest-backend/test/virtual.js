// Virtual quests: no venue, seen from anywhere, quests sell while live.
const User = require('../src/models/User');
const Quest = require('../src/models/Quest');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let ok = 0;
  let bad = 0;
  const check = (cond, name, value) => {
    if (cond) { ok += 1; console.log(`  ok  - ${name}`); }
    else { bad += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1200)); }
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
  const suffix = `${Date.now() % 1e7}${Math.floor(Math.random() * 100)}`;
  const admin = await User.create({ profile: { username: `VqAdmin${suffix}`, usernameNormalized: `vqadmin${suffix}`, firstName: 'Vq', avatarKey: 'green-knight' }, email: `vqadmin_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants', platformRole: 'admin', adminSince: new Date() });
  const member = await User.create({ profile: { username: `VqMember${suffix}`, usernameNormalized: `vqmember${suffix}`, firstName: 'Vm', avatarKey: 'green-knight', age: 30 }, email: `vqmember_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants' });
  const adminToken = (await request('POST', '/api/admin/auth/exchange', signToken(admin.id, admin.tokenVersion))).data.token;
  const memberToken = signToken(member.id, member.tokenVersion);
  const hour = 3600e3;
  const base = (title, startsIn) => ({ title, startsAt: new Date(Date.now() + startsIn * hour).toISOString(), endsAt: new Date(Date.now() + (startsIn + 3) * hour).toISOString(), entryFee: { amount: 5 }, prizePool: { amount: 50 }, maxParticipants: 20, publish: true });

  console.log('\n--- creating ---');
  const noLabel = await request('POST', '/api/admin/quests', adminToken, { ...base('No Label', 24), kind: 'quest', format: 'virtual' });
  check(noLabel.status === 400, 'a virtual quest needs a place label', noLabel.data);
  const created = await request('POST', '/api/admin/quests', adminToken, { ...base('Hanuma Run', 24), kind: 'quest', format: 'virtual', placeLabel: 'Tokyo · Hanuma', requireAtVenue: true });
  check(created.status === 201 && created.data.quest.format === 'virtual' && created.data.quest.location.name === 'Tokyo · Hanuma' && created.data.quest.location.lat === null && created.data.quest.requireAtVenue === false, 'a virtual quest without a venue (label shown as its place; never "be at the venue")', created.data);
  const inPerson = await request('POST', '/api/admin/quests', adminToken, { ...base('Plaza Night', 24), kind: 'event' });
  check(inPerson.status === 400, 'an in-person one still needs its venue', inPerson.data);

  console.log('\n--- seen from anywhere ---');
  const far = await request('GET', '/api/quests?lat=51.5&lng=-0.12&radiusMiles=30', memberToken);
  check((far.data.quests || []).some((q) => q.id === created.data.quest.id && q.distanceMiles === undefined), 'listed in London, with no distance', far.data);

  console.log('\n--- selling while live ---');
  const live = await request('POST', '/api/admin/quests', adminToken, { ...base('Live Online', 24), kind: 'quest', format: 'virtual', placeLabel: 'Lagos · Ikeja' });
  await Quest.updateOne({ _id: live.data.quest.id }, { $set: { startsAt: new Date(Date.now() - hour), endsAt: new Date(Date.now() + 2 * hour) } });
  const types = await request('GET', `/api/quests/${live.data.quest.id}/ticket-types`);
  check(types.data.ticketTypes?.[0]?.onSale === true, 'a live virtual quest is still on sale', types.data);
  const join = await request('POST', `/api/quests/${live.data.quest.id}/checkout`, memberToken, {});
  check(join.status === 201 && join.data.checkoutUrl, '...joined from anywhere, no location needed', join.data);
  const event = await request('POST', '/api/admin/quests', adminToken, { ...base('Online Show', 24), kind: 'event', format: 'virtual', placeLabel: 'Online' });
  await Quest.updateOne({ _id: event.data.quest.id }, { $set: { startsAt: new Date(Date.now() - hour), endsAt: new Date(Date.now() + 2 * hour) } });
  const closed = await request('POST', `/api/quests/${event.data.quest.id}/checkout`, memberToken, {});
  check(closed.status === 409 && closed.data.code === 'sales_closed', 'a virtual EVENT still closes at the start', closed.data);

  console.log(`\nvirtual quests: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
