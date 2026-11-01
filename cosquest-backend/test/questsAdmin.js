// Quests & Events, Phase 1: status from the clock, isRegistered in lists,
// and the admin Quests & Events endpoints (create, edit, publish,
// duplicate, cancel, cover upload, address search).
const User = require('../src/models/User');
const Quest = require('../src/models/Quest');
const QuestRegistration = require('../src/models/QuestRegistration');
const Notification = require('../src/models/Notification');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;
  function check(ok, name, value) {
    if (ok) { pass += 1; console.log(`  ok  - ${name}`); }
    else { fail += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1500)); }
  }
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

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  async function makeUser(name, extra = {}) {
    const user = await User.create({
      profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, lastName: 'Test', avatarKey: 'green-knight' },
      email: `${name.toLowerCase()}_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants', ...extra,
    });
    return { user, token: signToken(user.id, user.tokenVersion) };
  }
  const admin = await makeUser('QAdmin', { platformRole: 'admin', adminSince: new Date() });
  const member = await makeUser('QMember');
  const adminToken = (await request('POST', '/api/admin/auth/exchange', admin.token)).data.token;
  const hour = 3600e3;
  const venue = { name: `Waterfront Plaza ${suffix}`, address: '1 Harbor Dr', city: 'San Diego', country: 'United States', lat: 32.7157, lng: -117.1611 };

  console.log('\n--- quests: create, publish, edit ---');
  // A real entry fee in the refusals below, so each is refused for its own reason.
  const bad = await request('POST', '/api/admin/quests', adminToken, { title: 'x', startsAt: new Date().toISOString(), endsAt: new Date().toISOString(), location: venue, entryFee: 10, prizePool: 0, maxParticipants: 10 });
  check(bad.status === 400 && /title/.test(bad.data.error), 'a short title is refused', bad.data);
  const backwards = await request('POST', '/api/admin/quests', adminToken, { title: 'Backwards', startsAt: new Date(Date.now() + 5 * hour).toISOString(), endsAt: new Date(Date.now() + hour).toISOString(), location: venue, entryFee: 10, prizePool: 0, maxParticipants: 10 });
  check(backwards.status === 400 && /end after it starts/.test(backwards.data.error), 'it must end after it starts', backwards.data);
  const freeQuest = await request('POST', '/api/admin/quests', adminToken, { title: 'Free for all', startsAt: new Date(Date.now() + hour).toISOString(), endsAt: new Date(Date.now() + 2 * hour).toISOString(), location: venue, entryFee: 0, prizePool: 0, maxParticipants: 10 });
  check(freeQuest.status === 400 && /at least \$0\.50/.test(freeQuest.data.error), 'every ticket is paid: an entry fee under $0.50 is refused', freeQuest.data);
  const draft = await request('POST', '/api/admin/quests', adminToken, {
    title: `Glow Hunt ${suffix}`, kind: 'event', description: 'Night quest', startsAt: new Date(Date.now() + 2 * hour).toISOString(), endsAt: new Date(Date.now() + 5 * hour).toISOString(),
    location: venue, entryFee: { amount: 10 }, prizePool: { amount: 500 }, maxParticipants: 2,
  });
  const questId = draft.data?.quest?.id;
  check(draft.status === 201 && draft.data.quest.status === 'draft' && draft.data.quest.entryFee.currency === 'USD' && draft.data.quest.kind === 'event', 'create a draft event (USD by default)', draft.data);
  const hidden = await request('GET', `/api/quests/${questId}`, member.token);
  check(hidden.status === 404, 'drafts are hidden from members', hidden.status);
  const published = await request('POST', `/api/admin/quests/${questId}/publish`, adminToken);
  check(published.status === 200 && published.data.quest.status === 'upcoming' && published.data.quest.isPublished, 'publish: upcoming', published.data);
  const seen = await request('GET', `/api/quests/${questId}`, member.token);
  check(seen.status === 200 && seen.data.quest.isRegistered === false && seen.data.quest.location.city === 'San Diego', 'members see it, with isRegistered', seen.data);
  // Paid events go through Stripe checkout (test/tickets.js); here the
  // registration is made directly, to test the admin side.
  await QuestRegistration.create({ quest: questId, user: member.user._id, paymentStatus: 'paid' });
  await Quest.updateOne({ _id: questId }, { $inc: { registrationCount: 1 } });
  const paidRoute = await request('POST', `/api/quests/${questId}/registrations`, member.token);
  check(paidRoute.status === 402 || paidRoute.status === 409, 'paid events are not registered through the old route', paidRoute.data);
  const list = await request('GET', '/api/quests?status=upcoming', member.token);
  check(list.data.quests?.some((q) => q.id === questId && q.isRegistered === true), 'the list says isRegistered', list.data);
  const tooFew = await request('PATCH', `/api/admin/quests/${questId}`, adminToken, { maxParticipants: 0 });
  check(tooFew.status === 400, 'places cannot go below the registrations', tooFew.data);
  const moved = await request('PATCH', `/api/admin/quests/${questId}`, adminToken, { startsAt: new Date(Date.now() + 3 * hour).toISOString() });
  const changedNotice = await Notification.findOne({ user: member.user._id, message: { $regex: 'changed' } });
  check(moved.status === 200 && changedNotice, 'changing the time tells registrants', { moved: moved.data, changedNotice });
  const unpublish = await request('POST', `/api/admin/quests/${questId}/unpublish`, adminToken);
  check(unpublish.status === 409, "can't unpublish with registrations (cancel instead)", unpublish.data);

  console.log('\n--- the clock decides live and completed ---');
  const live = await Quest.create({ slug: `live-${suffix}`, title: `Live now ${suffix}`, status: 'upcoming', startsAt: new Date(Date.now() - hour), endsAt: new Date(Date.now() + hour), location: venue, prizePool: { amount: 0 }, entryFee: { amount: 0 }, maxParticipants: 50, isPublished: true });
  const ended = await Quest.create({ slug: `ended-${suffix}`, title: `Ended ${suffix}`, status: 'live', startsAt: new Date(Date.now() - 5 * hour), endsAt: new Date(Date.now() - hour), location: venue, prizePool: { amount: 0 }, entryFee: { amount: 0 }, maxParticipants: 50, isPublished: true });
  const liveRow = (await request('GET', `/api/quests/${live.id}`, member.token)).data.quest;
  const endedRow = (await request('GET', `/api/quests/${ended.id}`, member.token)).data.quest;
  check(liveRow.status === 'live' && endedRow.status === 'completed', 'stored "upcoming" in progress -> live; stored "live" ended -> completed', { liveRow: liveRow.status, endedRow: endedRow.status });
  const lateJoin = await request('POST', `/api/quests/${ended.id}/registrations`, member.token);
  check(lateJoin.status === 409, 'no registering once it has ended', lateJoin.status);
  const liveList = await request('GET', '/api/quests?status=live', member.token);
  check(liveList.data.quests?.some((q) => q.id === live.id) && !liveList.data.quests.some((q) => q.id === ended.id), 'status=live uses the clock', liveList.data);

  console.log('\n--- duplicate, cancel, admin lists ---');
  const copy = await request('POST', `/api/admin/quests/${questId}/duplicate`, adminToken);
  check(copy.status === 201 && copy.data.quest.status === 'draft' && copy.data.quest.registrationCount === 0, 'duplicate: a fresh draft', copy.data);
  const noReason = await request('POST', `/api/admin/quests/${questId}/cancel`, adminToken, { reason: '' });
  check(noReason.status === 400, 'cancelling needs a reason', noReason.data);
  const cancelled = await request('POST', `/api/admin/quests/${questId}/cancel`, adminToken, { reason: 'Venue flooded' });
  const reg = await QuestRegistration.findOne({ quest: questId, user: member.user._id });
  const cancelNotice = await Notification.findOne({ user: member.user._id, message: { $regex: 'cancelled' } });
  check(cancelled.status === 200 && cancelled.data.registrantsNotified === 1 && reg.status === 'cancelled' && cancelNotice, 'cancel: registrants told, registrations cancelled', { cancelled: cancelled.data, reg: reg?.status });
  const editCancelled = await request('PATCH', `/api/admin/quests/${questId}`, adminToken, { title: 'Again' });
  check(editCancelled.status === 409, 'a cancelled quest cannot be edited', editCancelled.data);
  const memberList = await request('GET', '/api/quests', member.token);
  check(!(memberList.data.quests || []).some((q) => q.id === questId), 'cancelled quests leave the member list', memberList.data);
  const tabs = await request('GET', '/api/admin/quests?tab=cancelled', adminToken);
  const statsRes = await request('GET', '/api/admin/quests/stats', adminToken);
  check(tabs.data.quests?.some((q) => q.id === questId) && statsRes.data.cancelled >= 1 && statsRes.data.live >= 1, 'admin tabs and stats', { tabs: tabs.data.total, stats: statsRes.data });
  const detail = await request('GET', `/api/admin/quests/${questId}`, adminToken);
  check(detail.status === 200 && detail.data.registrations.length === 1 && detail.data.history.some((e) => e.action === 'quest.cancel'), 'details: registrations and history', detail.data);
  const geo = await request('GET', '/api/admin/geocode?q=Waterfront%20Park', adminToken);
  check(geo.status === 200 && geo.data.places?.[0]?.lat, 'address search (test geocoder)', geo.data);
  const geoUrl = process.env.GEOCODER_URL;
  process.env.GEOCODER_URL = 'http://127.0.0.1:1';
  const geoDown = await request('GET', '/api/admin/geocode?q=Waterfront%20Park', adminToken);
  if (geoUrl === undefined) delete process.env.GEOCODER_URL; else process.env.GEOCODER_URL = geoUrl;
  check(geoDown.status === 503 && /coordinates by hand/.test(geoDown.data.error), 'address search down: 503, enter coordinates by hand', geoDown);
  const again = await request('POST', `/api/admin/quests/${questId}/cancel`, adminToken, { reason: 'Twice' });
  check(again.status === 409, 'cancelling twice is refused', again.data);
  const bogus = await request('GET', '/api/quests?status=bogus', member.token);
  check(bogus.status === 200 && !(bogus.data.quests || []).some((q) => q.id === questId), 'an unknown ?status= still hides cancelled quests', bogus.data);

  console.log('\n--- currency kept on edit, faction counts by the clock ---');
  const naira = await Quest.create({ slug: `naira-${suffix}`, title: `Old Lagos quest ${suffix}`, status: 'upcoming', startsAt: new Date(Date.now() + 2 * hour), endsAt: new Date(Date.now() + 3 * hour), location: venue, prizePool: { amount: 0, currency: 'NGN' }, entryFee: { amount: 500, currency: 'NGN' }, maxParticipants: 10, isPublished: true });
  const repriced = await request('PATCH', `/api/admin/quests/${naira.id}`, adminToken, { entryFee: { amount: 700 } });
  check(repriced.status === 200 && repriced.data.quest.entryFee.amount === 700 && repriced.data.quest.entryFee.currency === 'NGN', 'changing only the amount keeps the currency', repriced.data);
  const badCurrency = await request('PATCH', `/api/admin/quests/${naira.id}`, adminToken, { entryFee: { amount: 1, currency: '$$' } });
  check(badCurrency.status === 400, 'a currency must be a 3-letter code', badCurrency.data);
  const activeCount = async () => (await request('GET', '/api/factions')).data.factions.find((f) => f.key === 'ascendants').activeQuestCount;
  const beforeCount = await activeCount();
  await Quest.create({ slug: `faction-ended-${suffix}`, title: `Faction ended ${suffix}`, status: 'upcoming', faction: 'ascendants', startsAt: new Date(Date.now() - 5 * hour), endsAt: new Date(Date.now() - hour), location: venue, prizePool: { amount: 0 }, entryFee: { amount: 0 }, maxParticipants: 5, isPublished: true });
  const afterEnded = await activeCount();
  await Quest.create({ slug: `faction-soon-${suffix}`, title: `Faction soon ${suffix}`, status: 'upcoming', faction: 'ascendants', startsAt: new Date(Date.now() + hour), endsAt: new Date(Date.now() + 2 * hour), location: venue, prizePool: { amount: 0 }, entryFee: { amount: 0 }, maxParticipants: 5, isPublished: true });
  const afterSoon = await activeCount();
  check(afterEnded === beforeCount && afterSoon === beforeCount + 1, "a faction's active quests leave out ended ones", { beforeCount, afterEnded, afterSoon });

  console.log('\n--- nearest quests ---');
  const plain = { status: 'upcoming', isPublished: true, prizePool: { amount: 0 }, entryFee: { amount: 5 }, maxParticipants: 5 };
  await Quest.insertMany(Array.from({ length: 25 }, (_, i) => ({ ...plain, slug: `far-${i}-${suffix}`, title: `Far ${i} ${suffix}`, startsAt: new Date(Date.now() + 30 * 60 * 1000 + i * 1000), endsAt: new Date(Date.now() + 3 * hour), location: { name: 'Shibuya', lat: 35.6595, lng: 139.7005 } })));
  const corner = await Quest.create({ ...plain, slug: `corner-${suffix}`, title: `Around the corner ${suffix}`, startsAt: new Date(Date.now() + 20 * hour), endsAt: new Date(Date.now() + 22 * hour), location: venue });
  const nearMe = await request('GET', '/api/quests?lat=32.7157&lng=-117.1611&radiusMiles=30', member.token);
  check(nearMe.status === 200 && nearMe.data.quests.some((q) => q.id === corner.id) && !nearMe.data.quests.some((q) => q.title.startsWith('Far ')), 'a nearby quest is not cut off by 20+ sooner ones elsewhere', nearMe.data.quests?.map((q) => q.title));
  const dateline = await Quest.create({ ...plain, slug: `dateline-${suffix}`, title: `Dateline ${suffix}`, startsAt: new Date(Date.now() + hour), endsAt: new Date(Date.now() + 2 * hour), location: { name: 'Taveuni', lat: -16.8, lng: 179.95 } });
  const across = await request('GET', '/api/quests?lat=-16.8&lng=-179.95&radiusMiles=30', member.token);
  check(across.data.quests?.some((q) => q.id === dateline.id), 'nearby across the 180° line is still found', across.data);

  const memberAdmin = await request('GET', '/api/admin/quests', member.token);
  check(memberAdmin.status === 401, 'members cannot use the admin quest routes', memberAdmin.status);

  console.log('\n--- home dashboard ---');
  const home = await request('GET', '/api/home/dashboard', member.token);
  check(home.status === 200 && typeof home.data.user.points === 'number', 'the dashboard sends points', home.data?.user);

  console.log(`\nquests admin: ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
