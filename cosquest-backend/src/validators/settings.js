// Request rules for src/routes/settingsRoutes.js (see src/middleware/validate.js).
// Messages match the controller's own, so the app sees the same answers.
const { string, boolean, oneOfValues, field, body, isPlainObject } = require('../middleware/validate');

// PATCH /api/users/me/account - the controller checks the username's format
// and whether it's taken, the phone format, the real date and age, and the
// current password when the login email changes. The email's length cap is
// new (any length used to be saved as the login email), and a username sent
// as a list used to crash the request (500).
const updateAccount = [
  string('displayName', { min: 1, max: 80, trim: true, message: 'displayName must contain 1-80 characters.' }),
  string('username', { max: 50, message: 'username must contain 3-20 letters, numbers, or underscores.' }),
  field('phone').isString().withMessage('phone must be text.').bail()
    .custom((v) => v.length <= 50).withMessage('phone must include the country code, e.g. +15552345678, or be empty.'),
  string('dateOfBirth', { max: 10, message: 'dateOfBirth must be a valid YYYY-MM-DD date.' }),
  string('email', { max: 254, message: 'Provide a valid email.' }),
];

// PATCH /api/users/me/password - the controller checks strength, the match
// and the current password.
const changePassword = [
  string('newPassword', { required: true, message: 'password must be at least 8 characters long.' }),
];

// PATCH /api/users/me/appearance and /data-usage: only these fields, each
// checked like the controller does.
function section(fields) {
  const names = Object.keys(fields);
  return [
    body().custom((v) => isPlainObject(v) && Object.keys(v).length > 0 && Object.keys(v).every((key) => names.includes(key)))
      .withMessage(`Provide supported fields: ${names.join(', ')}.`).bail(),
    ...names.map((name) => fields[name](name, { message: `Invalid ${name}.` })),
  ];
}
const oneOf = (values) => (name, opts) => oneOfValues(name, values, opts);
const updateAppearance = section({
  themeMode: oneOf(['light', 'dark', 'system']),
  accentColor: (name, opts) => field(name).custom((v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)).withMessage(opts.message),
  fontSize: oneOf(['small', 'medium', 'large']),
  reduceMotion: boolean,
});
const updateDataUsage = section({
  downloadOverWifiOnly: boolean,
  autoPlayVideos: boolean,
  imageQuality: oneOf(['low', 'medium', 'high', 'auto']),
});

// POST /api/users/me/support-requests - one message for any problem, as before.
const badSupportRequest = 'Provide type (support or bug), subject (1-150 characters), message (1-5000), and optional appVersion/platform.';
const textOfLength = (name, max) => field(name, { required: true }).withMessage(badSupportRequest).bail()
  .custom((v) => typeof v === 'string' && v.trim().length > 0 && v.length <= max).withMessage(badSupportRequest);
const createSupportRequest = [
  oneOfValues('type', ['support', 'bug'], { required: true, message: badSupportRequest }),
  textOfLength('subject', 150),
  textOfLength('message', 5000),
  string('appVersion', { max: 50, message: badSupportRequest }),
  oneOfValues('platform', ['ios', 'android', 'web', 'unknown'], { message: badSupportRequest }),
];

module.exports = { updateAccount, changePassword, updateAppearance, updateDataUsage, createSupportRequest };
