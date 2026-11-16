// Virtual quests: any ticket holder can win; no no-shows.
const Stripe = require('stripe');
const User = require('../src/models/User');
const Quest = require('../src/models/Quest');
const Order = require('../src/models/Order');
const Ticket = require('../src/models/Ticket');
const payments = require('../src/utils/stripe');
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
  const signer = new Stripe('sk_test_signer');
  const secret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test';
  const fake = payments._fake();
  const suffix = `${Date.now() % 1e7}${Math.floor(Math.random() * 100)}`;
  const admin = await User.create({ profile: { username: `VrAdmin${suffix}`, usernameNormalized: `vradmin${suffix}`, firstName: 'Vr', avatarKey: 'green-knight' }, email: `vradmin_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants', platformRole: 'admin', adminSince: new Date() });
  const player = await User.create({ profile: { username: `VrPlayer${suffix}`, usernameNormalized: `vrplayer${suffix}`, firstName: 'Vp', avatarKey: 'green-knight', age: 30 }, email: `vrplayer_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants' });
  const adminToken = (await request('POST', '/api/admin/auth/exchange', signToken(admin.id, admin.tokenVersion))).data.token;
  const hour = 3600e3;
  const quest = await Quest.create({ slug: `vr-${suffix}`, title: 'Online Run', status: 'upcoming', isPublished: true, kind: 'quest', format: 'virtual', placeLabel: 'Tokyo · Hanuma', startsAt: new Date(Date.now() + 48 * hour), endsAt: new Date(Date.now() + 51 * hour), prizePool: { amount: 50, currency: 'USD' }, entryFee: { amount: 5, currency: 'USD' }, maxParticipants: 10 });
  const started = await request('POST', `/api/quests/${quest.id}/checkout`, signToken(player.id, player.tokenVersion), {});
  const payload = JSON.stringify({ id: `evt_vr_${suffix}`, type: 'checkout.session.completed', data: { object: fake._pay((await Order.findById(started.data.order.id)).stripe.checkoutSessionId) } });
  await fetch(`${baseUrl}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': signer.webhooks.generateTestHeaderString({ payload, secret }) }, body: payload });
  const ticket = await Ticket.findOne({ order: started.data.order.id });
  await Quest.updateOne({ _id: quest._id }, { $set: { startsAt: new Date(Date.now() - 5 * hour), endsAt: new Date(Date.now() - hour) } });

  const att = await request('GET', `/api/admin/quests/${quest.id}/attendance`, adminToken);
  check(att.data.virtual === true && att.data.attendees.length === 1 && att.data.noShows.length === 0, 'virtual: ticket holders listed, no no-shows', att.data);
  const saved = await request('PUT', `/api/admin/quests/${quest.id}/results`, adminToken, { winners: [{ ticketId: String(ticket._id), place: 1 }] });
  check(saved.status === 200 && saved.data.winners[0].placeLabel === '1st', 'a ticket holder (never checked in) can win a virtual quest', saved.data);

  console.log(`\nvirtual results: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
