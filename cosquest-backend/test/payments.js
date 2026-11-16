// Paying on the CosQuest website (payment brief, decision 2): the 20-minute
// link, the checkout pass, eligibility (18+), Stripe returning to the
// website, the old app path still working, the payment sheet off.
// Stripe is the in-memory fake; webhooks are signed with the real library.
const Stripe = require('stripe');
const User = require('../src/models/User');
const Quest = require('../src/models/Quest');
const Order = require('../src/models/Order');
const Ticket = require('../src/models/Ticket');
const TicketType = require('../src/models/TicketType');
const payments = require('../src/utils/stripe');
const pass = require('../src/utils/checkoutPass');
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
    const payload = JSON.stringify({ id: `evt_pay_${Date.now()}_${n}`, type, data: { object } });
    const header = signer.webhooks.generateTestHeaderString({ payload, secret });
    const response = await fetch(`${baseUrl}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload });
    return { status: response.status };
  }
  const fake = payments._fake();
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  async function makeUser(name, age) {
    const user = await User.create({
      profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, lastName: 'Test', avatarKey: 'green-knight', age },
      email: `${name.toLowerCase()}_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants',
    });
    return { user, token: signToken(user.id, user.tokenVersion) };
  }
  const ana = await makeUser('PayAna', 30);
  const ben = await makeUser('PayBen', 25);
  const teen = await makeUser('PayTeen', 16);
  const nobody = await makeUser('PayNoAge', null);
  const venue = { name: 'Waterfront Plaza', address: '1 Harbor Dr', city: 'San Diego', country: 'United States', lat: 32.7157, lng: -117.1611 };
  const quest = await Quest.create({ slug: `web-pay-${suffix}`, title: 'Web Pay Night', status: 'upcoming', isPublished: true, startsAt: new Date(Date.now() + 48 * 3600e3), endsAt: new Date(Date.now() + 51 * 3600e3), location: venue, prizePool: { amount: 300, currency: 'USD' }, entryFee: { amount: 15, currency: 'USD' }, maxParticipants: 10 });
  const link = (url) => new URL(url).searchParams.get('h');

  console.log('\n--- the link (app) ---');
  const handoff = await request('POST', '/api/payments/handoff', ana.token, { questId: quest.id });
  check(handoff.status === 201 && /\/checkout\?h=/.test(handoff.data.url) && Math.round((new Date(handoff.data.expiresAt) - Date.now()) / 60000) === 20, 'the app gets a 20-minute link to the website', handoff.data);
  const young = await request('POST', '/api/payments/handoff', teen.token, { questId: quest.id });
  check(young.status === 403 && young.data.code === 'too_young', 'under 18: no link (blocked before any payment screen)', young.data);
  const unknown = await request('POST', '/api/payments/handoff', nobody.token, { questId: quest.id });
  check(unknown.status === 403 && unknown.data.code === 'age_unknown', 'no age saved: no link (blocked when unsure)', unknown.data);
  const elig = await request('GET', `/api/payments/eligibility?questId=${quest.id}`, ana.token);
  check(elig.status === 200 && elig.data.allowed === true && elig.data.mode === 'test', 'eligibility: allowed (test mode)', elig.data);

  console.log('\n--- the website swaps the link (once) ---');
  const h = link(handoff.data.url);
  const redeemed = await request('POST', '/api/payments/handoff/redeem', null, { h });
  check(redeemed.status === 200 && redeemed.data.checkoutToken && redeemed.data.quest?.id === quest.id && redeemed.data.ticketTypes?.length === 1 && redeemed.data.eligibility?.allowed, 'the website gets a checkout pass and what is being bought', redeemed.data);
  const twice = await request('POST', '/api/payments/handoff/redeem', null, { h });
  check(twice.status === 409 && twice.data.code === 'link_used', 'the same link a second time: refused', twice.data);
  const expired = pass.signPass(ana.user, { questId: quest._id, kind: 'link', exp: Math.floor(Date.now() / 1000) - 5 });
  const late = await request('POST', '/api/payments/handoff/redeem', null, { h: expired.token });
  check(late.status === 401 && late.data.code === 'link_expired', 'an expired link: refused', late.data);
  const cp = redeemed.data.checkoutToken;

  console.log('\n--- the pass can never open the app ---');
  const asApp = await request('GET', '/api/users/me', cp);
  check(asApp.status === 401, 'the checkout pass is refused by the app (requireAuth)', asApp.status);
  const linkAsApp = await request('GET', '/api/users/me', h);
  check(linkAsApp.status === 401, 'so is the link', linkAsApp.status);
  const loginAsPass = await request('POST', '/api/payments/checkout', ana.token, {});
  check(loginAsPass.status === 401 && loginAsPass.data.code === 'checkout_expired', 'a login token is refused as a checkout pass', loginAsPass.data);

  console.log('\n--- paying on the website ---');
  const started = await request('POST', '/api/payments/checkout', cp, {});
  const webOrder = started.data.order && (await Order.findById(started.data.order.id));
  check(started.status === 201 && /checkout\.stripe/.test(started.data.checkoutUrl) && webOrder?.returnTo === 'web', "Stripe's page, returning to the website", started.data);
  const again = await request('POST', '/api/payments/checkout', cp, {});
  check(again.status === 200 && again.data.reused && again.data.order.id === started.data.order.id, 'a retry reuses the same order (no double charge)', again.data);
  const benPass = pass.signPass(ben.user, { questId: quest._id, kind: 'session' }).token;
  const peek = await request('GET', `/api/payments/orders/${started.data.order.id}`, benPass);
  check(peek.status === 404, "nobody else's order", peek.status);
  const pending = await request('GET', `/api/payments/orders/${started.data.order.id}`, cp);
  check(pending.status === 200 && pending.data.order.status === 'pending', 'the return page: not paid yet', pending.data);
  await webhook('checkout.session.completed', fake._pay(webOrder.stripe.checkoutSessionId));
  const done = await request('GET', `/api/payments/orders/${started.data.order.id}`, cp);
  check(done.data.order.status === 'paid' && done.data.order.ticket?.status === 'valid' && (await Ticket.countDocuments({ order: webOrder._id })) === 1, "Stripe's webhook: paid, ticket issued (the return page sees it)", done.data);

  console.log('\n--- logging out cancels the pass ---');
  const benLink = link((await request('POST', '/api/payments/handoff', ben.token, { questId: quest.id })).data.url);
  const benCp = (await request('POST', '/api/payments/handoff/redeem', null, { h: benLink })).data.checkoutToken;
  await User.updateOne({ _id: ben.user._id }, { $inc: { tokenVersion: 1 } });
  const out = await request('POST', '/api/payments/checkout', benCp, {});
  check(out.status === 401 && out.data.code === 'signed_out', 'after logging out, the checkout pass stops working', out.data);

  console.log('\n--- the old app path and the payment sheet ---');
  const other = await Quest.create({ slug: `web-pay-old-${suffix}`, title: 'Old App Path', status: 'upcoming', isPublished: true, startsAt: new Date(Date.now() + 48 * 3600e3), endsAt: new Date(Date.now() + 51 * 3600e3), location: venue, prizePool: { amount: 100, currency: 'USD' }, entryFee: { amount: 10, currency: 'USD' }, maxParticipants: 5 });
  const oldApp = await request('POST', `/api/quests/${other.id}/checkout`, ana.token, {});
  check(oldApp.status === 201 && (await Order.findById(oldApp.data.order.id)).returnTo === 'app', 'older app versions still pay the old way (returning to the app)', oldApp.data);
  const savedSheet = process.env.PAYMENT_SHEET;
  delete process.env.PAYMENT_SHEET;
  const sheet = await request('POST', `/api/quests/${other.id}/payment-sheet`, ana.token, {}); // (Ben is logged out above)
  check(sheet.status === 410 && sheet.data.code === 'pay_on_website', 'the in-app payment sheet is off (pay on the website)', sheet.data);
  if (savedSheet !== undefined) process.env.PAYMENT_SHEET = savedSheet;

  console.log('\n--- no way of paying skips the age rule ---');
  const teenOld = await request('POST', `/api/quests/${other.id}/checkout`, teen.token, {});
  const noAgeOld = await request('POST', `/api/quests/${other.id}/checkout`, nobody.token, {});
  check(teenOld.status === 403 && teenOld.data.code === 'too_young' && noAgeOld.status === 403 && noAgeOld.data.code === 'age_unknown',
    'the old app checkout checks it too (an older app, or anyone calling it directly)', { teenOld: teenOld.data, noAgeOld: noAgeOld.data });
  process.env.PAYMENT_SHEET = '1';
  const teenSheet = await request('POST', `/api/quests/${other.id}/payment-sheet`, teen.token, {});
  if (savedSheet === undefined) delete process.env.PAYMENT_SHEET;
  else process.env.PAYMENT_SHEET = savedSheet;
  check(teenSheet.status === 403 && teenSheet.data.code === 'too_young', 'so does the payment sheet, when it is switched on', teenSheet.data);
  const teenPass = pass.signPass(teen.user, { questId: quest._id, kind: 'session' }).token;
  const teenWeb = await request('POST', '/api/payments/checkout', teenPass, {});
  check(teenWeb.status === 403 && teenWeb.data.code === 'too_young' && !(await Order.exists({ user: teen.user._id })),
    'and the website checkout, even with a pass (no order, no seat held)', teenWeb.data);
  const freeEntry = await Quest.create({ slug: `web-pay-vip-${suffix}`, title: 'Free Entry, Paid VIP', status: 'upcoming', isPublished: true, startsAt: new Date(Date.now() + 48 * 3600e3), endsAt: new Date(Date.now() + 51 * 3600e3), location: venue, prizePool: { amount: 0, currency: 'USD' }, entryFee: { amount: 0, currency: 'USD' }, maxParticipants: 5 });
  await TicketType.create({ quest: freeEntry._id, name: 'VIP', price: { amount: 25, currency: 'USD' }, quantity: 5 });
  const vip = await request('POST', '/api/payments/handoff', teen.token, { questId: freeEntry.id });
  check(vip.status === 403 && vip.data.code === 'too_young', 'a free-entry quest with a paid ticket type counts as paid', vip.data);

  console.log(`\nwebsite checkout: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
