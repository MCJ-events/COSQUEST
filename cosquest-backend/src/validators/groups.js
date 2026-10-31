// Request rules for src/routes/groupRoutes.js (see src/middleware/validate.js).
// Messages match the controller's own, so the app sees the same answers.
// Create and edit arrive as multipart forms too (with a `photo`), where every
// field is text: numbers and lists may come as strings.
const { string, oneOfValues, field, fail } = require('../middleware/validate');
const common = require('./common');

const KINDS = ['faction', 'open', 'private'];
const JOIN_MODES = ['instant', 'approval'];
const VISIBILITY = ['members', 'admins'];
const SLOW_MODE_VALUES = [0, 10, 30, 60, 300, 3600];
const MAX_PEOPLE = 50;

const groupId = common.pathId('groupId', 'Group not found.');
const userId = common.pathId('userId', 'Person not found.');
const nameMessage = 'Give the group a name (up to 80 characters).';
const descriptionMessage = 'The description can be up to 500 characters.';

// People to add: a list of ids/usernames, or (multipart) a JSON list or a
// comma list as text. Unknown ids/usernames still come back in `skipped`.
const tooMany = `You can add up to ${MAX_PEOPLE} people at a time.`;
const people = (name) => field(name, { nullable: true })
  .custom((v) => typeof v === 'string' || (Array.isArray(v) && v.every((item) => typeof item === 'string' && item.length <= 100)))
  .withMessage(`${name} must be a list of user ids or usernames.`).bail()
  .custom((v) => (Array.isArray(v) ? v.length <= MAX_PEOPLE : v.length <= 5000)).withMessage(tooMany);

// The introduction when asking to join (the controller keeps the first 200
// characters) and a ban reason (same): text, with a cap on what is sent.
const shortNote = (name) => string(name, { nullable: true, max: 1000, message: `${name} must be text of at most 1000 characters.` });

// POST /api/groups (multipart: optional `photo`). joinMode, sizeLimit,
// memberListVisibility and whoCanAdd fall back to defaults in the controller.
const createGroup = [
  string('name', { required: true, trim: true, min: 1, max: 80, message: nameMessage }),
  string('description', { nullable: true, trim: true, max: 500, message: descriptionMessage }),
  oneOfValues('kind', KINDS, { required: true, message: 'kind must be faction, open or private.' }),
  string('factionKey', { nullable: true, max: 50, message: 'Choose a valid faction.' }),
  people('members'),
  people('memberUsernames'),
];

// PATCH /api/groups/:groupId (multipart: optional `photo`). The size limit's
// range depends on the member count (the controller checks it).
const updateGroup = [
  groupId,
  string('name', { trim: true, min: 1, max: 80, message: nameMessage }),
  string('description', { trim: true, max: 500, message: descriptionMessage }),
  oneOfValues('joinMode', JOIN_MODES, { message: 'joinMode must be instant or approval.' }),
  oneOfValues('memberListVisibility', VISIBILITY, { message: 'memberListVisibility must be members or admins.' }),
  oneOfValues('whoCanAdd', VISIBILITY, { message: 'whoCanAdd must be members or admins.' }),
  field('slowModeSeconds', { nullable: true })
    .custom((v) => (typeof v === 'number' || typeof v === 'string') && SLOW_MODE_VALUES.includes(Number(v)))
    .withMessage(`slowModeSeconds must be one of: ${SLOW_MODE_VALUES.join(', ')}.`),
  field('sizeLimit', { nullable: true }).custom((v) => typeof v !== 'object').withMessage('sizeLimit must be a number.'),
];

// GET /api/groups/invite/:code and POST .../join. Codes are short base64url text.
const inviteCode = string('code', { in: 'param', required: true, min: 1, max: 64, message: fail(404, 'This invite link is no longer valid.') })
  .bail().matches(/^[A-Za-z0-9_-]+$/).withMessage(fail(404, 'This invite link is no longer valid.'));

module.exports = {
  groupId: [groupId],
  discover: [common.paging()],
  createGroup,
  updateGroup,
  listMembers: [groupId, common.paging()],
  addMembers: [groupId, people('userIds'), people('usernames')],
  join: [groupId, shortNote('message')],
  getInvite: [inviteCode],
  joinByInvite: [inviteCode, shortNote('message')],
  // POST /api/groups/:groupId/requests/:requestId/approve | /decline
  decideRequest: [
    oneOfValues('decision', ['approve', 'decline'], { in: 'param', required: true, message: fail(404, 'Not found.') }),
    groupId,
    common.pathId('requestId', 'Request not found.'),
  ],
  member: [groupId, userId],
  setRole: [groupId, userId, oneOfValues('role', ['admin', 'member'], { required: true, message: 'role must be admin or member.' })],
  ban: [groupId, userId, shortNote('reason')],
};
