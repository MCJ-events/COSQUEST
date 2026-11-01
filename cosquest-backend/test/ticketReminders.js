// Tickets: the "starts in about an hour" reminder is sent once per valid
// ticket, only for quests starting in 50-70 minutes.
const crypto = require('crypto');
const User = require('../src/models/User');
const Quest = require('../src/models/Quest');
const Order = require('../src/models/Order');
const Ticket = require('../src/models/Ticket');
const TicketType = require('../src/models/TicketType');
const Notification = require('../src/models/Notification');
const tickets = require('../src/utils/tickets');

async function run() {
  let pass = 0;
  let fail = 0;
  function check(ok, name, value) {
    if (ok) { pass += 1; console.log(`  ok  - ${name}`); }
    else { fail += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 800)); }
  }
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const user = await User.create({ profile: { username: `Rem${suffix}`, usernameNormalized: `rem${suffix}`, firstName: 'Rem', lastName: 'Test', avatarKey: 'green-knight' }, email: `rem_${suffix}@example.com`, onboardingComplete: true });
  const venue = { name: 'Plaza', lat: 32.7, lng: -117.1 };
  async function questWithTicket(minutes, status = 'valid') {
    const quest = await Quest.create({ slug: `rem-${minutes}-${status}-${suffix}`, title: `In ${minutes} min ${suffix}`, status: 'upcoming', isPublished: true, startsAt: new Date(Date.now() + minutes * 60000), endsAt: new Date(Date.now() + (minutes + 120) * 60000), location: venue, prizePool: { amount: 0 }, entryFee: { amount: 0 }, maxParticipants: 10 });
    const type = await TicketType.create({ quest: quest._id, name: 'Free', price: { amount: 0, currency: 'USD' }, quantity: 10, sold: 1 });
    const order = await Order.create({ number: Math.floor(Math.random() * 1e9), user: user._id, quest: quest._id, ticketType: type._id, amount: { amount: 0, currency: 'USD' }, status: 'free' });
    const ticket = await Ticket.create({ code: `CQT-${crypto.randomBytes(16).toString('base64url')}`, order: order._id, user: user._id, quest: quest._id, ticketType: type._id, status });
    return { quest, ticket };
  }
  const due = await questWithTicket(60);
  const later = await questWithTicket(180);
  const refunded = await questWithTicket(60, 'refunded');

  const first = await tickets.remindersDue();
  const again = await tickets.remindersDue();
  const dueTicket = await Ticket.findById(due.ticket._id);
  const laterTicket = await Ticket.findById(later.ticket._id);
  const refundedTicket = await Ticket.findById(refunded.ticket._id);
  const notice = await Notification.findOne({ user: user._id, message: { $regex: `In 60 min ${suffix}.*about an hour` } });
  check(first >= 1 && dueTicket.reminderSentAt && notice, 'a ticket starting in an hour gets a reminder', { first, notice });
  const sentCount = await Notification.countDocuments({ user: user._id, message: { $regex: `In 60 min ${suffix}` } });
  check(again === 0 && sentCount === 1, 'never twice', { again, sentCount });
  check(!laterTicket.reminderSentAt, 'not for quests starting later', laterTicket.reminderSentAt);
  check(!refundedTicket.reminderSentAt, 'not for refunded tickets', refundedTicket.reminderSentAt);

  console.log(`\nticket reminders: ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
