const userModel = require('../models/userModel');
const Follow = require('../models/Follow');
const Post = require('../models/Post');
const QuestRegistration = require('../models/QuestRegistration');
const notificationModel = require('../models/notificationModel');
const { serializeQuest } = require('../utils/quest');

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
    name: [user.profile.firstName, user.profile.lastName].filter(Boolean).join(' ') || user.profile.username,
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

// GET /api/users/:username/profile - public profiles are visible to everyone.
async function getPublicProfile(req, res) {
  const user = await findTarget(req.params.username);
  if (!user) return res.status(404).json({ error: 'Profile not found.' });

  const stats = await statsFor(user);
  return res.json({
    profile: {
      ...previewUser(user),
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
  if (!user) return res.status(404).json({ error: 'Profile not found.' });

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

  try {
    await Follow.create({ follower: req.userId, following: target._id });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'You already follow this profile.' });
    throw error;
  }

  const actorName = req.user.profile.username || req.user.profile.firstName || 'Someone';
  await notificationModel.createForUser(target._id, `${actorName} started following you.`, {
    type: 'follow',
    actor: req.userId,
  });
  return res.status(201).json({ message: 'Following profile.', following: true });
}

async function unfollowUser(req, res) {
  const target = await findTarget(req.params.username);
  if (!target) return res.status(404).json({ error: 'Profile not found.' });

  const result = await Follow.deleteOne({ follower: req.userId, following: target._id });
  if (!result.deletedCount) return res.status(404).json({ error: 'You do not follow this profile.' });
  return res.json({ message: 'Unfollowed profile.', following: false });
}

async function listRelationship(req, res, field) {
  const target = await findTarget(req.params.username);
  if (!target) return res.status(404).json({ error: 'Profile not found.' });

  const limit = parseLimit(req.query.limit);
  const page = parsePage(req.query.page);
  const query = field === 'followers' ? { following: target._id } : { follower: target._id };
  const populatedField = field === 'followers' ? 'follower' : 'following';
  const [rows, total] = await Promise.all([
    Follow.find(query)
      .populate(populatedField, 'profile.username profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl faction')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Follow.countDocuments(query),
  ]);

  return res.json({
    users: rows.filter((row) => row[populatedField]).map((row) => previewUser(row[populatedField])),
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
  previewUser,
  statsFor,
};
