const User = require('./User');
const Notification = require('./Notification');

/**
 * Drops one Notification per user currently opted in
 * (`preferences.notificationsEnabled`). This is the in-app half of "allow
 * notifications" - it needs no external service, since the message just
 * sits in MongoDB until the person opens the app and asks for it. Returns
 * how many users it was delivered to.
 */
async function createForEnabledUsers(message) {
  const users = await User.find({ 'preferences.notificationsEnabled': true }, '_id');
  if (!users.length) return 0;
  await Notification.insertMany(users.map((u) => ({ user: u._id, message })));
  return users.length;
}

/**
 * Unconditional single-user version - used for the welcome notification
 * sent at signup, before the person has ever set `notificationsEnabled`
 * (it defaults to false and isn't chosen until onboarding step 4).
 */
async function createForUser(userId, message, { type = 'system', actor } = {}) {
  return Notification.create({ user: userId, message, type, actor: actor || null });
}

async function listForUser(userId) {
  return Notification.find({ user: userId })
    .populate('actor', 'profile.username profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl')
    .sort({ createdAt: -1 });
}

async function markAllRead(userId) {
  await Notification.updateMany({ user: userId, read: false }, { $set: { read: true } });
}

function sanitize(n) {
  const actor = n.actor && typeof n.actor === 'object' && n.actor.profile
    ? {
        id: String(n.actor._id),
        username: n.actor.profile.username,
        name: [n.actor.profile.firstName, n.actor.profile.lastName].filter(Boolean).join(' '),
        avatarKey: n.actor.profile.avatarKey,
        avatarPhotoUrl: n.actor.profile.avatarPhotoUrl,
      }
    : null;
  return { id: String(n._id), type: n.type, message: n.message, actor, read: n.read, createdAt: n.createdAt };
}

module.exports = { createForEnabledUsers, createForUser, listForUser, markAllRead, sanitize };
