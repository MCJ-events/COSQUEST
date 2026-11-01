// Removes the demo quests made by scripts/seedHomeDashboard.js (isSeedData:
// true) and everything attached to them: registrations, ticket types,
// orders and tickets. CosQuest shows real quests only.
//
//   node scripts/removeSeedQuests.js          shows what would be removed
//   node scripts/removeSeedQuests.js --yes    removes it
//
// A seed quest with a pending, paid or refunded order is skipped: money
// moved (refunded: keep the record) or may still move (pending: the person
// can be on Stripe's page, and a payment for a deleted order could not be
// refunded automatically). Refund or let it expire, then run this again.
require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../src/config/db');
const Quest = require('../src/models/Quest');
const QuestRegistration = require('../src/models/QuestRegistration');

const optional = (path) => {
  try {
    return require(path);
  } catch {
    return null;
  }
};

async function run() {
  const yes = process.argv.includes('--yes');
  await connectDB();
  try {
    const TicketType = optional('../src/models/TicketType');
    const Order = optional('../src/models/Order');
    const Ticket = optional('../src/models/Ticket');
    const quests = await Quest.find({ isSeedData: true }).select('title slug');
    if (!quests.length) {
      console.log('No demo quests left. Nothing to do.');
      return;
    }
    let removed = 0;
    for (const quest of quests) {
      const [regs, types, orders, money, tickets] = await Promise.all([
        QuestRegistration.countDocuments({ quest: quest._id }),
        TicketType ? TicketType.countDocuments({ quest: quest._id }) : 0,
        Order ? Order.countDocuments({ quest: quest._id }) : 0,
        Order ? Order.countDocuments({ quest: quest._id, status: { $in: ['pending', 'paid', 'refunded'] } }) : 0,
        Ticket ? Ticket.countDocuments({ quest: quest._id }) : 0,
      ]);
      const line = `"${quest.title}" (${quest.slug}): ${regs} registrations, ${types} ticket types, ${orders} orders, ${tickets} tickets`;
      if (money) {
        console.log(`SKIPPED ${line} - ${money} pending, paid or refunded order(s): money is involved, so this one stays.`);
        continue;
      }
      if (!yes) {
        console.log(`would remove ${line}`);
        continue;
      }
      await Promise.all([
        QuestRegistration.deleteMany({ quest: quest._id }),
        TicketType ? TicketType.deleteMany({ quest: quest._id }) : null,
        Order ? Order.deleteMany({ quest: quest._id }) : null,
        Ticket ? Ticket.deleteMany({ quest: quest._id }) : null,
      ]);
      await Quest.deleteOne({ _id: quest._id });
      removed += 1;
      console.log(`removed ${line}`);
    }
    console.log(yes ? `\nRemoved ${removed} demo quest(s).` : '\nNothing removed yet. Run again with --yes to remove them.');
  } finally {
    await disconnectDB();
    await mongoose.disconnect().catch(() => {});
  }
}

run().catch((error) => {
  console.error('Removing demo quests failed:', error.message);
  process.exit(1);
});
