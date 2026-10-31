// Request rules for src/routes/chatRoutes.js (see src/middleware/validate.js).
// Messages match the controllers' own (chatController, chatExtrasController,
// pollController, sparkController, src/sparks/*), so the app sees the same
// answers. Values that could only ever mean "not found" (an id that can't
// exist) keep their 404.
const { boolean, oneOfValues, field, scalarQuery, fail, body, query } = require('../middleware/validate');
const { paging, pathId } = require('./common');
const sparksHost = require('../sparks');

const isId = (v) => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);
const trimmedLength = (v) => (typeof v === 'string' ? v.trim().length : -1);
// Spark ids are ObjectIds on the legacy engine and "spk_..." on the module.
const isSparkId = (v) => typeof v === 'string' && v.length <= 100;
const MAX_CONTENT = 2000; // Message.content maxlength

// Endpoints that only exist on the Sparks module answer 501/404 on the legacy
// engine whatever was sent: their rules run on the module only, so those
// answers stay as they were.
const moduleOnly = (...rules) =>
  rules.flat(Infinity).map((rule) => (req, res, next) => (sparksHost.isModule() ? rule(req, res, next) : next()));

const conversation = () => pathId('conversationId', 'Conversation not found.');
const inMessage = (notFound = 'Message not found.') => [conversation(), pathId('messageId', notFound)];

// Message text (optional; empty is the controller's call, it depends on the attachment).
const text = (tooLong) => field('content', { nullable: true })
  .custom((v) => typeof v === 'string').withMessage('content must be text.').bail()
  .custom((v) => v.trim().length <= MAX_CONTENT).withMessage(tooLong);
// replyTo / sparkId: empty values mean "none", as in the controllers.
const replyTo = (message) => body('replyTo').optional({ values: 'falsy' }).custom(isId).withMessage(message);
const sparkReply = () => body('sparkId').optional({ values: 'falsy' }).custom(isSparkId).withMessage('That Spark no longer exists.');
// A username to find: text; longer than any username can be is "not found", as before.
const username = (name) => body(name).optional({ values: 'falsy' })
  .custom((v) => typeof v === 'string').withMessage(`${name} must be text.`).bail()
  .custom((v) => v.length <= 100).withMessage(fail(404, 'User not found.'));

// GET /api/chats/:conversationId (and the share link, read, rollback, ...): the id only.
const chat = [conversation()];
const message = inMessage();

// POST /api/chats/dm { username }
const startDirectMessage = [username('username')];

// GET .../members?search=&page=&limit=, .../messages?page=&limit=, .../seen
const chatPage = [conversation(), paging()];
const messagePage = [...inMessage(), paging()];

// POST .../messages (multipart or JSON). mentions: a list of ids, a JSON
// string or a comma-separated string; mentionsEveryone: true or "true".
const createMessage = [
  conversation(),
  text('Message content must be at most 2,000 characters.'),
  replyTo('replyTo is not a valid message id.'),
  oneOfValues('kind', ['text', 'image', 'video', 'audio', 'file', 'sticker'], { message: 'kind must be text, image, video, audio, file, or sticker.' }),
  field('waveform')
    .custom((v) => (typeof v === 'string' && v.length <= 10000) || (Array.isArray(v) && v.length <= 128))
    .withMessage('Audio waveform must contain 1-128 numbers from 0 to 1.'),
  sparkReply(),
  field('mentions', { nullable: true })
    .custom((v) => (typeof v === 'string' && v.length <= 20000) || (Array.isArray(v) && v.length <= 500 && v.every((id) => typeof id === 'string')))
    .withMessage('mentions must be a list of user ids.'),
  field('mentionsEveryone', { nullable: true })
    .custom((v) => typeof v === 'boolean' || (typeof v === 'string' && v.length <= 5))
    .withMessage('mentionsEveryone must be true or false.'),
];

// POST .../album (multipart): caption, replyTo?, sparkId?
const createAlbum = [
  conversation(),
  text('The caption must be at most 2,000 characters.'),
  replyTo('replyTo is not a valid message id.'),
  sparkReply(),
];

// GET .../search?q=&page=&limit=&from=&to=&sort=
const searchMessages = [
  conversation(),
  query('q').custom((v) => trimmedLength(v) >= 2).withMessage('Type at least 2 characters to search.').bail()
    .custom((v) => trimmedLength(v) <= 100).withMessage('That search is too long.'),
  scalarQuery('page', 'limit'),
  query('from').optional().isString().withMessage('from must be a date like 2026-10-01 or 2026-10-01T09:30:00Z.'),
  query('to').optional().isString().withMessage('to must be a date like 2026-10-14 or 2026-10-14T18:00:00Z.'),
  query('sort').optional().custom((v) => ['', 'newest', 'oldest'].includes(v)).withMessage('sort must be newest or oldest.'),
];

// GET .../messages/:messageId/context?size=
const messageContext = [...inMessage(), scalarQuery('size')];

// PATCH .../notifications { sparksMuted }
const setChatNotifications = [conversation(), boolean('sparksMuted', { required: true, message: 'sparksMuted must be true or false.' })];

// PATCH .../messages/:messageId { content }
const editMessage = [
  ...inMessage(),
  body('content').custom((v) => trimmedLength(v) > 0).withMessage('content is required.').bail()
    .custom((v) => v.trim().length <= MAX_CONTENT).withMessage('Message content must be at most 2,000 characters.'),
];

// DELETE .../messages/:messageId?scope=me|everyone
const deleteMessage = [
  query('scope').optional().custom((v) => ['me', 'everyone'].includes(v)).withMessage('scope must be me or everyone.'),
  ...inMessage(),
];

// POST .../messages/bulk-delete { messageIds, scope? }
const selectedIds = (v) => Array.isArray(v) && v.length >= 1 && v.length <= 50 && v.every(isId);
const bulkDeleteMessage = 'Provide 1-50 valid messageIds and scope me or everyone.';
const bulkDelete = [
  body('messageIds').custom(selectedIds).withMessage(bulkDeleteMessage),
  body('scope').optional().custom((v) => ['me', 'everyone'].includes(v)).withMessage(bulkDeleteMessage),
  conversation(),
];

// POST .../messages/bulk-forward { messageIds, targets: [{ targetConversationId | targetUsername }] }
// (or one target given directly in the body).
const forwardTargets = (b) => (b.targets === undefined ? [{ targetConversationId: b.targetConversationId, targetUsername: b.targetUsername }] : b.targets);
const isTarget = (t) => Boolean(t) && typeof t === 'object' && Boolean(t.targetConversationId) !== Boolean(t.targetUsername) &&
  (!t.targetConversationId || isId(t.targetConversationId)) && (!t.targetUsername || typeof t.targetUsername === 'string');
const bulkForward = [
  body('messageIds').custom(selectedIds).withMessage('Provide 1-50 valid messageIds.'),
  body('targets').custom((v, { req }) => v === undefined || (req.body.targetConversationId === undefined && req.body.targetUsername === undefined))
    .withMessage('Use targets or a single target, not both.').bail()
    .custom((v, { req }) => { const targets = forwardTargets(req.body); return Array.isArray(targets) && targets.length >= 1 && targets.length <= 10 && targets.every(isTarget); })
    .withMessage('Provide 1-10 targets, each with exactly one targetConversationId or targetUsername.').bail()
    .custom((v, { req }) => forwardTargets(req.body).every((t) => !t.targetUsername || t.targetUsername.length <= 100))
    .withMessage(fail(404, 'User not found.')),
  conversation(),
];

// POST .../messages/:messageId/forward { targetConversationId | targetUsername }
const forwardMessage = [
  ...inMessage(),
  body('targetUsername').custom((v, { req }) => Boolean(req.body.targetConversationId) !== Boolean(v))
    .withMessage('Provide exactly one of targetConversationId or targetUsername.'),
  body('targetConversationId').optional({ values: 'falsy' }).custom(isId).withMessage(fail(404, 'You do not have access to that conversation.')),
  username('targetUsername'),
];

// PATCH .../pinned-message { messageId (null to unpin), duration? }
const setPinnedMessage = [
  conversation(),
  body('messageId').custom((v) => v !== undefined).withMessage('messageId is required; use null to unpin.'),
  body('duration').if((v, { req }) => req.body.messageId !== null && req.body.messageId !== undefined).optional()
    .custom((v) => ['24h', '7d', '30d'].includes(v)).withMessage('duration must be 24h, 7d, or 30d.'),
  body('messageId').optional({ values: 'null' }).custom(isId).withMessage('messageId is not valid.'),
];

// POST .../messages/:messageId/reactions { emoji }
const setReaction = [
  ...inMessage(),
  body('emoji').custom((v) => trimmedLength(v) >= 1 && trimmedLength(v) <= 32).withMessage('emoji is required and must be short.'),
];

// --- Polls ---

// POST .../polls { question, options, multiple?, anonymous?, closesIn?, replyTo? }
const pollOptions = (v) => (Array.isArray(v) ? v.filter((o) => trimmedLength(o) > 0) : []);
const createPoll = [
  conversation(),
  body('question').custom((v) => trimmedLength(v) >= 1 && trimmedLength(v) <= 300).withMessage('Ask a question (up to 300 characters).'),
  body('options')
    .custom((v) => Array.isArray(v) && v.length <= 100 && pollOptions(v).length >= 2 && pollOptions(v).length <= 12).withMessage('A poll needs 2 to 12 options.').bail()
    .custom((v) => v.every((o) => o === null || typeof o === 'string')).withMessage('Each option must be text.').bail()
    .custom((v) => pollOptions(v).every((o) => o.trim().length <= 100)).withMessage('Each option can be up to 100 characters.'),
  field('closesIn', { nullable: true }).custom((v) => ['', '1h', '1d', '1w'].includes(v))
    .withMessage('closesIn must be 1h, 1d or 1w (or left out for no end).'),
  replyTo('replyTo must reference a message in this conversation.'),
  boolean('multiple', { nullable: true }),
  boolean('anonymous', { nullable: true }),
];

// POST .../messages/:messageId/vote { optionIds }; close; votes.
const poll = inMessage('Poll not found.');
const votePoll = [
  ...poll,
  body('optionIds').custom((v) => Array.isArray(v) && v.length <= 50).withMessage('optionIds must be a list (empty to remove your vote).').bail()
    .custom((v) => v.every((id) => typeof id === 'string' && id.length <= 10)).withMessage('That option is not in this poll.'),
];

// --- Sparks (both engines) ---

// POST .../sparks { subject, messageId, force? }
const startSpark = [
  conversation(),
  body('subject').custom((v) => trimmedLength(v) >= 2 && trimmedLength(v) <= 60).withMessage('Give the Spark a subject (2-60 characters).'),
  body('messageId').custom(isId).withMessage(fail(404, 'Message not found.')),
  boolean('force', { nullable: true }),
];

// POST .../sparks/:sparkId/messages { messageId }
const addToSpark = [conversation(), body('messageId').custom(isId).withMessage(fail(404, 'Message not found.'))];

// PATCH .../sparks/:sparkId/pin { pinned? } (left out = pin)
const pinSpark = [conversation(), boolean('pinned', { nullable: true })];

// POST .../sparks/:sparkId/merge { intoSparkId }
const mergeSpark = [conversation(), body('intoSparkId').optional().custom(isSparkId).withMessage(fail(404, 'Spark not found.'))];

// --- Sparks module only ---

const moduleChat = moduleOnly(conversation());

// POST .../sparks/merge { sourceSparkIds, intoSparkId }
const mergeManyMessage = 'Choose the Sparks to merge (sourceSparkIds) and the one to keep (intoSparkId).';
const mergeManySparks = moduleOnly(
  conversation(),
  body('sourceSparkIds').custom((v) => Array.isArray(v) && v.length >= 1 && v.every((id) => typeof id === 'string' && id)).withMessage(mergeManyMessage).bail()
    .custom((v) => v.every((id) => id.length <= 100)).withMessage(fail(404, 'Spark not found.')),
  body('intoSparkId').custom((v) => typeof v === 'string').withMessage(mergeManyMessage).bail()
    .custom(isSparkId).withMessage(fail(404, 'Spark not found.')),
);

// GET .../sparks/:sparkId/search?q=&era=&page=&limit= (q optional, 2-100 characters)
const searchSpark = moduleOnly(
  conversation(),
  query('q').optional().isString().withMessage('q must be a single value.').bail()
    .custom((v) => v.trim().length === 0 || v.trim().length >= 2).withMessage('Type at least 2 characters to search.').bail()
    .custom((v) => v.trim().length <= 100).withMessage('That search is too long.'),
  query('era').optional().custom((v) => v === '' || (typeof v === 'string' && Number.isInteger(Number(v)) && Number(v) >= 0)).withMessage('era must be 0 or more.'),
  scalarQuery('page', 'limit'),
);

// GET .../sparks/:sparkId/messages/:messageId/context?size=
const sparkMessageContext = moduleOnly(inMessage('Message not found in this Spark.'), scalarQuery('size'));

// POST .../sparks/bot-posts/:messageId/role-pings/decide { role, decision }
const decideMessage = "Send a role and a decision ('approve' or 'dismiss').";
const decideRolePing = moduleOnly(
  conversation(),
  body('role').custom((v) => typeof v === 'string' && v.length > 0).withMessage(decideMessage).bail()
    .custom((v) => v.length <= 100).withMessage(fail(404, 'That suggested role ping was not found.')),
  body('decision').custom((v) => ['approve', 'dismiss'].includes(v)).withMessage(decideMessage),
  pathId('messageId', 'Role ping post not found.'),
);

module.exports = {
  chat, message, startDirectMessage, chatPage, messagePage, createMessage, createAlbum, searchMessages, messageContext,
  setChatNotifications, editMessage, deleteMessage, bulkDelete, bulkForward, forwardMessage, setPinnedMessage, setReaction,
  createPoll, poll, votePoll,
  startSpark, addToSpark, pinSpark, mergeSpark,
  moduleChat, mergeManySparks, searchSpark, sparkMessageContext, decideRolePing,
};
