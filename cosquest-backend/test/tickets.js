// Tickets & Stripe: the safe paths when things go wrong. Stripe is the
// in-memory fake (src/utils/stripe.js), but webhooks are signed with the
// REAL library and checked for real.
const Stripe = require('stripe');
const User = require('../src/models/User');
const Quest = require('../src/models/Quest');
const Order = require('../src/models/Order');
const Ticket = require('../src/models/Ticket');
const TicketType = require('../src/models/TicketType');
const QuestRegistration = require('../src/models/QuestRegistration');
const StripeEvent = require('../src/models/StripeEvent');
const payments = require('../src/utils/stripe');
const tickets = require('../src/utils/tickets');
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
  const secret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test';
  const signer = new Stripe('sk_test_signer');
  let eventNo = 0;
  async function webhook(type, object, { badSecret = false } = {}) {
    eventNo += 1;
    const payload = JSON.stringify({ id: `evt_test_${Date.now()}_${eventNo}`, type, data: { object } });
    const header = signer.webhooks.generateTestHeaderString({ payload, secret: badSecret ? 'whsec_wrong' : secret });
    const response = await fetch(`${baseUrl}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload });
    return { status: response.status, data: await response.json().catch(() => null), payload };
  }
  async function replay(payload) {
    const header = signer.webhooks.generateTestHeaderString({ payload, secret });
    const response = await fetch(`${baseUrl}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload });
    return { status: response.status, data: await response.json().catch(() => null) };
  }
  const fake = payments._fake();

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  async function makeUser(name, extra = {}) {
    const user = await User.create({
      // Adults: paid tickets are 18+ (src/utils/eligibility.js; test/payments.js checks the rule).
      profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, lastName: 'Test', avatarKey: 'green-knight', age: 30 },
      email: `${name.toLowerCase()}_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants', ...extra,
    });
    return { user, token: signToken(user.id, user.tokenVersion) };
  }
  const admin = await makeUser('PayAdmin', { platformRole: 'admin', adminSince: new Date() });
  const ana = await makeUser('Ana');
  const ben = await makeUser('Ben');
  const adminToken = (await request('POST', '/api/admin/auth/exchange', admin.token)).data.token;
  const venue = { name: 'Waterfront Plaza', address: '1 Harbor Dr', city: 'San Diego', country: 'United States', lat: 32.7157, lng: -117.1611 };
  const hour = 3600e3;
  async function makeQuest(title, fee, places, startsInHours = 48) {
    return Quest.create({ slug: `${title.toLowerCase().replace(/\W+/g, '-')}-${suffix}-${Math.random().toString(36).slice(2, 6)}`, title, status: 'upcoming', isPublished: true, startsAt: new Date(Date.now() + startsInHours * hour), endsAt: new Date(Date.now() + (startsInHours + 3) * hour), location: venue, prizePool: { amount: 500, currency: 'USD' }, entryFee: { amount: fee, currency: 'USD' }, maxParticipants: places });
  }
  const sessionOf = async (orderId) => fake._sessions.get((await Order.findById(orderId)).stripe.checkoutSessionId);

  console.log('\n--- checkout, retries, last seat ---');
  const gala = await makeQuest('Glow Gala', 10, 1);
  const types = await request('GET', `/api/quests/${gala.id}/ticket-types`);
  check(types.status === 200 && types.data.ticketTypes.length === 1 && types.data.ticketTypes[0].price.amount === 10 && types.data.ticketTypes[0].remaining === 1, 'a default ticket type from the entry fee', types.data);
  const first = await request('POST', `/api/quests/${gala.id}/checkout`, ana.token, {});
  check(first.status === 201 && /checkout\.stripe/.test(first.data.checkoutUrl) && first.data.order.status === 'pending', 'paid checkout: a Stripe page, order pending', first.data);
  const again = await request('POST', `/api/quests/${gala.id}/checkout`, ana.token, {});
  check(again.status === 200 && again.data.reused && again.data.order.id === first.data.order.id && fake._sessions.size >= 1, 'a retry (network drop, double tap) reuses the same order and page', again.data);
  const benTry = await request('POST', `/api/quests/${gala.id}/checkout`, ben.token, {});
  check(benTry.status === 409 && benTry.data.code === 'sold_out', 'the held last seat is not sold twice', benTry.data);
  const oldRoute = await request('POST', `/api/quests/${gala.id}/registrations`, ben.token);
  check(oldRoute.status === 402 && oldRoute.data.code === 'checkout_required', 'the old register route asks for checkout on paid quests', oldRoute.data);

  console.log('\n--- the webhook ---');
  const session = fake._pay(first.data.order.id && (await Order.findById(first.data.order.id)).stripe.checkoutSessionId);
  const unsigned = await webhook('checkout.session.completed', session, { badSecret: true });
  check(unsigned.status === 400, 'a wrongly signed webhook is refused', unsigned);
  check((await Order.findById(first.data.order.id)).status === 'pending', '...and changes nothing', null);
  const paid = await webhook('checkout.session.completed', session);
  const anaOrder = await Order.findById(first.data.order.id);
  const anaTicket = await Ticket.findOne({ order: anaOrder._id });
  const reg = await QuestRegistration.findOne({ quest: gala._id, user: ana.user._id });
  const tt = await TicketType.findOne({ quest: gala._id });
  check(paid.status === 200 && anaOrder.status === 'paid' && anaTicket?.status === 'valid' && reg?.paymentStatus === 'paid' && tt.sold === 1 && tt.held === 0, 'signed webhook: paid, ticket issued, registered, seat sold', { order: anaOrder.status, ticket: anaTicket?.status, tt });
  const dup = await replay(paid.payload);
  check(dup.data?.duplicate === true && (await Ticket.countDocuments({ order: anaOrder._id })) === 1, 'the same event twice is handled once', dup.data);
  const order = await request('GET', `/api/orders/${anaOrder.id}`, ana.token);
  check(order.data.order.status === 'paid' && order.data.order.ticket?.status === 'valid', 'the return page sees it paid', order.data);
  const other = await request('GET', `/api/orders/${anaOrder.id}`, ben.token);
  check(other.status === 404, "nobody else can see someone's order", other.status);
  const repeatBuy = await request('POST', `/api/quests/${gala.id}/checkout`, ana.token, {});
  check(repeatBuy.status === 409 && repeatBuy.data.code === 'has_ticket', 'one ticket per person', repeatBuy.data);

  console.log('\n--- my tickets, check-in ---');
  const mine = await request('GET', '/api/me/tickets', ana.token);
  check(mine.data.tickets?.length >= 1 && mine.data.tickets[0].canGiveBack === true, 'My tickets (can give back: starts in 48 h)', mine.data);
  const one = await request('GET', `/api/me/tickets/${anaTicket.id}`, ana.token);
  check(/^CQT-/.test(one.data.ticket?.code || ''), 'the QR code value', one.data);
  const benSees = await request('GET', `/api/me/tickets/${anaTicket.id}`, ben.token);
  check(benSees.status === 404, "nobody else's ticket", benSees.status);
  const fakeCode = await request('POST', '/api/admin/checkin', adminToken, { code: 'CQT-notarealticketcode123' });
  check(fakeCode.status === 404, 'an unknown code is refused', fakeCode.data);
  const inside = await request('POST', '/api/admin/checkin', adminToken, { code: one.data.ticket.code, questId: gala.id });
  check(inside.status === 200 && inside.data.checkedIn, 'check-in', inside.data);
  const twice = await request('POST', '/api/admin/checkin', adminToken, { code: one.data.ticket.code });
  check(twice.status === 409 && twice.data.code === 'already_checked_in', 'a copied code only gets in once', twice.data);
  const memberCheckin = await request('POST', '/api/admin/checkin', ana.token, { code: one.data.ticket.code });
  check(memberCheckin.status === 401, 'only admins check people in', memberCheckin.status);

  console.log('\n--- paying inside the app (payment sheet) ---');
  const savedSheet = process.env.PAYMENT_SHEET;
  process.env.PAYMENT_SHEET = '1'; // off for members (payment brief); still tested here
  const sheetQuest = await makeQuest('Sheet Show', 15, 3);
  const sheet = await request('POST', `/api/quests/${sheetQuest.id}/payment-sheet`, ana.token, {});
  check(sheet.status === 201 && /_secret_/.test(sheet.data.paymentIntentClientSecret || '') && sheet.data.order.status === 'pending', 'the app gets a payment sheet (client secret), order pending', sheet.data);
  const sheetAgain = await request('POST', `/api/quests/${sheetQuest.id}/payment-sheet`, ana.token, {});
  check(sheetAgain.status === 200 && sheetAgain.data.reused && sheetAgain.data.order.id === sheet.data.order.id && sheetAgain.data.paymentIntentClientSecret === sheet.data.paymentIntentClientSecret, 'a retry reuses the same payment (no double charge)', sheetAgain.data);
  const sheetOrder = await Order.findById(sheet.data.order.id);
  const paidIntent = fake._payIntent(sheetOrder.stripe.paymentIntentId);
  const piWebhook = await webhook('payment_intent.succeeded', paidIntent);
  const sheetPaid = await Order.findById(sheet.data.order.id);
  check(piWebhook.status === 200 && sheetPaid.status === 'paid' && (await Ticket.findOne({ order: sheetPaid._id }))?.status === 'valid', 'payment_intent.succeeded: paid, ticket issued', sheetPaid?.status);
  const sheetBen = await request('POST', `/api/quests/${sheetQuest.id}/payment-sheet`, ben.token, {});
  fake._payIntent((await Order.findById(sheetBen.data.order.id)).stripe.paymentIntentId);
  const sheetSynced = await request('GET', `/api/orders/${sheetBen.data.order.id}`, ben.token);
  check(sheetSynced.data.order.status === 'paid', 'webhook late: the app asks, the server checks Stripe and finishes it', sheetSynced.data);
  const sheetQuest2 = await makeQuest('Sheet Expire', 15, 1);
  const abandoned = await request('POST', `/api/quests/${sheetQuest2.id}/payment-sheet`, ana.token, {});
  await Order.updateOne({ _id: abandoned.data.order.id }, { $set: { holdExpiresAt: new Date(Date.now() - 1000) } });
  await tickets.reconcileDue();
  const abandonedOrder = await Order.findById(abandoned.data.order.id);
  check(abandonedOrder.status === 'expired' && fake._intents.get(abandonedOrder.stripe.paymentIntentId).status === 'canceled' && (await TicketType.findOne({ quest: sheetQuest2._id })).held === 0, 'an abandoned payment is cancelled and the seat released', abandonedOrder.status);
  const sheetRefund = await request('POST', `/api/admin/orders/${sheet.data.order.id}/refund`, adminToken, { reason: 'Test refund' });
  check(sheetRefund.status === 200 && sheetRefund.data.order.status === 'refunded', 'in-app payments refund like the others', sheetRefund.data);

  const gus = await makeUser('Gus');
  const hal = await makeUser('Hal');
  const offlineQuest = await makeQuest('Sheet Offline', 15, 1);
  const offline = await request('POST', `/api/quests/${offlineQuest.id}/payment-sheet`, gus.token, {});
  await Order.updateOne({ _id: offline.data.order.id }, { $set: { holdExpiresAt: new Date(Date.now() - 1000) } });
  const realCancel = fake.paymentIntents.cancel;
  fake.paymentIntents.cancel = async () => { throw Object.assign(new Error('Network error (fake)'), { type: 'StripeConnectionError' }); };
  await tickets.reconcileDue();
  fake.paymentIntents.cancel = realCancel;
  check((await Order.findById(offline.data.order.id)).status === 'pending' && (await TicketType.findOne({ quest: offlineQuest._id })).held === 1, "Stripe unreachable at the hold's end: the seat stays held (a payment sheet doesn't expire by itself)", null);
  await tickets.reconcileDue();
  const offlineClosed = await Order.findById(offline.data.order.id);
  check(offlineClosed.status === 'expired' && fake._intents.get(offlineClosed.stripe.paymentIntentId).status === 'canceled' && (await TicketType.findOne({ quest: offlineQuest._id })).held === 0, '...and goes back once Stripe has cancelled the payment', offlineClosed.status);

  const goingThrough = await makeQuest('Sheet Processing', 15, 2);
  const halSheet = await request('POST', `/api/quests/${goingThrough.id}/payment-sheet`, hal.token, {});
  const halIntent = fake._intents.get((await Order.findById(halSheet.data.order.id)).stripe.paymentIntentId);
  halIntent.status = 'processing';
  const halAgain = await request('POST', `/api/quests/${goingThrough.id}/payment-sheet`, hal.token, {});
  check(halAgain.status === 409 && halAgain.data.code === 'payment_in_progress' && (await Order.findById(halSheet.data.order.id)).status === 'pending' && (await TicketType.findOne({ quest: goingThrough._id })).held === 1, 'a payment going through: another tap waits (409 payment_in_progress), no second order', halAgain.data);
  await webhook('payment_intent.succeeded', fake._payIntent(halIntent.id));
  check((await Order.findById(halSheet.data.order.id)).status === 'paid', '...then it is paid', null);

  const pageQuest = await makeQuest('Page Open', 15, 3);
  const pageOpen = await request('POST', `/api/quests/${pageQuest.id}/checkout`, gus.token, {});
  const stray = await webhook('payment_intent.canceled', { id: 'pi_stray_test', object: 'payment_intent', status: 'canceled', metadata: { orderId: pageOpen.data.order.id } });
  check(stray.status === 200 && (await Order.findById(pageOpen.data.order.id)).status === 'pending', "payment_intent.canceled doesn't close someone's open Stripe page", stray.data);
  const dashSheet = await request('POST', `/api/quests/${pageQuest.id}/payment-sheet`, hal.token, {});
  await webhook('payment_intent.canceled', await fake.paymentIntents.cancel((await Order.findById(dashSheet.data.order.id)).stripe.paymentIntentId));
  check((await Order.findById(dashSheet.data.order.id)).status === 'expired' && (await TicketType.findOne({ quest: pageQuest._id })).held === 1, '...but a payment sheet cancelled in Stripe gives its seat back', null);
  if (savedSheet === undefined) delete process.env.PAYMENT_SHEET;
  else process.env.PAYMENT_SHEET = savedSheet;

  console.log('\n--- be at the venue (live quests) ---');
  const venueQuest = await Quest.create({ slug: `venue-${suffix}`, title: 'Venue Hunt', status: 'upcoming', isPublished: true, startsAt: new Date(Date.now() - hour), endsAt: new Date(Date.now() + 2 * hour), location: venue, prizePool: { amount: 0, currency: 'USD' }, entryFee: { amount: 10, currency: 'USD' }, maxParticipants: 10, requireAtVenue: true, venueRadiusMeters: 200 });
  const noPlace = await request('POST', `/api/quests/${venueQuest.id}/checkout`, ben.token, {});
  check(noPlace.status === 403 && noPlace.data.code === 'location_required', 'live + at the venue: a position is needed', noPlace.data);
  const far = await request('POST', `/api/quests/${venueQuest.id}/checkout`, ben.token, { position: { lat: 32.75, lng: -117.16, accuracy: 20 } });
  check(far.status === 403 && far.data.code === 'not_at_venue' && far.data.distanceMeters > 3000, '...refused from 3+ km away', far.data);
  const vague = await request('POST', `/api/quests/${venueQuest.id}/checkout`, ben.token, { position: { lat: 32.7193, lng: -117.1611, accuracy: 5000 } });
  check(vague.status === 403 && vague.data.code === 'not_at_venue', '...a vague fix 400 m away is refused (GPS accuracy counts up to 100 m)', vague.data);
  const notObject = await request('POST', `/api/quests/${venueQuest.id}/checkout`, ben.token, { position: '32.7157,-117.1611' });
  check(notObject.status === 400, '...a position must be { lat, lng, accuracy }', notObject.data);
  const near = await request('POST', `/api/quests/${venueQuest.id}/checkout`, ben.token, { position: { lat: 32.7166, lng: -117.1611, accuracy: 15 } });
  check(near.status === 201 && near.data.checkoutUrl, '...allowed within the radius', near.data);
  const later = await makeQuest('Later Venue', 10, 5);
  await Quest.updateOne({ _id: later._id }, { $set: { requireAtVenue: true } });
  const ahead = await request('POST', `/api/quests/${later.id}/checkout`, ben.token, {});
  check(ahead.status === 201, 'tickets for later can be bought from anywhere', ahead.data);

  console.log('\n--- things going wrong ---');
  const meetup = await makeQuest('Late Meetup', 10, 2);
  fake._failNext = true;
  const down = await request('POST', `/api/quests/${meetup.id}/checkout`, ben.token, {});
  const afterDown = await TicketType.findOne({ quest: meetup._id });
  check(down.status === 502 && afterDown.held === 0, 'Stripe unreachable: nothing charged, the seat is released', { down: down.data, afterDown });
  const benOrder = await request('POST', `/api/quests/${meetup.id}/checkout`, ben.token, {});
  fake._pay((await Order.findById(benOrder.data.order.id)).stripe.checkoutSessionId);
  const synced = await request('GET', `/api/orders/${benOrder.data.order.id}`, ben.token);
  check(synced.data.order.status === 'paid', 'paid but the webhook is lost: the return page asks Stripe and finishes it', synced.data);

  const solo = await makeQuest('Solo Seat', 10, 1);
  const anaSolo = await request('POST', `/api/quests/${solo.id}/checkout`, ana.token, {});
  await Order.updateOne({ _id: anaSolo.data.order.id }, { $set: { holdExpiresAt: new Date(Date.now() - 1000) } });
  await tickets.reconcileDue();
  const expired = await Order.findById(anaSolo.data.order.id);
  check(expired.status === 'expired' && (await TicketType.findOne({ quest: solo._id })).held === 0, 'an abandoned checkout expires and gives the seat back', expired.status);
  const benSolo = await request('POST', `/api/quests/${solo.id}/checkout`, ben.token, {});
  await webhook('checkout.session.completed', fake._pay((await Order.findById(benSolo.data.order.id)).stripe.checkoutSessionId));
  const refundsBefore = fake._refunds.length;
  const anaLate = fake._pay(expired.stripe.checkoutSessionId);
  await webhook('checkout.session.completed', anaLate);
  const anaLateOrder = await Order.findById(anaSolo.data.order.id);
  check(anaLateOrder.status === 'refunded' && fake._refunds.length === refundsBefore + 1 && !(await Ticket.findOne({ order: anaLateOrder._id })), 'paid after the hold expired and it sold out: refunded automatically', anaLateOrder);

  const tamper = await makeQuest('Tamper Test', 10, 5);
  const tamperOrder = await request('POST', `/api/quests/${tamper.id}/checkout`, ana.token, {});
  const tamperSession = { ...fake._pay((await Order.findById(tamperOrder.data.order.id)).stripe.checkoutSessionId), amount_total: 100 };
  await webhook('checkout.session.completed', tamperSession);
  const tampered = await Order.findById(tamperOrder.data.order.id);
  check(tampered.status === 'refunded' && !(await Ticket.findOne({ order: tampered._id })) && (await TicketType.findOne({ quest: tamper._id })).held === 0, 'a wrong amount is refunded, never a ticket (seat released)', tampered.status);

  console.log('\n--- paid only (free tickets off by default) ---');
  const noFree = await makeQuest('No Free', 0, 3);
  const refusedFree = await request('POST', `/api/quests/${noFree.id}/checkout`, ana.token, {});
  check(refusedFree.status === 409 && refusedFree.data.code === 'not_on_sale', 'a quest without a price is not on sale', refusedFree.data);
  const freeTypes = await request('GET', `/api/quests/${noFree.id}/ticket-types`);
  check(freeTypes.data.ticketTypes?.[0]?.onSale === false, '...and its ticket type says not on sale', freeTypes.data);
  const freeType = await request('POST', `/api/admin/quests/${noFree.id}/ticket-types`, adminToken, { name: 'Free', price: { amount: 0 }, quantity: 5 });
  check(freeType.status === 400, 'admins cannot add a free ticket type', freeType.data);

  console.log('\n--- free tickets (ALLOW_FREE_TICKETS=1), giving back, refunds, cancelling ---');
  process.env.ALLOW_FREE_TICKETS = '1';
  const free = await makeQuest('Free Jam', 0, 3);
  const freeReg = await request('POST', `/api/quests/${free.id}/registrations`, ana.token);
  check(freeReg.status === 201 && freeReg.data.ticket?.id, 'free: the old register route issues a ticket', freeReg.data);
  const freeAgain = await request('POST', `/api/quests/${free.id}/registrations`, ana.token);
  check(freeAgain.status === 409 && freeAgain.data.error === 'You are already registered for this quest.', 'free: registering twice keeps the old answer', freeAgain.data);
  const freeCancel = await request('DELETE', `/api/quests/${free.id}/registrations`, ana.token);
  const freeSeat = await TicketType.findOne({ quest: free._id });
  check(freeCancel.status === 200 && freeSeat.sold === 0, 'free: unregistering releases the seat once', { freeCancel: freeCancel.data, freeSeat });
  delete process.env.ALLOW_FREE_TICKETS;

  const meetupTicket = await Ticket.findOne({ quest: meetup._id, user: ben.user._id });
  const giveBack = await request('POST', `/api/me/tickets/${meetupTicket.id}/cancel`, ben.token);
  check(giveBack.status === 200 && giveBack.data.refunded === true && (await TicketType.findOne({ quest: meetup._id })).sold === 0, 'giving a paid ticket back: refunded, seat back on sale', giveBack.data);
  const soon = await makeQuest('Starts Soon', 10, 5, 2);
  const soonOrder = await request('POST', `/api/quests/${soon.id}/checkout`, ana.token, {});
  await webhook('checkout.session.completed', fake._pay((await Order.findById(soonOrder.data.order.id)).stripe.checkoutSessionId));
  const soonTicket = await Ticket.findOne({ order: soonOrder.data.order.id });
  const tooLate = await request('POST', `/api/me/tickets/${soonTicket.id}/cancel`, ana.token);
  check(tooLate.status === 409 && tooLate.data.code === 'refund_window_closed', 'no giving back within 24 hours of the start', tooLate.data);
  const adminRefund = await request('POST', `/api/admin/orders/${soonOrder.data.order.id}/refund`, adminToken, { reason: 'Customer support' });
  check(adminRefund.status === 200 && adminRefund.data.order.status === 'refunded', 'an admin refund (any time, with a reason)', adminRefund.data);
  const twiceRefund = await request('POST', `/api/admin/orders/${soonOrder.data.order.id}/refund`, adminToken, { reason: 'Again' });
  check(twiceRefund.status === 409, 'a refund cannot happen twice', twiceRefund.data);

  const big = await makeQuest('Big Show', 10, 10);
  const bigOrder = await request('POST', `/api/quests/${big.id}/checkout`, ana.token, {});
  await webhook('checkout.session.completed', fake._pay((await Order.findById(bigOrder.data.order.id)).stripe.checkoutSessionId));
  const cancelled = await request('POST', `/api/admin/quests/${big.id}/cancel`, adminToken, { reason: 'Storm warning' });
  check(cancelled.status === 200 && cancelled.data.refunded === 1 && (await Order.findById(bigOrder.data.order.id)).status === 'refunded', 'cancelling a quest refunds every paid ticket', cancelled.data);

  const statsRes = await request('GET', '/api/admin/payments/stats', adminToken);
  check(statsRes.status === 200 && statsRes.data.gross >= 30 && statsRes.data.refunded >= 10 && statsRes.data.mode === 'test', 'payment stats (test mode)', statsRes.data);
  const orders = await request('GET', `/api/admin/orders?quest=${gala.id}`, adminToken);
  check(orders.data.orders?.length === 1 && orders.data.orders[0].status === 'paid', 'orders per quest', orders.data);

  console.log('\n--- deleting quests ---');
  const unused = await makeQuest('Unused Draft', 10, 5);
  await request('GET', `/api/quests/${unused.id}/ticket-types`); // makes its default ticket type
  const noReasonDel = await request('DELETE', `/api/admin/quests/${unused.id}`, adminToken, { reason: '' });
  check(noReasonDel.status === 400, 'deleting needs a reason', noReasonDel.data);
  const deleted = await request('DELETE', `/api/admin/quests/${unused.id}`, adminToken, { reason: 'Made by mistake' });
  check(deleted.status === 200 && !(await Quest.findById(unused._id)) && !(await TicketType.countDocuments({ quest: unused._id })), 'an unused quest is deleted with its ticket types', deleted.data);
  const withTicket = await request('DELETE', `/api/admin/quests/${gala.id}`, adminToken, { reason: 'Try' });
  check(withTicket.status === 409 && withTicket.data.code === 'has_registrations', 'a quest with registrations cannot be deleted', withTicket.data);
  check((await Quest.findById(gala._id)).isPublished === true, '...and a refused delete leaves it published', null);
  const withMoney = await request('DELETE', `/api/admin/quests/${big.id}`, adminToken, { reason: 'Try' });
  check(withMoney.status === 409 && withMoney.data.code === 'has_orders', 'a quest with payment history cannot be deleted', withMoney.data);
  const fay = await makeUser('Fay');
  const inCheckout = await makeQuest('In Checkout', 10, 5);
  await request('POST', `/api/quests/${inCheckout.id}/checkout`, fay.token, {});
  const whilePaying = await request('DELETE', `/api/admin/quests/${inCheckout.id}`, adminToken, { reason: 'Try' });
  check(whilePaying.status === 409 && whilePaying.data.code === 'has_orders' && (await Quest.findById(inCheckout._id)).isPublished, 'someone on the payment page: not deleted (still published)', whilePaying.data);

  console.log('\n--- partial refunds, price edits, refunds owed, webhooks in flight ---');
  const cal = await makeUser('Cal');
  const dee = await makeUser('Dee');
  const eve = await makeUser('Eve');
  const charged = async (user, quest) => {
    const started = await request('POST', `/api/quests/${quest.id}/checkout`, user.token, {});
    const s = fake._pay((await Order.findById(started.data.order.id)).stripe.checkoutSessionId);
    return { orderId: started.data.order.id, session: s };
  };

  const partialQuest = await makeQuest('Partial Refund', 20, 5);
  const calPaid = await charged(cal, partialQuest);
  await webhook('checkout.session.completed', calPaid.session);
  const pi = calPaid.session.payment_intent;
  await webhook('charge.refunded', { object: 'charge', payment_intent: pi, refunded: false, amount: 2000, amount_refunded: 500 });
  const afterPartial = await Order.findById(calPaid.orderId);
  check(afterPartial.status === 'paid' && (await Ticket.findOne({ order: calPaid.orderId })).status === 'valid', 'a partial refund in the Stripe dashboard keeps the ticket', afterPartial.history);
  await webhook('charge.refunded', { object: 'charge', payment_intent: pi, refunded: true, amount: 2000, amount_refunded: 2000 });
  check((await Order.findById(calPaid.orderId)).status === 'refunded' && (await Ticket.findOne({ order: calPaid.orderId })).status === 'refunded', 'a full refund in the dashboard gives the ticket back', null);

  const repriced = await makeQuest('Repriced', 10, 3);
  await request('GET', `/api/quests/${repriced.id}/ticket-types`);
  const newFee = await request('PATCH', `/api/admin/quests/${repriced.id}`, adminToken, { entryFee: { amount: 20 } });
  const repricedTypes = await request('GET', `/api/quests/${repriced.id}/ticket-types`);
  check(newFee.status === 200 && repricedTypes.data.ticketTypes[0].price.amount === 20, 'a new entry fee in the quest form is the price people pay', repricedTypes.data);
  await request('POST', `/api/quests/${repriced.id}/checkout`, dee.token, {}); // holds a seat
  const eveSold = await charged(eve, repriced);
  await webhook('checkout.session.completed', eveSold.session); // sells a seat
  const tooFewPlaces = await request('PATCH', `/api/admin/quests/${repriced.id}`, adminToken, { maxParticipants: 1 });
  check(tooFewPlaces.status === 409 && (await Quest.findById(repriced._id)).maxParticipants === 3, "places can't go below tickets sold + in checkout (nothing changed)", tooFewPlaces.data);
  const morePlaces = await request('PATCH', `/api/admin/quests/${repriced.id}`, adminToken, { maxParticipants: 6 });
  check(morePlaces.status === 200 && (await TicketType.findOne({ quest: repriced._id, isDefault: true })).quantity === 6, 'more places in the quest form are more tickets', morePlaces.data);

  const owedQuest = await makeQuest('Owed Refund', 10, 1);
  const calLate = await request('POST', `/api/quests/${owedQuest.id}/checkout`, cal.token, {});
  await Order.updateOne({ _id: calLate.data.order.id }, { $set: { holdExpiresAt: new Date(Date.now() - 1000) } });
  await tickets.reconcileDue();
  const deeWins = await charged(dee, owedQuest);
  await webhook('checkout.session.completed', deeWins.session);
  const realRefund = fake.refunds.create;
  fake.refunds.create = async () => { throw Object.assign(new Error('Network error (fake)'), { type: 'StripeConnectionError' }); };
  const calPaysLate = await webhook('checkout.session.completed', fake._pay((await Order.findById(calLate.data.order.id)).stripe.checkoutSessionId));
  const stuck = await Order.findById(calLate.data.order.id);
  check(calPaysLate.status === 500 && stuck.status === 'paid' && stuck.refundDue, 'paid late, sold out, Stripe refund fails: the refund is noted as owed and Stripe will retry', { status: calPaysLate.status, order: stuck.status, refundDue: stuck.refundDue });
  fake.refunds.create = realRefund;
  await tickets.reconcileDue();
  const settled = await Order.findById(calLate.data.order.id);
  check(settled.status === 'refunded' && !settled.refundDue && !(await Ticket.findOne({ order: settled._id })), '...and the 2-minute check pays it back', { status: settled.status, refundDue: settled.refundDue });

  const racy = await makeQuest('Two At Once', 10, 4);
  await Promise.all([request('GET', `/api/quests/${racy.id}/ticket-types`), request('GET', `/api/quests/${racy.id}/ticket-types`), request('GET', `/api/quests/${racy.id}/ticket-types`)]);
  const defaults = await TicketType.countDocuments({ quest: racy._id, isDefault: true });
  check(defaults === 1, 'opened by several people at once: one default ticket type (the places are not doubled)', defaults);

  const inflightPayload = JSON.stringify({ id: `evt_inflight_${suffix}`, type: 'payment_intent.payment_failed', data: { object: { object: 'payment_intent', metadata: {} } } });
  await StripeEvent.create({ _id: `evt_inflight_${suffix}`, type: 'payment_intent.payment_failed', done: false });
  const busy = await replay(inflightPayload);
  check(busy.status === 409 && (await StripeEvent.findById(`evt_inflight_${suffix}`)).done === false, 'a second delivery while the first is running: Stripe is asked to retry', busy);
  await StripeEvent.updateOne({ _id: `evt_inflight_${suffix}` }, { $set: { createdAt: new Date(Date.now() - 10 * 60 * 1000) } });
  const takenOver = await replay(inflightPayload);
  check(takenOver.status === 200 && (await StripeEvent.findById(`evt_inflight_${suffix}`)).done === true, 'a delivery stuck by a crash is taken over after 5 minutes', takenOver);

  console.log(`\ntickets: ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
