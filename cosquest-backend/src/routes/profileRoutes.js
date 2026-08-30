const express = require('express');
const { identifyUser } = require('../middleware/identifyUser');
const { upload } = require('../middleware/upload');
const { requireAuth, requireCompletedOnboarding } = require('../middleware/auth');
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
} = require('../controllers/publicProfileController');

const router = express.Router();

// email (before login/onboarding) or Bearer token (after login) - see identifyUser
router.get('/me', asyncHandler(identifyUser), getMe);
router.patch('/me/profile', asyncHandler(identifyUser), asyncHandler(updateProfile));
router.get('/check-username', asyncHandler(identifyUser), asyncHandler(checkUsername));
router.patch('/me/avatar', asyncHandler(identifyUser), asyncHandler(setAvatar));
// multer has to parse the multipart body first, so req.body.email exists by the time identifyUser runs
router.post('/me/avatar/photo', upload.single('photo'), asyncHandler(identifyUser), asyncHandler(uploadAvatarPhoto));
router.get('/me/points', requireAuth, requireCompletedOnboarding, getMyPoints);
router.get('/me/contact', requireAuth, requireCompletedOnboarding, getContact);
router.patch('/me/contact', requireAuth, requireCompletedOnboarding, asyncHandler(updateContact));

// Public profile and social graph. These routes intentionally come after the
// explicit /me routes so "me" can never be mistaken for a username.
router.get('/:username/profile', asyncHandler(getPublicProfile));
router.get('/:username/quests', asyncHandler(listQuestHistory));
router.get('/:username/followers', asyncHandler(listFollowers));
router.get('/:username/following', asyncHandler(listFollowing));
router.post('/:username/follow', requireAuth, requireCompletedOnboarding, asyncHandler(followUser));
router.delete('/:username/follow', requireAuth, requireCompletedOnboarding, asyncHandler(unfollowUser));

module.exports = router;
