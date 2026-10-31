// Make someone a platform super admin (the admin dashboard), or take it away.
// For the FIRST super admin; after that, super admins invite others from the
// dashboard (Roles & permissions).
//
//   node scripts/setSuperAdmin.js <username> [--remove] [--reason "Initial admin"]
//
// Recorded in the audit log (as done by that person, via the server script).
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const { recordAudit } = require('../src/utils/audit');

async function main() {
  const args = process.argv.slice(2);
  const username = args.find((arg) => !arg.startsWith('--'));
  const remove = args.includes('--remove');
  const reasonAt = args.indexOf('--reason');
  const reason = reasonAt >= 0 ? args[reasonAt + 1] || '' : remove ? 'Removed by server script' : 'Initial admin';
  if (!username) {
    console.log('Usage: node scripts/setSuperAdmin.js <username> [--remove] [--reason "..."]');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const user = await User.findOne({ 'profile.usernameNormalized': username.toLowerCase() });
  if (!user) {
    console.log(`No user called ${username}.`);
    process.exit(1);
  }

  const before = user.platformRole || null;
  user.platformRole = remove ? null : 'admin';
  user.adminSince = remove ? null : user.adminSince || new Date();
  if (remove) user.adminSessionId = null; // ends their dashboard session at once
  await user.save();

  await recordAudit(user, {
    action: remove ? 'admin.revoke' : 'admin.grant',
    area: 'roles',
    target: { type: 'admin', id: user._id, label: `@${user.profile.username}` },
    reason,
    before: { platformRole: before },
    after: { platformRole: user.platformRole },
    meta: { via: 'server_script' },
  });

  console.log(remove ? `@${user.profile.username} is no longer a super admin.` : `@${user.profile.username} is now a super admin.`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
