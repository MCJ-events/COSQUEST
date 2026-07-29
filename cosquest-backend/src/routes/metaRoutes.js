const express = require('express');
const { AVATARS } = require('../models/avatarModel');

const router = express.Router();

// GET /api/meta/avatars (public) - the avatar picker options for onboarding step 1
router.get('/avatars', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const avatars = AVATARS.map(({ key, label, file }) => ({
    key,
    label,
    imageUrl: `${base}/avatars/${file}`,
  }));
  return res.json({ avatars });
});

module.exports = router;
