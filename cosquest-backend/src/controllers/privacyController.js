const userModel = require('../models/userModel');

const VISIBILITY_VALUES = ['public', 'friends', 'private'];

// GET /api/users/me/privacy
function getPrivacy(req, res) {
  return res.json({ privacy: req.user.privacy });
}

// PATCH /api/users/me/privacy - Settings > Privacy & Visibility screen.
async function updatePrivacy(req, res) {
  const { profileVisibility, showActivityFeed, allowDirectMessages } = req.body;

  if (profileVisibility !== undefined && !VISIBILITY_VALUES.includes(profileVisibility)) {
    return res.status(400).json({ error: `profileVisibility must be one of: ${VISIBILITY_VALUES.join(', ')}.` });
  }
  if (showActivityFeed !== undefined && typeof showActivityFeed !== 'boolean') {
    return res.status(400).json({ error: 'showActivityFeed must be a boolean.' });
  }
  if (allowDirectMessages !== undefined && typeof allowDirectMessages !== 'boolean') {
    return res.status(400).json({ error: 'allowDirectMessages must be a boolean.' });
  }

  const updated = await userModel.updateUser(req.userId, (user) => {
    if (profileVisibility !== undefined) user.privacy.profileVisibility = profileVisibility;
    if (showActivityFeed !== undefined) user.privacy.showActivityFeed = showActivityFeed;
    if (allowDirectMessages !== undefined) user.privacy.allowDirectMessages = allowDirectMessages;
  });
  return res.json({ privacy: updated.privacy });
}

module.exports = { getPrivacy, updatePrivacy };
