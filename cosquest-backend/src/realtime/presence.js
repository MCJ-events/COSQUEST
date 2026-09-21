const { getRedisClient } = require('../config/redis');
const Conversation = require('../models/Conversation');
const User = require('../models/User');

/**
 * Redis-backed "who's connected right now," shared across every server
 * process (unlike Socket.IO room membership, which lives in each process's
 * own memory - see the redis-adapter setup in socket.js).
 *
 * `presence:conns:<userId>` counts that user's simultaneously open sockets
 * (multiple tabs/devices), so they're only announced offline once the last
 * one disconnects - not after closing just one of several open tabs.
 * `presence:online` is the actual online set, kept in sync with the counter.
 */
const ONLINE_SET_KEY = 'presence:online';
const connCountKey = (userId) => `presence:conns:${userId}`;

/** Call on socket connect. Returns true only on the 0 -> 1 transition (this really is a new "coming online"). */
async function markOnline(userId) {
  const redis = getRedisClient();
  const count = await redis.incr(connCountKey(userId));
  if (count === 1) {
    await redis.sadd(ONLINE_SET_KEY, String(userId));
    return true;
  }
  return false;
}

/** Call on socket disconnect. Returns true only on the 1 -> 0 transition (their last connection just closed). */
async function markOffline(userId) {
  const redis = getRedisClient();
  const count = await redis.decr(connCountKey(userId));
  if (count <= 0) {
    await redis.del(connCountKey(userId)); // don't let it drift negative (e.g. a disconnect firing twice)
    await redis.srem(ONLINE_SET_KEY, String(userId));
    return true;
  }
  return false;
}

async function isOnline(userId) {
  return Boolean(await getRedisClient().sismember(ONLINE_SET_KEY, String(userId)));
}

// Who should be told userId's presence changed? Only their DM partners -
// community/faction "rooms" have no stored member list to broadcast to (see
// Conversation.js's comments), so announcing presence there would mean
// pushing to every onboarded user or every faction member on every
// connect/disconnect. That's a different, much heavier feature; this only
// covers the relationship that's already cheap and precise to look up.
async function dmPartnerIds(userId) {
  const dms = await Conversation.find({ type: 'dm', participants: userId }, 'participants');
  return dms
    .map((dm) => dm.participants.find((p) => String(p) !== String(userId)))
    .filter(Boolean)
    .map(String);
}

/** Push a presence:online/presence:offline event to userId's DM partners, unless they've opted out of showing it. */
async function notifyPresenceChange(io, userId, event) {
  const user = await User.findById(userId, 'privacy.showOnlineStatus');
  if (user?.privacy?.showOnlineStatus === false) return; // same opt-out userPreview() already respects in chatController.js
  const partnerIds = await dmPartnerIds(userId);
  if (!partnerIds.length) return;
  io.to(partnerIds.map((id) => `user:${id}`)).emit(event, { userId: String(userId) });
}

module.exports = { markOnline, markOffline, isOnline, notifyPresenceChange };
