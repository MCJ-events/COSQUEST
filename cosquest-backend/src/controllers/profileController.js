const userModel = require('../models/userModel');
const { isValidAvatarKey } = require('../models/avatarModel');
const { storeAvatarPhoto } = require('../utils/imageHost');
const { isValidUsername, normalizeUsername } = require('../utils/validation');

// GET /api/users/me
function getMe(req, res) {
  return res.json({ user: userModel.sanitize(req.user) });
}

// PATCH /api/users/me/profile  (onboarding step 1)
async function updateProfile(req, res) {
  const { firstName, lastName, username, age, gender } = req.body;

  if (username !== undefined) {
    if (!isValidUsername(username)) {
      return res
        .status(400)
        .json({ error: 'username must be 3-20 characters: letters, numbers, underscore only.' });
    }
    if (await userModel.isUsernameTaken(username, req.userId)) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }
  }

  if (age !== undefined && age !== null && age !== '') {
    const n = Number(age);
    if (!Number.isInteger(n) || n < 13 || n > 120) {
      return res.status(400).json({ error: 'age must be a whole number between 13 and 120.' });
    }
  }

  const updated = await userModel.updateUser(req.userId, (user) => {
    if (firstName !== undefined) user.profile.firstName = String(firstName).trim();
    if (lastName !== undefined) user.profile.lastName = String(lastName).trim();
    if (username !== undefined) {
      user.profile.username = String(username).trim();
      user.profile.usernameNormalized = normalizeUsername(username);
    }
    if (age !== undefined) user.profile.age = age === '' || age === null ? null : Number(age);
    if (gender !== undefined) user.profile.gender = String(gender).trim();
  });

  return res.json({ user: userModel.sanitize(updated) });
}

// GET /api/users/check-username?username=xyz
async function checkUsername(req, res) {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'username query param is required.' });
  const taken = await userModel.isUsernameTaken(username, req.userId);
  return res.json({ username, available: !taken });
}

// PATCH /api/users/me/avatar
async function setAvatar(req, res) {
  const { avatar } = req.body;
  if (!isValidAvatarKey(avatar)) {
    return res.status(400).json({ error: 'Not a recognized avatar option. See GET /api/meta/avatars.' });
  }
  const updated = await userModel.updateUser(req.userId, (user) => {
    user.profile.avatarKey = avatar;
    user.profile.avatarPhotoUrl = null; // picking a preset avatar clears any uploaded photo (mirrors the front-end's pickAv())
    user.onboarding.avatarChosen = true;
  });
  return res.json({ user: userModel.sanitize(updated) });
}

// POST /api/users/me/avatar/photo  (multipart/form-data, field name "photo")
async function uploadAvatarPhoto(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No photo uploaded. Send multipart/form-data with a "photo" field.' });
  }
  try {
    const url = await storeAvatarPhoto(req.file);
    const updated = await userModel.updateUser(req.userId, (user) => {
      user.profile.avatarPhotoUrl = url;
      user.onboarding.avatarChosen = true;
    });
    return res.json({ user: userModel.sanitize(updated) });
  } catch (err) {
    return res.status(500).json({ error: `Photo upload failed: ${err.message}` });
  }
}

module.exports = { getMe, updateProfile, checkUsername, setAvatar, uploadAvatarPhoto };
