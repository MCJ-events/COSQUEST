// Rules for /api/admin routes (src/routes/adminRoutes.js) and member reports
// (src/routes/reportRoutes.js). Types and limits only; the controllers check
// who may do what and anything that needs the database.
const { string, boolean, number, isoDate, objectId, oneOfValues, scalarQuery } = require('../middleware/validate');
const Report = require('../models/Report');

const window = [...scalarQuery('from', 'to'), isoDate('from', { in: 'query', label: 'from' }), isoDate('to', { in: 'query', label: 'to' })];
const page = [...scalarQuery('offset', 'q')];
const reason = (required = true) => string('reason', { required, max: 1000, label: 'reason', message: required ? 'A reason is required.' : 'reason must be text of at most 1000 characters.' });

module.exports = {
  // Phase 1
  login: [
    string('email', { required: true, min: 3, max: 254, trim: true, label: 'email', message: 'email and password are required.' }),
    string('password', { required: true, min: 1, max: 200, message: 'email and password are required.' }),
  ],
  overview: window,
  createReport: [
    oneOfValues('targetType', Report.TARGET_TYPES, { required: true, label: 'targetType' }),
    objectId('targetId', { label: 'targetId' }),
    oneOfValues('reason', Report.REASONS, { required: true, label: 'reason' }),
    string('statement', { max: 1000, label: 'statement' }),
  ],

  // Phase 2: Moderation
  listReports: [
    ...page,
    ...scalarQuery('status', 'type', 'priority', 'assignee'),
    oneOfValues('status', ['open', 'new', 'in_review', 'resolved', 'dismissed'], { in: 'query', label: 'status' }),
    oneOfValues('type', Report.TARGET_TYPES, { in: 'query', label: 'type' }),
    oneOfValues('priority', ['high', 'standard'], { in: 'query', label: 'priority' }),
  ],
  reportId: [objectId('reportId', { in: 'param', label: 'report ID' })],
  assignReport: [objectId('reportId', { in: 'param', label: 'report ID' }), objectId('adminId', { required: false, label: 'adminId' })],
  decideReport: [
    objectId('reportId', { in: 'param', label: 'report ID' }),
    oneOfValues('action', ['remove_post', 'remove_comment', 'delete_message', 'dismiss'], { required: true, label: 'action' }),
    reason(),
    boolean('notifyAuthor', { label: 'notifyAuthor' }),
  ],

  // Phase 2: Feeds
  feedStats: window,
  listPosts: [
    ...page,
    ...scalarQuery('tab', 'type'),
    oneOfValues('tab', ['all', 'reported', 'removed'], { in: 'query', label: 'tab' }),
    oneOfValues('type', ['image', 'reel', 'thought', 'share'], { in: 'query', label: 'type' }),
  ],
  postId: [objectId('postId', { in: 'param', label: 'post ID' })],
  removePost: [objectId('postId', { in: 'param', label: 'post ID' }), reason(), boolean('notifyAuthor', { label: 'notifyAuthor' })],
  restorePost: [objectId('postId', { in: 'param', label: 'post ID' }), reason()],

  // Phase 2: Chats
  chatStats: window,
  listConversations: [...page, ...scalarQuery('filter'), oneOfValues('filter', ['all', 'reported'], { in: 'query', label: 'filter' })],
  conversationMessages: [objectId('conversationId', { in: 'param', label: 'conversation ID' }), ...scalarQuery('around', 'before')],
  deleteMessage: [objectId('messageId', { in: 'param', label: 'message ID' }), reason(), boolean('notifyAuthor', { label: 'notifyAuthor' })],
  slowMode: [
    objectId('conversationId', { in: 'param', label: 'conversation ID' }),
    number('seconds', { required: true, integer: true, min: 0, max: 3600, label: 'seconds' }),
    reason(false),
  ],
  memberMute: [
    objectId('conversationId', { in: 'param', label: 'conversation ID' }),
    objectId('userId', { in: 'param', label: 'user ID' }),
    oneOfValues('duration', ['1h', '1d', '1w', 'forever'], { required: true, label: 'duration' }),
    reason(),
  ],
  memberUnmute: [objectId('conversationId', { in: 'param', label: 'conversation ID' }), objectId('userId', { in: 'param', label: 'user ID' }), reason(false)],
  memberRemove: [objectId('conversationId', { in: 'param', label: 'conversation ID' }), objectId('userId', { in: 'param', label: 'user ID' }), reason()],
};
