// Rules for /api/admin routes (Phases 1-6) (src/routes/adminRoutes.js) and member reports
// (src/routes/reportRoutes.js). Types and limits only; the controllers check
// who may do what and anything that needs the database.
const { string, boolean, number, object, isoDate, objectId, oneOfValues, scalarQuery } = require('../middleware/validate');
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
  // Phase 3: Members
  memberStats: window,
  listMembers: [
    ...page,
    ...scalarQuery('tab', 'role', 'group'),
    oneOfValues('tab', ['all', 'pending', 'muted', 'suspended'], { in: 'query', label: 'tab' }),
    oneOfValues('role', ['admin', 'member'], { in: 'query', label: 'role' }),
  ],
  memberId: [objectId('userId', { in: 'param', label: 'member ID' })],
  // (Not memberMute: that name is the group mute in Chats, above.)
  communityMute: [objectId('userId', { in: 'param', label: 'member ID' }), oneOfValues('duration', ['1h', '1d', '1w', '30d', 'forever'], { required: true, label: 'duration' }), reason()],
  memberSuspend: [objectId('userId', { in: 'param', label: 'member ID' }), oneOfValues('duration', ['1d', '1w', '30d', 'forever'], { required: true, label: 'duration' }), reason()],
  memberLift: [objectId('userId', { in: 'param', label: 'member ID' }), reason(false)],

  // Phase 3: Groups
  groupStats: window,
  listGroups: [
    ...page,
    ...scalarQuery('tab', 'kind'),
    oneOfValues('tab', ['all', 'active', 'attention', 'archived'], { in: 'query', label: 'tab' }),
    oneOfValues('kind', ['open', 'private', 'faction'], { in: 'query', label: 'kind' }),
  ],
  groupId: [objectId('groupId', { in: 'param', label: 'group ID' })],
  groupSettings: [
    objectId('groupId', { in: 'param', label: 'group ID' }),
    oneOfValues('joinMode', ['instant', 'approval'], { label: 'joinMode' }),
    oneOfValues('whoCanAdd', ['members', 'admins'], { label: 'whoCanAdd' }),
    oneOfValues('memberListVisibility', ['members', 'admins'], { label: 'memberListVisibility' }),
    reason(false),
  ],
  groupRequest: [
    objectId('groupId', { in: 'param', label: 'group ID' }),
    objectId('requestId', { in: 'param', label: 'request ID' }),
    oneOfValues('decision', ['approve', 'decline'], { in: 'param', required: true, label: 'decision' }),
    reason(false),
  ],
  groupArchive: [objectId('groupId', { in: 'param', label: 'group ID' }), reason()],

  // Phase 5: Roles & permissions
  invite: [string('member', { required: true, min: 2, max: 254, trim: true, label: 'member', message: 'Enter a member\'s @username or email.' }), reason()],
  invitationId: [objectId('invitationId', { in: 'param', label: 'invitation ID' })],
  revokeInvitation: [objectId('invitationId', { in: 'param', label: 'invitation ID' }), reason()],
  revokeAdmin: [objectId('userId', { in: 'param', label: 'admin ID' }), reason()],
  review: [string('note', { max: 1000, label: 'note' })],

  // Phase 5: Settings
  settings: [
    number('version', { required: true, integer: true, min: 1, label: 'version' }),
    object('changes', { required: true, label: 'changes' }),
    reason(false),
  ],

  // Phase 5: Audit log
  audit: [
    ...page,
    ...window,
    ...scalarQuery('actor', 'area', 'action'),
    objectId('actor', { in: 'query', required: false, label: 'actor' }),
    oneOfValues('area', ['moderation', 'feeds', 'chats', 'members', 'groups', 'sparks', 'roles', 'settings', 'auth'], { in: 'query', label: 'area' }),
    string('action', { in: 'query', max: 80, label: 'action' }),
  ],
  auditId: [objectId('eventId', { in: 'param', label: 'event ID' })],

  // Phase 4: Sparks
  sparkStats: window,
  listSparks: [
    ...page,
    ...scalarQuery('tab', 'group'),
    oneOfValues('tab', ['all', 'active', 'quiet', 'dormant'], { in: 'query', label: 'tab' }),
    objectId('group', { in: 'query', required: false, label: 'group' }),
  ],
  sparkId: [string('sparkId', { in: 'param', required: true, min: 1, max: 100, label: 'Spark ID' })],

  // Phase 6: finishing touches
  search: [...scalarQuery('q'), string('q', { in: 'query', max: 100, label: 'q' })],
  createGroup: [
    string('name', { required: true, min: 2, max: 80, trim: true, label: 'name', message: 'A group name needs 2-80 characters.' }),
    string('description', { max: 500, label: 'description' }),
    oneOfValues('kind', ['open', 'private'], { required: true, label: 'kind' }),
    oneOfValues('joinMode', ['instant', 'approval'], { label: 'joinMode' }),
  ],
  contactOwner: [
    objectId('groupId', { in: 'param', label: 'group ID' }),
    string('message', { required: true, min: 3, max: 500, trim: true, label: 'message', message: 'Write a message of 3-500 characters.' }),
  ],
  createPost: [string('content', { required: true, min: 1, max: 2000, trim: true, label: 'content', message: 'A post needs 1-2,000 characters.' })],
};
