// Request rules for src/routes/profileRoutes.js (see src/middleware/validate.js).
// Messages match the controllers' own, so the app sees the same answers.
const { string, boolean, oneOfValues, field, param, query, scalarQuery, fail } = require('../middleware/validate');
const { isValidProfileCategory } = require('../models/profileCategoryModel');
const common = require('./common');

// Longest email address there is (RFC 5321).
const MAX_EMAIL = 254;

// /api/users/:username/... - a name no account could have reads like any
// missing profile. Usernames are 3-20 characters; 100 leaves room for any
// older one.
const usernameParam = [
  param('username').custom((v) => typeof v === 'string' && v.length <= 100).withMessage(fail(404, 'Profile not found.')),
];

// PATCH /api/users/me/profile - the controller checks the username's format
// and whether it's taken, the age range and the category key. The name and
// gender rules are new: anything sent used to be stored as text, at any length.
const updateProfile = [
  string('firstName', { max: 50 }),
  string('lastName', { max: 50 }),
  string('username', { max: 20, message: 'username must be 3-20 characters: letters, numbers, underscore only.' }),
  field('age', { nullable: true })
    .custom((v) => v === '' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 10))
    .withMessage('age must be a whole number between 13 and 120.'),
  string('gender', { max: 50 }),
  string('bio', { max: 500, trim: true, message: 'bio must be text with at most 500 characters.' }),
  field('category', { nullable: true }).custom((v) => v === '' || isValidProfileCategory(v))
    .withMessage('category must be one of the values from GET /api/meta/profile-categories.'),
  boolean('showCategoryOnProfile', { message: 'showCategoryOnProfile must be a boolean.' }),
];

// PATCH /api/users/me/contact - the controller checks the email and phone
// formats; the email's length cap is new.
const updateContact = [
  string('email', { max: MAX_EMAIL, message: 'contact email must be a valid email address.' }),
  string('phone', { max: 50, message: 'phone must use international format, for example +2348148327836.' }),
  string('businessAddress', { max: 250, trim: true, message: 'businessAddress must be text with at most 250 characters.' }),
];

// GET /api/users/check-username?username=
const checkUsername = [
  query('username').custom((v) => typeof v === 'string' && v.length > 0).withMessage('username query param is required.').bail()
    .custom((v) => v.length <= 50).withMessage('username is too long.'),
];

// PATCH /api/users/me/avatar { avatar } - the controller checks it's a real option.
const setAvatar = [
  string('avatar', { required: true, max: 100, message: 'Not a recognized avatar option. See GET /api/meta/avatars.' }),
];

// PATCH /api/users/me/privacy
const PRIVACY_SWITCHES = ['showActivityFeed', 'allowDirectMessages', 'showOnlineStatus', 'allowFriendRequests', 'readReceipts'];
const updatePrivacy = [
  ...PRIVACY_SWITCHES.map((key) => boolean(key, { message: `${key} must be a boolean.` })),
  oneOfValues('profileVisibility', ['public', 'friends', 'private']),
];

// GET /api/users/search?search= (the controller asks for a non-empty term).
const searchUsers = [
  query('search').optional().isString().withMessage('search is required.'),
  ...scalarQuery('page', 'limit'),
];

// GET /api/users/:username/quests?status=
const REGISTRATION_STATUSES = ['registered', 'cancelled', 'completed', 'winner'];
const listQuestHistory = [
  ...usernameParam,
  query('status').custom((v) => !v || REGISTRATION_STATUSES.includes(v))
    .withMessage(`status must be one of: ${REGISTRATION_STATUSES.join(', ')}.`),
  ...common.paging(),
];

const paged = common.paging();
const pagedProfileList = [...usernameParam, ...common.paging()];

module.exports = {
  usernameParam, updateProfile, updateContact, checkUsername, setAvatar, updatePrivacy,
  searchUsers, listQuestHistory, paged, pagedProfileList,
};
