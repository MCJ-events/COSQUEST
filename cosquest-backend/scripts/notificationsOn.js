// Turns notifications back ON for accounts that have them off
// (preferences.notificationsEnabled false), so calls and messages reach
// them again. Many switched them off by accident at sign-up, or never chose
// and were left on the old default (off); they can switch them off again in
// Settings.
//
//   node scripts/notificationsOn.js                     shows how many accounts are off, and why
//   node scripts/notificationsOn.js --yes               turns them all on
//   node scripts/notificationsOn.js --yes --never-chose only the accounts that never chose
//                                                       (off by the old default, not by a choice)
//
// "Chose" (onboarding.notificationPreferenceChosen) is set by sign-up's
// notifications step and by Settings alike, so a choice made at sign-up and
// one made later in Settings look the same here.
require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../src/config/db');
const User = require('../src/models/User');

async function run() {
  const yes = process.argv.includes('--yes');
  const neverChoseOnly = process.argv.includes('--never-chose');
  await connectDB();
  try {
    const off = { 'preferences.notificationsEnabled': false };
    const neverChose = { ...off, 'onboarding.notificationPreferenceChosen': { $ne: true } };
    const chose = { ...off, 'onboarding.notificationPreferenceChosen': true };
    const withPhone = { devices: { $elemMatch: { authed: true } } };
    const [total, unchosen, chosen, unchosenPhones, chosenPhones] = await Promise.all([
      User.countDocuments(off),
      User.countDocuments(neverChose),
      User.countDocuments(chose),
      User.countDocuments({ ...neverChose, ...withPhone }),
      User.countDocuments({ ...chose, ...withPhone }),
    ]);
    console.log(`${total} account(s) have notifications off:`);
    console.log(`  ${unchosen} never chose (off by the old default); ${unchosenPhones} of them have a phone registered`);
    console.log(`  ${chosen} chose off, at sign-up or in Settings; ${chosenPhones} of them have a phone registered`);
    if (!yes) {
      console.log('Run again with --yes to turn them all on, or --yes --never-chose for only the first group.');
      return;
    }
    const result = await User.updateMany(neverChoseOnly ? neverChose : off, { $set: { 'preferences.notificationsEnabled': true } });
    console.log(`Turned notifications on for ${result.modifiedCount} account(s).`);
  } finally {
    await disconnectDB();
    await mongoose.disconnect().catch(() => {});
  }
}

run().catch((error) => {
  console.error('Failed:', error.message);
  process.exit(1);
});
