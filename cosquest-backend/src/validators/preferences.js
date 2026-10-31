// Request rules for src/routes/preferencesRoutes.js (see src/middleware/validate.js).
// Messages match the controller's own, so the app sees the same answers.
const { string, boolean, number, array, object, field, body } = require('../middleware/validate');
const common = require('./common');

const NOTIFICATION_SWITCHES = ['notificationsEnabled', 'eventReminders', 'emailWeeklyNewsletter', 'questUpdates', 'factionNews', 'friendActivity', 'rankChanges', 'emailPromotionalEvents'];

// PATCH /api/users/me/preferences/notifications - any of the switches, each
// true/false (the controller asks for at least one).
const notifications = NOTIFICATION_SWITCHES.map((key) => boolean(key, { message: `${key} must be a boolean.` }));

// The location fields; onboarding sends the same ones inside `location`.
function locationRules(prefix = '') {
  return [
    boolean(`${prefix}locationEnabled`, { required: !prefix, message: `${prefix}locationEnabled (boolean) is required.` }),
    number(`${prefix}lat`, { min: -90, max: 90, nullable: true, message: `${prefix}lat is required when locationEnabled is true, and must be a number between -90 and 90.` }),
    number(`${prefix}lng`, { min: -180, max: 180, nullable: true, message: `${prefix}lng is required when locationEnabled is true, and must be a number between -180 and 180.` }),
    field(`${prefix}radiusMiles`).custom((v) => Number.isFinite(Number(v)) && Number(v) >= 5 && Number(v) <= 100)
      .withMessage(`${prefix}radiusMiles must be between 5 and 100.`),
  ];
}

// PATCH /api/users/me/preferences/location
const location = locationRules();

// POST /api/users/me/devices { pushToken, platform }
const missingDevice = 'pushToken and platform ("ios" | "android" | "web") are required.';
const shortStrings = 'pushToken and platform must be short strings.';
const registerDevice = [
  body('pushToken').custom(Boolean).withMessage(missingDevice),
  body('platform').custom(Boolean).withMessage(missingDevice),
  string('pushToken', { max: 300, message: shortStrings }),
  string('platform', { max: 20, message: shortStrings }),
];

// DELETE /api/users/me/devices { pushToken }, or /api/users/me/devices/:pushToken
const unregisterDevice = [string('pushToken', { required: true, min: 1, max: 300, message: 'pushToken is required.' })];
const unregisterDeviceByPath = [string('pushToken', { in: 'param', required: true, min: 1, max: 300, message: 'pushToken is required.' })];

// POST /api/users/me/onboarding/complete - the shapes. The controller checks the
// values (a taken username, real faction and interest keys, the required steps).
const completeOnboarding = [
  object('profile'),
  ...common.profileFields('profile.'),
  string('faction', { max: 50, message: 'faction must be one of the values from GET /api/factions.' }),
  array('interests', { max: 50, of: 'string', message: 'interests must be an array of interest keys.' }),
  object('preferences'),
  boolean('preferences.notificationsEnabled', { message: 'preferences.notificationsEnabled must be a boolean.' }),
  object('location'),
  ...locationRules('location.'),
];

module.exports = { notifications, location, registerDevice, unregisterDevice, unregisterDeviceByPath, completeOnboarding, locationRules };
