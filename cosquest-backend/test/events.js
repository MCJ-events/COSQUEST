// Events: sales close at the start, the door closes at the end, attendance
// (no-shows), results (winners), "Tomorrow!" and "Sales close soon".
const Stripe = require('stripe');
const User = require('../src/models/User');
const Quest = require('../src/models/Quest');
const Order = require('../src/models/Order');
const Ticket = require('../src/models/Ticket');
const payments = require('../src/utils/stripe');
const events = require('../src/utils/events');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let ok = 0;
  let bad = 0;
  const check = (cond, name, value) => {
    if (cond) { ok += 1; console.log(`  ok  - ${name}`); }
    else { bad += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1500)); }
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
  const secret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test';
  const signer = new Stripe('sk_test_signer');
  let n = 0;
  async function webhook(type, object) {
    n += 1;
    const payload = JSON.stringify({ id: `evt_events_${Date.now()}_${n}`, type, data: { object } });
    const header = signer.webhooks.generateTestHeaderString({ payload, secret });
    return fetch(`${baseUrl}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload });
  }
  const fake = payments._fake();
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  async function makeUser(name, extra = {}) {
    const user = await User.create({
      profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, lastName: 'Test', avatarKey: 'green-knight', age: 30 },
      email: `${name.toLowerCase()}_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants', ...extra,
    });
    return { user, token: signToken(user.id, user.tokenVersion) };
  }
  const admin = await makeUser('EvAdmin', { platformRole: 'admin', adminSince: new Date() });
  const amy = await makeUser('EvAmy');
  const bob = await makeUser('EvBob');
  const cat = await makeUser('EvCat');
  const adminToken = (await request('POST', '/api/admin/auth/exchange', admin.token)).data.token;
  const venue = { name: 'Waterfront Plaza', address: '1 Harbor Dr', city: 'San Diego', country: 'United States', lat: 32.7157, lng: -117.1611 };
  const hour = 3600e3;
  async function makeQuest(title, startsInHours, lengthHours = 3) {
    return Quest.create({ slug: `${title.toLowerCase().replace(/\W+/g, '-')}-${suffix}-${Math.random().toString(36).slice(2, 6)}`, title, status: 'upcoming', isPublished: true, startsAt: new Date(Date.now() + startsInHours * hour), endsAt: new Date(Date.now() + (startsInHours + lengthHours) * hour), location: venue, prizePool: { amount: 100, currency: 'USD' }, entryFee: { amount: 10, currency: 'USD' }, maxParticipants: 10 });
  }
  async function buy(user, quest) {
    const started = await request('POST', `/api/quests/${quest.id}/checkout`, user.token, {});
    await webhook('checkout.session.completed', fake._pay((await Order.findById(started.data.order.id)).stripe.checkoutSessionId));
    return Ticket.findOne({ order: started.data.order.id });
  }
  const moveTo = (quest, startsInHours, lengthHours = 3) => Quest.updateOne({ _id: quest._id }, { $set: { startsAt: new Date(Date.now() + startsInHours * hour), endsAt: new Date(Date.now() + (startsInHours + lengthHours) * hour) } });

  console.log('\n--- sales close at the start ---');
  const later = await makeQuest('Later Show', 48);
  const types = await request('GET', `/api/quests/${later.id}/ticket-types`);
  check(types.data.ticketTypes[0].onSale && new Date(types.data.ticketTypes[0].salesClosesAt).getTime() === later.startsAt.getTime(), 'ticket types say when sales close (the start)', types.data);
  const started = await makeQuest('Already On', -1);
  const closed = await request('POST', `/api/quests/${started.id}/checkout`, amy.token, {});
  check(closed.status === 409 && closed.data.code === 'sales_closed', 'once it has started: no more tickets', closed.data);
  const startedTypes = await request('GET', `/api/quests/${started.id}/ticket-types`);
  check(startedTypes.data.ticketTypes[0].onSale === false, '...and its ticket types say not on sale', startedTypes.data);
  process.env.SALES_AFTER_START = '1';
  const openTypes = await request('GET', `/api/quests/${started.id}/ticket-types`);
  delete process.env.SALES_AFTER_START;
  check(openTypes.data.ticketTypes[0].onSale === true && openTypes.data.ticketTypes[0].salesClosesAt === null, 'with SALES_AFTER_START=1, its ticket types agree with checkout (on sale)', openTypes.data);

  console.log('\n--- the door, attendance ---');
  const show = await makeQuest('Door Show', 48);
  const amyTicket = await buy(amy, show);
  const bobTicket = await buy(bob, show);
  const amyCode = (await request('GET', `/api/me/tickets/${amyTicket.id}`, amy.token)).data.ticket.code;
  const bobCode = (await request('GET', `/api/me/tickets/${bobTicket.id}`, bob.token)).data.ticket.code;
  const during = await request('GET', `/api/admin/quests/${show.id}/attendance`, adminToken);
  check(during.data.ended === false && during.data.notYetIn.length === 2 && during.data.noShows.length === 0, 'before the end: "not here yet", not no-shows', during.data);
  const amyIn = await request('POST', '/api/admin/checkin', adminToken, { code: amyCode, questId: show.id });
  check(amyIn.status === 200, 'check-in during the event', amyIn.data);
  await moveTo(show, -5);
  const tooLate = await request('POST', '/api/admin/checkin', adminToken, { code: bobCode, questId: show.id });
  check(tooLate.status === 409 && tooLate.data.code === 'event_ended', 'after the end: the door is closed', tooLate.data);
  const after = await request('GET', `/api/admin/quests/${show.id}/attendance`, adminToken);
  check(after.data.ended && after.data.checkedIn === 1 && after.data.noShows.length === 1 && after.data.noShows[0].ticketId === bobTicket.id, 'after the end: 1 checked in, 1 no-show (admins only)', after.data);

  console.log('\n--- results ---');
  const early = await makeQuest('Not Over', 48);
  const notOver = await request('PUT', `/api/admin/quests/${early.id}/results`, adminToken, { winners: [] });
  check(notOver.status === 409 && notOver.data.code === 'not_ended', 'results only once it has ended', notOver.data);
  const noShowWins = await request('PUT', `/api/admin/quests/${show.id}/results`, adminToken, { winners: [{ ticketId: bobTicket.id, place: 1 }] });
  check(noShowWins.status === 400 && noShowWins.data.code === 'not_checked_in', 'only people who were checked in can win', noShowWins.data);
  const empty = await request('POST', `/api/admin/quests/${show.id}/results/publish`, adminToken);
  check(empty.status === 400 && empty.data.code === 'no_winners', 'publishing needs a winner', empty.data);
  const saved = await request('PUT', `/api/admin/quests/${show.id}/results`, adminToken, { winners: [{ ticketId: amyTicket.id, place: 1, prizeNote: '$50, paid at the venue' }] });
  check(saved.status === 200 && saved.data.winners[0].placeLabel === '1st' && !saved.data.publishedAt, 'a draft: Amy 1st', saved.data);
  const hidden = await request('GET', `/api/me/tickets/${amyTicket.id}`, amy.token);
  check(hidden.data.ticket.result === null, '...not shown to Amy before publishing', hidden.data.ticket);
  const published = await request('POST', `/api/admin/quests/${show.id}/results/publish`, adminToken);
  check(published.status === 200 && published.data.publishedAt && /^EV-/.test(published.data.auditEvent), 'published (audit logged)', published.data);
  const shown = await request('GET', `/api/me/tickets/${amyTicket.id}`, amy.token);
  check(shown.data.ticket.result?.placeLabel === '1st' && shown.data.ticket.result.prizeNote === '$50, paid at the venue', "Amy's ticket shows 1st place and the prize", shown.data.ticket);
  const again = await request('POST', `/api/admin/quests/${show.id}/results/publish`, adminToken);
  check(again.status === 409, 'published once', again.data);
  const edit = await request('PUT', `/api/admin/quests/${show.id}/results`, adminToken, { winners: [] });
  check(edit.status === 409 && edit.data.code === 'published', 'published results are locked', edit.data);

  console.log('\n--- reminders ---');
  const tomorrow = await makeQuest('Tomorrow Show', 48);
  await buy(cat, tomorrow);
  await moveTo(tomorrow, 24);
  check((await events.remindTomorrow()) >= 1, '"Tomorrow!" to ticket holders', null);
  check((await events.remindTomorrow()) === 0, '...once', null);
  const closing = await makeQuest('Closing Soon', 48);
  const abandoned = await request('POST', `/api/quests/${closing.id}/checkout`, bob.token, {});
  await Order.updateOne({ _id: abandoned.data.order.id }, { $set: { holdExpiresAt: new Date(Date.now() - 1000) } });
  await require('../src/utils/tickets').reconcileDue();
  await moveTo(closing, 1);
  check((await events.nudgeSalesClosing()) === 1, '"Sales close in about an hour" to someone who started buying', null);
  check((await events.nudgeSalesClosing()) === 0, '...once', null);

  console.log(`\nevents: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
