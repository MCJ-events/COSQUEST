// Request rules for src/routes/authRoutes.js (see src/middleware/validate.js).
// Messages match the controllers' own, and never say more than they did: a
// lookup that can't match any account answers exactly like an unknown account,
// so nothing here tells anyone whether an account exists.
const { string, body, fail } = require('../middleware/validate');

// Longest email address there is (RFC 5321); usernames are 3-20 characters.
const MAX_IDENTIFIER = 254;
const IDENTIFIERS = ['identifier', 'email', 'username'];

// The controllers read `identifier || email || username`, so an empty value
// still falls through to the next one (or to their own "required" answer).
// Anything else that's set must be text.
const textIfSet = (name, message) => body(name).custom((v) => !v || typeof v === 'string').withMessage(message);
const shortTextIfSet = (name, max, typeMessage, lengthMessage) => textIfSet(name, typeMessage).bail()
  .custom((v) => !v || v.length <= max).withMessage(lengthMessage);
const identifierRules = (typeMessage, lengthMessage) => IDENTIFIERS.map((name) => (
  lengthMessage ? shortTextIfSet(name, MAX_IDENTIFIER, typeMessage, lengthMessage) : textIfSet(name, typeMessage)
));

// POST /api/auth/signup { identifier | email | username, password, confirmPassword }
// The length cap is new: an email address of any length used to be stored.
const invalidIdentifier = 'Provide a valid email address or a username with 3-20 letters, numbers, or underscores.';
const signup = [
  ...identifierRules(invalidIdentifier, invalidIdentifier),
  textIfSet('password', 'password must be at least 8 characters long.'),
];

// POST /api/auth/login { identifier | email | username, password }
// A password that isn't text used to crash the password check (500); an
// identifier too long to be anyone's gets the same 401 as an unknown account.
const loginRequired = 'email or username, and password, are required.';
const badLogin = fail(401, 'Invalid email or password.');
const login = [
  ...identifierRules(loginRequired, badLogin),
  textIfSet('password', badLogin),
];

// POST /api/auth/forgot-password { identifier | email | username }
// Always the same 200 for any text, so no length cap here.
const forgotPassword = identifierRules('email or username is required.');

// POST /api/auth/reset-password { identifier | email | username, code, newPassword, confirmPassword }
const resetRequired = 'identifier, code, newPassword, and confirmPassword are required.';
const badCode = 'That code is invalid or has expired.';
const resetPassword = [
  ...identifierRules(resetRequired, badCode),
  shortTextIfSet('code', 100, resetRequired, badCode),
  textIfSet('newPassword', 'password must be at least 8 characters long.'),
];

// POST /api/auth/oauth/exchange { oauthCode } - the one-time code from the
// redirect (43 characters).
const oauthExchange = [
  string('oauthCode', { required: true, min: 1, max: 200, message: 'This OAuth code is invalid or has expired. Please sign in again.' }),
];

module.exports = { signup, login, forgotPassword, resetPassword, oauthExchange };
