const express = require('express');
const { AVATARS } = require('../models/avatarModel');
const CLOUDINARY_AVATAR_PUBLIC_IDS = require('../data/cloudinaryAvatarPublicIds');
const { cloudinaryImageUrl } = require('../utils/cloudinary');
const { PROFILE_CATEGORIES } = require('../models/profileCategoryModel');

const router = express.Router();

// GET /api/meta/avatars (public) - the avatar picker options for onboarding step 1
router.get('/avatars', (req, res) => {
  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    return res.status(503).json({ error: 'Cloudinary is not configured for preset avatars.' });
  }
  if (CLOUDINARY_AVATAR_PUBLIC_IDS.length !== AVATARS.length) {
    return res.status(500).json({ error: 'The Cloudinary avatar mapping is incomplete.' });
  }
  const avatars = AVATARS.map(({ key, label, file }, index) => ({
    key,
    label,
    imageUrl: cloudinaryImageUrl(CLOUDINARY_AVATAR_PUBLIC_IDS[index]),
  }));
  return res.json({ avatars });
});

// GET /api/meta/profile-categories (public) - the searchable category picker.
router.get('/profile-categories', (req, res) => res.json({ categories: PROFILE_CATEGORIES }));

module.exports = router;
