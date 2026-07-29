const express = require('express');
const { identifyUser } = require('../middleware/identifyUser');
const { upload } = require('../middleware/upload');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  getMe,
  updateProfile,
  checkUsername,
  setAvatar,
  uploadAvatarPhoto,
} = require('../controllers/profileController');

const router = express.Router();

// email (before login/onboarding) or Bearer token (after login) - see identifyUser
router.get('/me', asyncHandler(identifyUser), getMe);
router.patch('/me/profile', asyncHandler(identifyUser), asyncHandler(updateProfile));
router.get('/check-username', asyncHandler(identifyUser), asyncHandler(checkUsername));
router.patch('/me/avatar', asyncHandler(identifyUser), asyncHandler(setAvatar));
// multer has to parse the multipart body first, so req.body.email exists by the time identifyUser runs
router.post('/me/avatar/photo', upload.single('photo'), asyncHandler(identifyUser), asyncHandler(uploadAvatarPhoto));

module.exports = router;
