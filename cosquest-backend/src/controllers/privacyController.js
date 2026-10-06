const userModel = require('../models/userModel');

const VISIBILITY_VALUES = ['public', 'friends', 'private'];
const BOOLEAN_FIELDS = [
  'showActivityFeed',
  'allowDirectMessages',
  'showOnlineStatus',
  'allowFriendRequests',
  'readReceipts',
];

// GET /api/users/me/privacy
function getPrivacy(req, res) {
  return res.json({ privacy: req.user.privacy });
}

// PATCH /api/users/me/privacy - Settings > Privacy & Visibility screen.
async function updatePrivacy(req, res) {
  const { profileVisibility } = req.body;

  for (const key of BOOLEAN_FIELDS) {
    if (req.body[key] !== undefined && typeof req.body[key] !== 'boolean') {
      return res.status(400).json({ error: `${key} must be a boolean.` });
    }
  }

  if (profileVisibility !== undefined && !VISIBILITY_VALUES.includes(profileVisibility)) {
    return res.status(400).json({ error: `profileVisibility must be one of: ${VISIBILITY_VALUES.join(', ')}.` });
  }

  const updated = await userModel.updateUser(req.userId, (user) => {
    if (profileVisibility !== undefined) user.privacy.profileVisibility = profileVisibility;
    for (const key of BOOLEAN_FIELDS) {
      if (req.body[key] !== undefined) user.privacy[key] = req.body[key];
    }
  });
  return res.json({ privacy: updated.privacy });
}

module.exports = { getPrivacy, updatePrivacy };
