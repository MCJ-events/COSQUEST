const userModel = require('../models/userModel');
const User = require('../models/User');
const Follow = require('../models/Follow');
const Post = require('../models/Post');
const Block = require('../models/Block');
const QuestRegistration = require('../models/QuestRegistration');
const notificationModel = require('../models/notificationModel');
const { serializeQuest } = require('../utils/quest');

// "Friends" for visibility purposes = mutual follow - there's no separate
// friend-request system in this app, only one-way Follow.
async function areFriends(userIdA, userIdB) {
  const [aFollowsB, bFollowsA] = await Promise.all([
    Follow.exists({ follower: userIdA, following: userIdB }),
    Follow.exists({ follower: userIdB, following: userIdA }),
  ]);
  return Boolean(aFollowsB && bFollowsA);
}

async function isBlockedEitherWay(userIdA, userIdB) {
  if (!userIdA || !userIdB) return false;
  const block = await Block.findOne({
    $or: [
      { blocker: userIdA, blocked: userIdB },
      { blocker: userIdB, blocked: userIdA },
    ],
  });
  return Boolean(block);
}

/**
 * Single gate for every profile-adjacent public endpoint (profile,
 * followers, following, quest history, posts, the /u/:username share page).
 * A blocked or not-visible-to-this-viewer profile reads exactly like a
 * missing one (404) - it never confirms whether the account exists.
 */
async function canViewProfile(target, viewerId) {
  if (viewerId && String(viewerId) === String(target._id)) return true;
  if (viewerId && (await isBlockedEitherWay(viewerId, target._id))) return false;

  const visibility = target.privacy?.profileVisibility || 'public';
  if (visibility === 'public') return true;
  if (visibility === 'private') return false;
  // 'friends'
  return viewerId ? areFriends(viewerId, target._id) : false;
}

/**
 * Extra, stricter gate just for the posts/activity list: "Show Activity
 * Feed" off hides posts from strangers even on an otherwise-public profile,
 * leaving them visible to the owner and to friends (mutual follows) only.
 */
async function canViewActivityFeed(target, viewerId) {
  if (viewerId && String(viewerId) === String(target._id)) return true;
  if (!(await canViewProfile(target, viewerId))) return false;
  if (target.privacy?.showActivityFeed === false) {
    return viewerId ? areFriends(viewerId, target._id) : false;
  }
  return true;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const REGISTRATION_STATUSES = ['registered', 'cancelled', 'completed', 'winner'];

function parseLimit(value, fallback = 20) {
  const limit = Number(value);
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : fallback;
}

function parsePage(value) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? Math.min(page, 1000) : 1;
}

function previewUser(user) {
  return {
    id: String(user._id),
    username: user.profile.username,
    name: user.profile.displayName || [user.profile.firstName, user.profile.lastName].filter(Boolean).join(' ') || user.profile.username,
    avatarKey: user.profile.avatarKey,
    avatarPhotoUrl: user.profile.avatarPhotoUrl,
    faction: user.faction,
  };
}

async function statsFor(user) {
  const [followers, following, posts, quests, wins] = await Promise.all([
    Follow.countDocuments({ following: user._id }),
    Follow.countDocuments({ follower: user._id }),
    Post.countDocuments({ author: user._id }),
    // The Profile "Quest" count means quests this person registered for,
    // including a registration they later cancelled.
    QuestRegistration.countDocuments({ user: user._id }),
    QuestRegistration.countDocuments({ user: user._id, status: 'winner' }),
  ]);

  return { followers, following, posts, quests, wins, points: user.pointsBalance || 0 };
}

async function findTarget(username) {
  return userModel.findByUsername(username);
}

// For the signed-in viewer: which of these people they follow, and which
// follow them back, in two queries. Map(userId -> { following, followedBy }).
async function relationshipsWith(viewerId, userIds) {
  const ids = userIds.map(String);
  if (!viewerId || !ids.length) return new Map();
  const [mine, theirs] = await Promise.all([
    Follow.find({ follower: viewerId, following: { $in: ids } }, 'following').lean(),
    Follow.find({ follower: { $in: ids }, following: viewerId }, 'follower').lean(),
  ]);
  const following = new Set(mine.map((row) => String(row.following)));
  const followedBy = new Set(theirs.map((row) => String(row.follower)));
  return new Map(ids.map((id) => [id, { following: following.has(id), followedBy: followedBy.has(id) }]));
}

// The counts both screens show right after a follow/unfollow, so the app
// can update at once without asking for the profile again.
async function followCounts(targetId, viewerId) {
  const [followerCount, followingCount] = await Promise.all([
    Follow.countDocuments({ following: targetId }),
    Follow.countDocuments({ follower: viewerId }),
  ]);
  return { followerCount, followingCount };
}

// GET /api/users/:username/profile - public unless the owner set it to
// friends-only or private (see privacyController.js), and never visible
// across a block in either direction.
async function getPublicProfile(req, res) {
  const user = await findTarget(req.params.username);
  if (!user || !(await canViewProfile(user, req.userId))) return res.status(404).json({ error: 'Profile not found.' });

  const self = req.userId && String(req.userId) === String(user._id);
  const [stats, relationships] = await Promise.all([
    statsFor(user),
    self ? new Map() : relationshipsWith(req.userId, [user._id]),
  ]);
  return res.json({
    profile: {
      ...previewUser(user),
      // Signed in and not your own profile: do you follow them, do they follow you.
      relationship: relationships.get(String(user._id)) || null,
      bio: user.profile.bio || '',
      category: user.profile.showCategoryOnProfile ? user.profile.category : null,
      contact: {
        email: user.contact?.email || '',
        phone: user.contact?.phone || '',
        businessAddress: user.contact?.businessAddress || '',
      },
      stats,
      createdAt: user.createdAt,
    },
  });
}

// GET /api/users/me/points - kept separate for the wallet/points UI.
function getMyPoints(req, res) {
  return res.json({ points: req.user.pointsBalance || 0 });
}

// GET /api/users/:username/quests - the profile's registered quest history.
async function listQuestHistory(req, res) {
  const user = await findTarget(req.params.username);
  if (!user || !(await canViewProfile(user, req.userId))) return res.status(404).json({ error: 'Profile not found.' });

  const { status } = req.query;
  if (status && !REGISTRATION_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${REGISTRATION_STATUSES.join(', ')}.` });
  }

  const limit = parseLimit(req.query.limit);
  const page = parsePage(req.query.page);
  const query = { user: user._id, ...(status ? { status } : {}) };
  const [registrations, total] = await Promise.all([
    QuestRegistration.find(query)
      .populate('quest')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    QuestRegistration.countDocuments(query),
  ]);

  return res.json({
    quests: registrations
      .filter((registration) => registration.quest)
      .map((registration) => ({
        registrationId: String(registration._id),
        status: registration.status,
        registeredAt: registration.createdAt,
        quest: serializeQuest(registration.quest),
      })),
    pagination: { page, limit, total, hasMore: page * limit < total },
  });
}

async function followUser(req, res) {
  const target = await findTarget(req.params.username);
  if (!target) return res.status(404).json({ error: 'Profile not found.' });
  if (String(target._id) === String(req.userId)) {
    return res.status(400).json({ error: 'You cannot follow your own profile.' });
  }
  if (await isBlockedEitherWay(req.userId, target._id)) {
    return res.status(404).json({ error: 'Profile not found.' });
  }
  // "Allow new followers" off (privacy.allowFriendRequests): no new followers.
  if (target.privacy?.allowFriendRequests === false && !(await Follow.exists({ follower: req.userId, following: target._id }))) {
    return res.status(403).json({ error: 'This person isn\'t accepting new followers.', code: 'not_accepting_followers' });
  }

  // Following again is not an error (a double tap, a retry): same answer.
  let created = true;
  try {
    await Follow.create({ follower: req.userId, following: target._id });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    created = false;
  }

  const counts = await followCounts(target._id, req.userId);
  res.status(created ? 201 : 200).json({ message: 'Following profile.', following: true, ...counts });

  // After answering, so the button flips at once. One follow notification
  // per person per day: follow/unfollow/follow doesn't notify three times.
  if (created) notifyFollow(target._id, req.user).catch((error) => console.error('[follow] notification failed:', error.message));
}

async function notifyFollow(targetId, actor) {
  const recent = await require('../models/Notification').exists({
    user: targetId, actor: actor._id, type: 'follow', createdAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  });
  if (recent) return;
  const actorName = actor.profile.username || actor.profile.firstName || 'Someone';
  await notificationModel.createForUser(targetId, `${actorName} started following you.`, { type: 'follow', actor: actor._id });
}

async function unfollowUser(req, res) {
  const target = await findTarget(req.params.username);
  if (!target) return res.status(404).json({ error: 'Profile not found.' });

  // Unfollowing someone you don't follow is not an error either: same answer.
  await Follow.deleteOne({ follower: req.userId, following: target._id });
  return res.json({ message: 'Unfollowed profile.', following: false, ...(await followCounts(target._id, req.userId)) });
}

async function listRelationship(req, res, field) {
  const target = await findTarget(req.params.username);
  if (!target || !(await canViewProfile(target, req.userId))) return res.status(404).json({ error: 'Profile not found.' });

  const limit = parseLimit(req.query.limit);
  const page = parsePage(req.query.page);
  const matchField = field === 'followers' ? 'following' : 'follower';
  const populatedField = field === 'followers' ? 'follower' : 'following';
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

  // A plain find+populate can't filter by the *populated* side's fields
  // (population happens after the main query matches), so a real name/
  // username search needs an aggregation - $lookup joins in the User data
  // before the $match, exactly like a populate, but filterable.
  if (!search) {
    const query = { [matchField]: target._id };
    const [rows, total] = await Promise.all([
      Follow.find(query)
        .populate(populatedField, 'profile.username profile.displayName profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl faction')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Follow.countDocuments(query),
    ]);
    const people = rows.filter((row) => row[populatedField]).map((row) => row[populatedField]);
    return res.json({
      users: await withRelationships(people, req.userId),
      pagination: { page, limit, total, hasMore: page * limit < total },
    });
  }

  const regex = new RegExp(escapeRegex(search), 'i');
  const [result] = await Follow.aggregate([
    { $match: { [matchField]: target._id } },
    { $sort: { createdAt: -1 } },
    { $lookup: { from: 'users', localField: populatedField, foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    {
      $match: {
        $or: [
          { 'user.profile.username': regex },
          { 'user.profile.firstName': regex },
          { 'user.profile.lastName': regex },
        ],
      },
    },
    {
      $facet: {
        rows: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        totalCount: [{ $count: 'count' }],
      },
    },
  ]);

  const total = result.totalCount[0]?.count || 0;
  return res.json({
    users: await withRelationships(result.rows.map((row) => row.user), req.userId),
    pagination: { page, limit, total, hasMore: page * limit < total },
  });
}

// Follower/following list rows, each with whether the signed-in viewer
// follows that person (the row's Follow / Following button).
async function withRelationships(users, viewerId) {
  const relationships = await relationshipsWith(viewerId, users.map((user) => user._id));
  return users.map((user) => ({ ...previewUser(user), relationship: relationships.get(String(user._id)) || null }));
}

// GET /api/users/search?search=jamie - find people to start a DM/forward with,
// by username/first/last name. Private accounts aren't found (only people
// already chatting with them can message them, from their chat list:
// src/utils/privacy.js); Friends accounts are, so people can follow them.
// Messaging rules are checked once you actually try to message someone. A
// block hides someone from search in both directions, same as everywhere
// else, and incomplete accounts never show up.
async function searchUsers(req, res) {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  if (!search) return res.status(400).json({ error: 'search is required.' });

  const limit = parseLimit(req.query.limit);
  const page = parsePage(req.query.page);
  const regex = new RegExp(escapeRegex(search), 'i');

  const blocks = await Block.find({ $or: [{ blocker: req.userId }, { blocked: req.userId }] });
  const excludedIds = [req.userId, ...blocks.map((b) => (String(b.blocker) === String(req.userId) ? b.blocked : b.blocker))];

  const query = {
    _id: { $nin: excludedIds },
    onboardingComplete: true,
    // Private profiles aren't found by search (Settings > Privacy).
    'privacy.profileVisibility': { $ne: 'private' },
    $or: [{ 'profile.username': regex }, { 'profile.firstName': regex }, { 'profile.lastName': regex }],
  };
  const [users, total] = await Promise.all([
    User.find(query)
      .select('profile.username profile.displayName profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl faction')
      .sort({ 'profile.username': 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(query),
  ]);

  return res.json({
    users: users.map(previewUser),
    pagination: { page, limit, total, hasMore: page * limit < total },
  });
}

// GET /api/users/discover - browse people without a search term.
async function discoverUsers(req, res) {
  const limit = parseLimit(req.query.limit);
  const page = parsePage(req.query.page);

  const blocks = await Block.find({ $or: [{ blocker: req.userId }, { blocked: req.userId }] });
  const excludedIds = [req.userId, ...blocks.map((block) => (
    String(block.blocker) === String(req.userId) ? block.blocked : block.blocker
  ))];
  const query = { _id: { $nin: excludedIds }, onboardingComplete: true, 'privacy.profileVisibility': { $ne: 'private' } };

  const [users, total] = await Promise.all([
    User.find(query)
      .select('profile.username profile.displayName profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl faction')
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(query),
  ]);

  return res.json({
    users: users.map(previewUser),
    pagination: { page, limit, total, hasMore: page * limit < total },
  });
}

function listFollowers(req, res) {
  return listRelationship(req, res, 'followers');
}

function listFollowing(req, res) {
  return listRelationship(req, res, 'following');
}

module.exports = {
  getPublicProfile,
  getMyPoints,
  listQuestHistory,
  followUser,
  unfollowUser,
  listFollowers,
  listFollowing,
  searchUsers,
  discoverUsers,
  previewUser,
  statsFor,
  canViewProfile,
  canViewActivityFeed,
  isBlockedEitherWay,
  parseLimit,
  parsePage,
};
