const express = require('express');
const { upload } = require('../middleware/upload');
const { requireAuth, optionalAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { usernameCheckLimiter } = require('../middleware/rateLimiter');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  getMe,
  updateProfile,
  getContact,
  updateContact,
  checkUsername,
  setAvatar,
  uploadAvatarPhoto,
} = require('../controllers/profileController');
const {
  getPublicProfile,
  getMyPoints,
  listQuestHistory,
  followUser,
  unfollowUser,
  listFollowers,
  listFollowing,
  searchUsers,
  discoverUsers,
} = require('../controllers/publicProfileController');
const { getProfileShareLink } = require('../controllers/shareController');
const { getPrivacy, updatePrivacy } = require('../controllers/privacyController');
const { blockUser, unblockUser, listBlockedUsers } = require('../controllers/blockController');

const router = express.Router();

// Every /me route needs a signed-in session (signup and login both return
// one): requireAuth checks the token, logout (tokenVersion) and the
// single-device rule (currentSessionId). An email or username is never
// accepted in place of the token.
router.get('/me', requireAuth, getMe);
router.patch('/me/profile', requireAuth, asyncHandler(updateProfile));
// Public, boolean only ({ username, available }). A token is optional: with
// one, the caller's own current username counts as available to them.
router.get('/check-username', usernameCheckLimiter, asyncHandler(optionalAuth), asyncHandler(checkUsername));
router.patch('/me/avatar', requireAuth, asyncHandler(setAvatar));
// requireAuth runs before multer, so an unauthenticated upload is rejected
// before anything is written to disk.
router.post('/me/avatar/photo', requireAuth, upload.single('photo'), asyncHandler(uploadAvatarPhoto));
router.get('/me/points', requireAuth, requireCompletedOnboarding, getMyPoints);
router.get('/me/contact', requireAuth, asyncHandler(getContact));
router.patch('/me/contact', requireAuth, asyncHandler(updateContact));
router.get('/me/privacy', requireAuth, requireCompletedOnboarding, getPrivacy);
router.patch('/me/privacy', requireAuth, requireCompletedOnboarding, asyncHandler(updatePrivacy));
router.get('/me/blocked', requireAuth, requireCompletedOnboarding, asyncHandler(listBlockedUsers));

// Find people to start a DM/forward with, by name - see searchUsers. Placed
// before /:username so "search" can never be mistaken for a username.
router.get('/search', requireAuth, requireCompletedOnboarding, asyncHandler(searchUsers));
router.get('/discover', requireAuth, requireCompletedOnboarding, asyncHandler(discoverUsers));

// Public profile and social graph. These routes intentionally come after the
// explicit /me routes so "me" can never be mistaken for a username.
router.get('/:username/profile', asyncHandler(optionalAuth), asyncHandler(getPublicProfile));
router.get('/:username/share', asyncHandler(optionalAuth), asyncHandler(getProfileShareLink));
router.get('/:username/quests', asyncHandler(optionalAuth), asyncHandler(listQuestHistory));
router.get('/:username/followers', asyncHandler(optionalAuth), asyncHandler(listFollowers));
router.get('/:username/following', asyncHandler(optionalAuth), asyncHandler(listFollowing));
router.post('/:username/follow', requireAuth, requireCompletedOnboarding, asyncHandler(followUser));
router.delete('/:username/follow', requireAuth, requireCompletedOnboarding, asyncHandler(unfollowUser));
router.post('/:username/block', requireAuth, requireCompletedOnboarding, asyncHandler(blockUser));
router.delete('/:username/block', requireAuth, requireCompletedOnboarding, asyncHandler(unblockUser));

module.exports = router;
