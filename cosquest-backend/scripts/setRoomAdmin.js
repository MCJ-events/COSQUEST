// Make someone an admin of the Community room or a faction room (or take it
// away). Room admins can mute and remove people in that room's voice chat,
// run its stage (speakers and listeners) and end it - the same powers a group
// admin has in a group's voice chat. Rank alone never gives these powers.
//
//   node scripts/setRoomAdmin.js <username> community
//   node scripts/setRoomAdmin.js <username> faction:<factionKey>
//   node scripts/setRoomAdmin.js <username> faction:<factionKey> --remove
//
// Uses MONGODB_URI from .env.
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Conversation = require('../src/models/Conversation');
const ConversationMember = require('../src/models/ConversationMember');

async function main() {
  const [username, room, flag] = process.argv.slice(2);
  if (!username || !room || !/^(community|faction:[\w-]+)$/.test(room)) {
    console.error('Usage: node scripts/setRoomAdmin.js <username> community|faction:<factionKey> [--remove]');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const user = await User.findOne({ 'profile.usernameNormalized': username.toLowerCase() });
  if (!user) throw new Error(`No user named ${username}.`);
  const filter = room === 'community' ? { type: 'community' } : { type: 'faction', factionKey: room.slice('faction:'.length) };
  const conversation = await Conversation.findOne(filter);
  if (!conversation) throw new Error(`No ${room} room yet (it is created the first time someone opens it).`);
  if (filter.type === 'faction' && user.faction !== filter.factionKey) throw new Error(`${username} is not in the ${filter.factionKey} faction.`);
  const role = flag === '--remove' ? null : 'admin';
  await ConversationMember.updateOne({ conversation: conversation._id, user: user._id }, { $set: { role } }, { upsert: true });
  console.log(`${username} is ${role ? 'now an admin of' : 'no longer an admin of'} the ${room} room.`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
