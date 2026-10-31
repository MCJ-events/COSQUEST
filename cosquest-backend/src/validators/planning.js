// Request rules for src/routes/projectRoutes.js and scheduledCallRoutes.js
// (see src/middleware/validate.js). Messages match the controllers' own
// (projectController, scheduledCallController, utils/projectAccess.js and
// utils/meetingTime.js), and the rules run in the order the controllers check,
// so the first problem reported is the same. The controllers keep their
// checks: membership, a real time zone, a time in the future, a Spark in this
// group, date + startTime.
const { objectId, string, boolean, oneOfValues, array, field, body, param, query, fail, isPlainObject } = require('../middleware/validate');
const common = require('./common');

const isId = (v) => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);

// Path ids: always 400 "Invalid <label>." here (projectAccess.objectId).
const pathId = (name, label) => objectId(name, { in: 'param', message: `Invalid ${label}.` });
const groupId = pathId('groupId', 'group ID');
const chatGroupId = pathId('conversationId', 'group ID');
const projectId = pathId('projectId', 'project ID');
const scheduledCallId = pathId('callId', 'call ID');

// An id the controller only reads when it is truthy.
const idIfSet = (name, label) => field(name).custom((v) => !v || isId(v)).withMessage(`Invalid ${label}.`);
// A subject id as projectAccess.subjectFor() reads it: null and '' mean none.
const subjectId = (at = body) => at('subjectId').optional().custom((v) => v === null || v === '' || isId(v)).withMessage('Invalid subject ID.');

// Text as projectAccess.text() checks it: counted after trimming. `nonEmpty`
// (the default when required) also refuses blank text when it is sent.
function text(name, label, max, { required = false, nonEmpty = required, nullable = false, at = 'body' } = {}) {
  return string(name, { in: at, trim: true, min: nonEmpty ? 1 : 0, max, required, nullable, message: `${label} must be ${nonEmpty ? '1' : '0'}-${max} characters.` });
}

// dueAt: an ISO date, or null / '' to clear it.
const dueAt = field('dueAt', { nullable: true })
  .custom((v) => v === '' || (typeof v === 'string' && Number.isFinite(Date.parse(v))))
  .withMessage('dueAt must be an ISO date or null.');

// ==========================================================================
// PROJECTS (src/routes/projectRoutes.js)
// ==========================================================================

// GET /api/groups/:groupId/projects?status=&q=&offset=
const listProjects = [
  groupId,
  query('status').optional().custom((v) => v === '' || ['active', 'archived'].includes(v)).withMessage('status must be active or archived.'),
  text('q', 'Search', 100, { at: 'query' }),
  common.paging(),
];

// POST /api/groups/:groupId/projects { name, description?, location?, dueAt?, subjects? }
const createProject = [
  groupId,
  array('subjects', { max: 100, message: 'Provide up to 100 subjects.' }),
  text('name', 'Project name', 100, { required: true }),
  text('description', 'Description', 2000, { nullable: true }),
  text('location', 'Location', 200, { nullable: true }),
  dueAt,
  // Each subject is { name, description? }; anything else has no name.
  text('subjects.*.name', 'Subject name', 100, { required: true }),
  text('subjects.*.description', 'Subject description', 1000, { nullable: true }),
];

// PATCH /api/projects/:projectId: only the fields sent (null is not a value
// for the texts; it clears dueAt).
const updateProject = [
  projectId,
  text('name', 'Project name', 100, { nonEmpty: true }),
  text('description', 'Description', 2000),
  text('location', 'Location', 200),
  dueAt,
  boolean('archived', { message: 'archived must be boolean.' }),
];

// POST /api/projects/:projectId/subjects { name, description? }
const addSubject = [
  projectId,
  text('name', 'Subject name', 100, { required: true }),
  text('description', 'Description', 1000, { nullable: true }),
];

// GET /api/projects/:projectId/files?subjectId=&sort=&offset=
const listFiles = [
  projectId,
  subjectId(query),
  query('sort').optional().custom((v) => v === '' || ['newest', 'oldest', 'name'].includes(v)).withMessage('sort must be newest, oldest or name.'),
  common.paging(),
];

// POST /api/projects/:projectId[/subjects/:subjectId]/files (multipart). Only
// path ids: the handler reads no body fields. These run before
// authorizeUpload, which already refused malformed ids before multer (same
// answers), so nothing is written to disk for them either way.
const uploadFile = [projectId, param('subjectId').optional().custom(isId).withMessage('Invalid subject ID.')];

// DELETE /api/projects/:projectId/files/:fileId
const deleteFile = [projectId, pathId('fileId', 'file ID')];

// POST /api/projects/:projectId/sparks { sparkId, subjectId?, fileId? }
const linkSpark = [
  projectId,
  subjectId(),
  string('sparkId', { required: true, min: 1, max: 200, message: 'Invalid Spark ID.' }),
  idIfSet('fileId', 'file ID'),
];

// ==========================================================================
// SCHEDULED CALLS (src/routes/scheduledCallRoutes.js)
// ==========================================================================

const REPEATS = ['none', 'daily', 'weekly', 'monthly'];
const DURATION = 'Duration must be 5-480 whole minutes.';
const isDuration = (v) => v === null || (Number.isInteger(v) && v >= 5 && v <= 480); // null: the default (30)

// The app's names are accepted too (durationMin, spark { id }), as the
// controller's normalize() does: an app name is only read when the API's own
// name is missing.
const spark = field('spark', { nullable: true })
  .custom((v, { req }) => req.body.sparkId !== undefined || (isPlainObject(v) && typeof v.id === 'string'))
  .withMessage('spark must be { id, subject } or null.');

// meetingTime.timing(): the time zone, the start (not for Meet now, which
// starts now) and the length.
const timing = ({ create, immediate = false }) => [
  string('timeZone', { required: create, max: 100, message: 'Choose an IANA time zone, for example Africa/Lagos.' }),
  !immediate && field('startsAt')
    .custom((v) => typeof v === 'string' && /T.*(Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)))
    .withMessage('startsAt must be an ISO timestamp with a UTC offset.'),
  field('durationMinutes').custom(isDuration).withMessage(DURATION),
  field('durationMin').custom((v, { req }) => req.body.durationMinutes !== undefined || isDuration(v)).withMessage(DURATION),
].filter(Boolean);

const repeat = (opts) => oneOfValues('repeat', REPEATS, { ...opts, message: 'repeat must be none, daily, weekly or monthly.' });

// How many separate calls to create. The controller answers a monthly series
// and a count that doesn't fit the repeat itself.
const occurrences = field('occurrences')
  .custom((v, { req }) => req.body.repeat === 'monthly' || (Number.isInteger(v) && v >= 1 && v <= 52))
  .withMessage('Choose 1-52 occurrences (1 for a one-time call).');

// create: a missing or empty value means nobody; update: a list replaces the invitations.
const participantIds = (create) => [
  create
    ? field('participantIds').custom((v) => !v || (Array.isArray(v) && v.length <= 100)).withMessage('Choose up to 100 people from this chat.')
    : array('participantIds', { max: 100, message: 'Choose up to 100 people from this chat.' }),
  field('participantIds').custom((v) => !Array.isArray(v) || v.every(isId)).withMessage('Invalid participant ID.'),
];

// A subject needs a project (create only: on an update the project can be
// the one already on the call, and the controller checks).
const subjectOfProject = field('subjectId').custom((v, { req }) => {
  if (v === null || v === '') return true;
  if (!req.body.projectId) {
    if (v) throw new Error('Select a project before a subject.');
    return true;
  }
  if (!isId(v)) throw new Error('Invalid subject ID.');
  return true;
});

const sparkId = field('sparkId').custom((v) => !v || (typeof v === 'string' && v.length <= 200)).withMessage('Invalid Spark ID.');

// hostVideo, participantVideo, waitingRoom, whoCanJoin ("members" is the app's "group").
const settings = [
  ...['hostVideo', 'participantVideo', 'waitingRoom'].map((key) => boolean(key, { message: `${key} must be boolean.` })),
  oneOfValues('whoCanJoin', ['invited', 'group', 'members'], { message: 'whoCanJoin must be invited or members.' }),
];

// POST /api/groups/:groupId/scheduled-calls, /api/chats/:conversationId/scheduled-calls
// and /api/groups/:groupId/meet-now (starts now, never repeats).
const createScheduled = (immediate) => [
  spark,
  ...timing({ create: true, immediate }),
  !immediate && repeat({ nullable: true }),
  occurrences,
  text('topic', 'Topic', 150, { required: true }),
  text('description', 'Description', 2000, { nullable: true }),
  ...participantIds(true),
  idIfSet('projectId', 'project ID'),
  subjectOfProject,
  sparkId,
  ...settings,
].filter(Boolean);
const createForGroup = [groupId, ...createScheduled(false)];
const createForChat = [chatGroupId, ...createScheduled(false)];
const meetNow = [groupId, ...createScheduled(true)];

// PATCH /api/scheduled-calls/:callId: the fields sent.
const updateScheduled = [
  scheduledCallId,
  spark,
  body('occurrences').not().exists().withMessage('Edit this occurrence only; create a new series to change the number of calls.'),
  repeat(),
  text('topic', 'Topic', 150, { nonEmpty: true }),
  text('description', 'Description', 2000),
  ...timing({ create: false }),
  ...participantIds(false),
  idIfSet('projectId', 'project ID'),
  sparkId,
  ...settings,
];

// GET /api/groups/:groupId/scheduled-calls?view=&offset=
const listScheduled = [
  groupId,
  query('view').optional().custom((v) => v === '' || ['upcoming', 'past', 'cancelled'].includes(v)).withMessage('view must be upcoming, past or cancelled.'),
  common.paging(),
];

// POST /api/scheduled-calls/:callId/rsvp { response } (or the app's { status }).
const rsvp = [
  scheduledCallId,
  body('response').custom((v, { req }) => ['accepted', 'declined'].includes(v !== undefined ? v : req.body?.status))
    .withMessage('status must be accepted or declined.'),
];

// POST /api/scheduled-calls/:callId/admission/:userId { status }
const admit = [
  scheduledCallId,
  pathId('userId', 'participant ID'),
  oneOfValues('status', ['admitted', 'denied'], { required: true, message: 'status must be admitted or denied.' }),
];

// GET /api/call-invitations/:code: a malformed code has always been "not found".
const resolveInvite = [param('code').custom((v) => /^[\w-]{32}$/.test(v)).withMessage(fail(404, 'Invitation not found.'))];

module.exports = {
  groupId, chatGroupId, projectId, scheduledCallId,
  listProjects, createProject, updateProject, addSubject, listFiles, uploadFile, deleteFile, linkSpark,
  createForGroup, createForChat, meetNow, updateScheduled, listScheduled, rsvp, admit, resolveInvite,
};
