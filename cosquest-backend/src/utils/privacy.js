// Privacy that really works (Settings > Privacy & Visibility).
//
//                      Public           Friends                        Private
//   Posts, activity    everyone         friends (mutual follows)       only you
//   Search, Discover   yes              yes                            no
//   Messages           everyone*        friends only*                  only people already chatting with you*
//   Online status      your switch      friends only (and your switch) hidden
//   (* and only if "Allow direct messages" is on; blocks hide people everywhere)
//
// "Friends" = a mutual follow (publicProfileController areFriends). The
// profile page itself already used canViewProfile / canViewActivityFeed; this
// adds the main feed, single posts, comments and likes, sharing, search,
// messages and online status.
const Follow = require('../models/Follow');
const Block = require('../models/Block');
const User = require('../models/User');
const Conversation = require('../models/Conversation');

const id = (value) => String(value?._id || value);

/** The viewer's friends (mutual follows), as a Set of ids. */
async function friendIdsOf(userId) {
  if (!userId) return new Set();
  const [following, followers] = await Promise.all([
    Follow.find({ follower: userId }, 'following').lean(),
    Follow.find({ following: userId }, 'follower').lean(),
  ]);
  const back = new Set(followers.map((row) => String(row.follower)));
  return new Set(following.map((row) => String(row.following)).filter((other) => back.has(other)));
}

async function areFriends(a, b) {
  const [ab, ba] = await Promise.all([Follow.exists({ follower: a, following: b }), Follow.exists({ follower: b, following: a })]);
  return Boolean(ab && ba);
}

async function blockedIdsOf(userId) {
  if (!userId) return new Set();
  const rows = await Block.find({ $or: [{ blocker: userId }, { blocked: userId }] }, 'blocker blocked').lean();
  return new Set(rows.map((b) => (String(b.blocker) === String(userId) ? String(b.blocked) : String(b.blocker))));
}

/**
 * People whose posts this viewer may NOT see in lists (the main feed, shared
 * originals): private profiles, friends-only profiles and "activity off"
 * when not friends, and blocks either way. Never the viewer themself.
 */
async function hiddenAuthorIds(viewerId) {
  const [restricted, friends, blocked] = await Promise.all([
    User.find({ $or: [{ 'privacy.profileVisibility': { $in: ['friends', 'private'] } }, { 'privacy.showActivityFeed': false }] }, '_id privacy.profileVisibility').lean(),
    friendIdsOf(viewerId),
    blockedIdsOf(viewerId),
  ]);
  const hidden = new Set(blocked);
  for (const user of restricted) {
    const userId = String(user._id);
    if (viewerId && userId === String(viewerId)) continue;
    if (user.privacy?.profileVisibility === 'private' || !friends.has(userId)) hidden.add(userId);
  }
  return hidden;
}

/** Can this viewer see this post (its author populated with privacy)? */
async function canViewPost(post, viewerId) {
  const author = post?.author;
  if (!author || !author._id) return true;
  const { canViewActivityFeed } = require('../controllers/publicProfileController');
  return canViewActivityFeed(author, viewerId);
}

/** The posts in this list the viewer may see (bookmarks). */
async function visiblePosts(posts, viewerId) {
  const hidden = await hiddenAuthorIds(viewerId);
  return posts.filter((post) => !post.author || !hidden.has(id(post.author)));
}

/** Everyone can see this author's posts (so they may be shared to the feed). */
function isPublicAuthor(author) {
  return (author?.privacy?.profileVisibility || 'public') === 'public' && author?.privacy?.showActivityFeed !== false;
}

/**
 * Who may message this person (after the block and "Allow direct messages"
 * checks): Friends = friends only; Private = only people who already have a
 * chat with them (existing: true when sending in an existing chat).
 * Returns null (allowed) or { status, message, extra }.
 */
async function dmRefusal(target, senderId, { existing = false } = {}) {
  const visibility = target?.privacy?.profileVisibility || 'public';
  if (visibility === 'friends' && !(await areFriends(senderId, target._id))) {
    return { status: 403, message: 'Only friends (people who follow each other) can message this person.', extra: { code: 'friends_only' } };
  }
  if (visibility === 'private' && !existing) {
    const chat = await Conversation.exists({ type: 'dm', participants: { $all: [senderId, target._id] } });
    if (!chat) return { status: 403, message: 'This account is private: only people already chatting with them can message them.', extra: { code: 'private_account' } };
  }
  return null;
}

/** Of these people, whose online status this viewer may NOT see (Friends: friends only; Private: nobody). */
async function onlineHiddenFrom(viewerId, userIds) {
  const ids = (userIds || []).map(String);
  if (!ids.length) return new Set();
  const users = await User.find({ _id: { $in: ids }, 'privacy.profileVisibility': { $in: ['friends', 'private'] } }, '_id privacy.profileVisibility').lean();
  if (!users.length) return new Set();
  const friends = await friendIdsOf(viewerId);
  return new Set(users.filter((u) => u.privacy?.profileVisibility === 'private' || !friends.has(String(u._id))).map((u) => String(u._id)));
}

/**
 * Ringing someone into a group call: members of the group can always be
 * rung (they joined it). From outside a group they belong to, the message
 * rules apply (Friends: friends only; Private: people already chatting with
 * them). Returns null (allowed) or { status, message, extra }.
 */
async function callInviteRefusal(target, inviterId, { isMember = false } = {}) {
  if (isMember) return null;
  return dmRefusal(target, inviterId);
}

module.exports = { callInviteRefusal, friendIdsOf, areFriends, hiddenAuthorIds, canViewPost, visiblePosts, isPublicAuthor, dmRefusal, onlineHiddenFrom };
