const userModel = require('../models/userModel');
const { isValidFactionKey } = require('../models/factionModel');
const { isValidInterestKey } = require('../models/interestModel');
const { isValidAvatarKey } = require('../models/avatarModel');

/**
 * Onboarding step 4 ("Find quests near you"). The front-end has two fake
 * toggles (location, notifications) plus a radius slider. For real:
 *  - the BROWSER/OS owns the actual permission prompt (navigator.geolocation,
 *    Notification.requestPermission()) - the backend never triggers that UI.
 *  - the backend's only job is to store what the client tells it *after* the
 *    real permission was granted: the resulting coordinates, a push token,
 *    and the user's chosen radius/opt-in flags.
 * See README "Step 4 walkthrough" for the full request/response sequence.
 */

// PATCH /api/users/me/preferences/location
async function updateLocationPrefs(req, res) {
  const { locationEnabled, radiusMiles, lat, lng } = req.body;

  if (radiusMiles !== undefined) {
    const n = Number(radiusMiles);
    if (!Number.isFinite(n) || n < 5 || n > 100) {
      return res.status(400).json({ error: 'radiusMiles must be a number between 5 and 100.' });
    }
  }
  if (lat !== undefined && (lat < -90 || lat > 90)) {
    return res.status(400).json({ error: 'lat must be between -90 and 90.' });
  }
  if (lng !== undefined && (lng < -180 || lng > 180)) {
    return res.status(400).json({ error: 'lng must be between -180 and 180.' });
  }

  const updated = await userModel.updateUser(req.userId, (user) => {
    if (locationEnabled !== undefined) user.preferences.locationEnabled = Boolean(locationEnabled);
    if (radiusMiles !== undefined) user.preferences.radiusMiles = Number(radiusMiles);
    if (lat !== undefined) user.preferences.lastKnownLocation.lat = Number(lat);
    if (lng !== undefined) user.preferences.lastKnownLocation.lng = Number(lng);
  });

  return res.json({ user: userModel.sanitize(updated) });
}

// PATCH /api/users/me/preferences/notifications
async function updateNotificationPrefs(req, res) {
  const { notificationsEnabled } = req.body;
  if (notificationsEnabled === undefined) {
    return res.status(400).json({ error: 'notificationsEnabled (boolean) is required.' });
  }
  const updated = await userModel.updateUser(req.userId, (user) => {
    user.preferences.notificationsEnabled = Boolean(notificationsEnabled);
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
 * Every section is optional (an empty body just marks onboardingComplete
 * true), so this also still supports doing steps individually beforehand
 * via the other step 1-4 endpoints and calling this last, bodyless, to finish.
 */
async function completeOnboarding(req, res) {
  const { profile, faction, interests, preferences } = req.body;
  const errors = [];

  if (profile?.username !== undefined) {
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(profile.username)) {
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
    errors.push('faction must be one of the values from GET /api/factions, or "none".');
  }
  if (interests !== undefined) {
    if (!Array.isArray(interests)) {
      errors.push('interests must be an array of interest keys.');
    } else {
      const invalid = interests.filter((k) => !isValidInterestKey(k));
      if (invalid.length) errors.push(`Unknown interest key(s): ${invalid.join(', ')}`);
    }
  }
  if (preferences?.radiusMiles !== undefined) {
    const n = Number(preferences.radiusMiles);
    if (!Number.isFinite(n) || n < 5 || n > 100) {
      errors.push('preferences.radiusMiles must be a number between 5 and 100.');
    }
  }
  if (preferences?.lat !== undefined && (preferences.lat < -90 || preferences.lat > 90)) {
    errors.push('preferences.lat must be between -90 and 90.');
  }
  if (preferences?.lng !== undefined && (preferences.lng < -180 || preferences.lng > 180)) {
    errors.push('preferences.lng must be between -180 and 180.');
  }

  if (errors.length) {
    return res.status(400).json({ error: errors.join(' '), errors });
  }

  const updated = await userModel.updateUser(req.userId, (user) => {
    if (profile) {
      if (profile.firstName !== undefined) user.profile.firstName = String(profile.firstName).trim();
      if (profile.lastName !== undefined) user.profile.lastName = String(profile.lastName).trim();
      if (profile.username !== undefined) user.profile.username = String(profile.username).trim();
      if (profile.age !== undefined) user.profile.age = profile.age === '' || profile.age === null ? null : Number(profile.age);
      if (profile.gender !== undefined) user.profile.gender = String(profile.gender).trim();
      if (profile.avatar !== undefined) {
        user.profile.avatarKey = profile.avatar;
        user.profile.avatarPhotoUrl = null; // matches pickAv()'s behavior in the front-end
      }
    }
    if (faction !== undefined) user.faction = faction;
    if (interests !== undefined) user.interests = [...new Set(interests)];
    if (preferences) {
      if (preferences.locationEnabled !== undefined) user.preferences.locationEnabled = Boolean(preferences.locationEnabled);
      if (preferences.radiusMiles !== undefined) user.preferences.radiusMiles = Number(preferences.radiusMiles);
      if (preferences.lat !== undefined) user.preferences.lastKnownLocation.lat = Number(preferences.lat);
      if (preferences.lng !== undefined) user.preferences.lastKnownLocation.lng = Number(preferences.lng);
      if (preferences.notificationsEnabled !== undefined) user.preferences.notificationsEnabled = Boolean(preferences.notificationsEnabled);
    }
    user.onboardingComplete = true;
  });

  return res.json({ message: 'Onboarding complete.', user: userModel.sanitize(updated) });
}

module.exports = { updateLocationPrefs, updateNotificationPrefs, registerDevice, completeOnboarding };
