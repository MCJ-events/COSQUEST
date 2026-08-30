const userModel = require('../models/userModel');
const { isValidFactionKey } = require('../models/factionModel');
const { isValidInterestKey } = require('../models/interestModel');
const { isValidAvatarKey } = require('../models/avatarModel');
const { isValidUsername, normalizeUsername } = require('../utils/validation');

// PATCH /api/users/me/preferences/notifications
async function updateNotificationPrefs(req, res) {
  const { notificationsEnabled } = req.body;
  if (notificationsEnabled === undefined) {
    return res.status(400).json({ error: 'notificationsEnabled (boolean) is required.' });
  }
  if (typeof notificationsEnabled !== 'boolean') {
    return res.status(400).json({ error: 'notificationsEnabled must be a boolean.' });
  }
  const updated = await userModel.updateUser(req.userId, (user) => {
    user.preferences.notificationsEnabled = Boolean(notificationsEnabled);
    user.onboarding.notificationPreferenceChosen = true;
  });
  return res.json({ user: userModel.sanitize(updated) });
}

// POST /api/users/me/devices  (register a push token, only meaningful once notificationsEnabled is true)
async function registerDevice(req, res) {
  const { pushToken, platform } = req.body;
  if (!pushToken || !platform) {
    return res.status(400).json({ error: 'pushToken and platform ("ios" | "android" | "web") are required.' });
  }
  const updated = await userModel.updateUser(req.userId, (user) => {
    const exists = user.devices.some((d) => d.pushToken === pushToken);
    if (!exists) {
      user.devices.push({ pushToken, platform, registeredAt: new Date() });
    }
  });
  return res.json({ user: userModel.sanitize(updated) });
}

/**
 * POST /api/users/me/onboarding/complete
 *
 * Mirrors the front-end's finishOnb() exactly: nothing gets saved to a
 * server while the user clicks through onboarding steps 1-4 - everything
 * (profile, faction, interests, preferences) sits in the client's local
 * `state` object and is only submitted once, all together, at the moment
 * the user taps "Enter CosQuest." This endpoint accepts that same combined
 * payload in one call and applies it atomically: every field is validated
 * first, and if anything is invalid, NOTHING is saved and onboardingComplete
 * stays false - there's no partial-onboarding state left behind.
 *
 * Clients may submit every step at once or save each step independently.
 * Either way, completion is allowed only after every required choice exists.
 */
async function completeOnboarding(req, res) {
  const { profile, faction, interests, preferences } = req.body;
  const errors = [];

  if (profile?.username !== undefined) {
    if (!isValidUsername(profile.username)) {
      errors.push('profile.username must be 3-20 characters: letters, numbers, underscore only.');
    } else if (await userModel.isUsernameTaken(profile.username, req.userId)) {
      errors.push('That username is already taken.');
    }
  }
  if (profile?.age !== undefined && profile.age !== null && profile.age !== '') {
    const n = Number(profile.age);
    if (!Number.isInteger(n) || n < 13 || n > 120) {
      errors.push('profile.age must be a whole number between 13 and 120.');
    }
  }
  if (profile?.avatar !== undefined && !isValidAvatarKey(profile.avatar)) {
    errors.push('profile.avatar is not a recognized avatar option. See GET /api/meta/avatars.');
  }
  if (faction !== undefined && !isValidFactionKey(faction)) {
    errors.push('faction must be one of the values from GET /api/factions.');
  }
  if (interests !== undefined) {
    if (!Array.isArray(interests)) {
      errors.push('interests must be an array of interest keys.');
    } else {
      const invalid = interests.filter((k) => !isValidInterestKey(k));
      if (invalid.length) errors.push(`Unknown interest key(s): ${invalid.join(', ')}`);
    }
  }
  if (preferences?.notificationsEnabled !== undefined && typeof preferences.notificationsEnabled !== 'boolean') {
    errors.push('preferences.notificationsEnabled must be a boolean.');
  }

  const nextProfile = {
    firstName: profile?.firstName !== undefined ? String(profile.firstName).trim() : req.user.profile.firstName,
    lastName: profile?.lastName !== undefined ? String(profile.lastName).trim() : req.user.profile.lastName,
    username: profile?.username !== undefined ? String(profile.username).trim() : req.user.profile.username,
    age: profile?.age !== undefined ? profile.age : req.user.profile.age,
    gender: profile?.gender !== undefined ? String(profile.gender).trim() : req.user.profile.gender,
  };
  const nextFaction = faction !== undefined ? faction : req.user.faction;
  const nextInterests = interests !== undefined ? interests : req.user.interests;
  const avatarChosen = req.user.onboarding?.avatarChosen || profile?.avatar !== undefined;
  const notificationPreferenceChosen =
    req.user.onboarding?.notificationPreferenceChosen || preferences?.notificationsEnabled !== undefined;

  if (!nextProfile.firstName) errors.push('profile.firstName is required.');
  if (!nextProfile.lastName) errors.push('profile.lastName is required.');
  if (!isValidUsername(nextProfile.username)) {
    errors.push('profile.username is required and must be 3-20 characters: letters, numbers, underscore only.');
  }
  const nextAge = Number(nextProfile.age);
  if (!Number.isInteger(nextAge) || nextAge < 13 || nextAge > 120) {
    errors.push('profile.age is required and must be a whole number between 13 and 120.');
  }
  if (!nextProfile.gender) errors.push('profile.gender is required.');
  if (!avatarChosen) errors.push('Choose an avatar or upload a profile photo before completing onboarding.');
  if (!nextFaction || !isValidFactionKey(nextFaction)) errors.push('Choose a faction before completing onboarding.');
  if (!Array.isArray(nextInterests) || nextInterests.length === 0) {
    errors.push('Choose at least one interest before completing onboarding.');
  }
  if (!notificationPreferenceChosen) errors.push('Choose whether to enable notifications before completing onboarding.');

  if (errors.length) {
    return res.status(400).json({ error: errors.join(' '), errors });
  }

  const updated = await userModel.updateUser(req.userId, (user) => {
    if (profile) {
      if (profile.firstName !== undefined) user.profile.firstName = String(profile.firstName).trim();
      if (profile.lastName !== undefined) user.profile.lastName = String(profile.lastName).trim();
      if (profile.username !== undefined) user.profile.username = String(profile.username).trim();
      if (profile.username !== undefined) user.profile.usernameNormalized = normalizeUsername(profile.username);
      if (profile.age !== undefined) user.profile.age = profile.age === '' || profile.age === null ? null : Number(profile.age);
      if (profile.gender !== undefined) user.profile.gender = String(profile.gender).trim();
      if (profile.avatar !== undefined) {
        user.profile.avatarKey = profile.avatar;
        user.profile.avatarPhotoUrl = null; // matches pickAv()'s behavior in the front-end
        user.onboarding.avatarChosen = true;
      }
    }
    if (faction !== undefined) user.faction = faction;
    if (interests !== undefined) user.interests = [...new Set(interests)];
    if (preferences) {
      if (preferences.notificationsEnabled !== undefined) user.preferences.notificationsEnabled = Boolean(preferences.notificationsEnabled);
      if (preferences.notificationsEnabled !== undefined) user.onboarding.notificationPreferenceChosen = true;
    }
    user.onboardingComplete = true;
  });

  return res.json({ message: 'Onboarding complete.', user: userModel.sanitize(updated) });
}

module.exports = { updateNotificationPrefs, registerDevice, completeOnboarding };
