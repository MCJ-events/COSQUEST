// Request rules for src/routes/postRoutes.js (see src/middleware/validate.js).
// Messages match the controller's own, so the app sees the same answers.
const { validateUpload, string, field, fail } = require('../middleware/validate');
const common = require('./common');

const POST_TYPES = ['image', 'reel', 'thought'];
const LIST_TYPES = [...POST_TYPES, 'share'];
const isHexId = (v) => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);

/**
 * Optional text with its own message for "not text" (`typeMessage`) and the
 * controller's message for the length (counted after trimming, as stored).
 */
function text(name, { max, typeMessage, message, nullable = true }) {
  return field(name, { nullable })
    .custom((v) => typeof v === 'string').withMessage(typeMessage).bail()
    .custom((v) => v.trim().length <= max).withMessage(message);
}

const postId = common.pathId('postId', 'Post not found.');
// Comment routes have always answered "Comment not found." for a bad post id too.
const commentPath = [
  common.pathId('postId', 'Comment not found.'),
  common.pathId('commentId', 'Comment not found.'),
];
// ?type= on the lists ('' means all types, as before).
const listType = field('type', { in: 'query' })
  .custom((v) => v === '' || LIST_TYPES.includes(v)).withMessage('type must be image, reel, thought, or share.');
// ?parentComment= / body parentComment: empty means none; anything else must be an id.
const parentComment = (at) => field('parentComment', { in: at, nullable: true })
  .custom((v) => !v || isHexId(v)).withMessage(fail(404, 'Comment not found.'));

const normalType = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

// GET /api/posts?type=&page=&limit=
const listPosts = [listType, common.paging()];

// GET /api/users/:username/posts
const listUserPosts = [
  string('username', { in: 'param', required: true, min: 1, max: 100, message: fail(404, 'Profile not found.') }),
  listType,
  common.paging(),
];

// POST /api/posts (multipart: media[]) { type, content }. The controller checks
// the files (count, kinds, sizes) and the reel's length.
const typeMessage = 'type must be image, reel, or thought.';
const createPost = [
  field('type', { required: true }).withMessage(typeMessage).bail()
    .custom((v) => POST_TYPES.includes(normalType(v))).withMessage(typeMessage),
  field('content').custom((v) => typeof v === 'string').withMessage('content must be text.').bail()
    .custom((v, { req }) => {
      const length = v.trim().length;
      return normalType(req.body.type) === 'thought' ? length >= 1 && length <= 2000 : length <= 2200;
    })
    .withMessage((v, { req }) => (normalType(req.body.type) === 'thought'
      ? 'A thought must contain 1 to 2,000 characters.'
      : 'Post captions must be at most 2,200 characters.')),
];

// PATCH /api/posts/:postId { content }. The length depends on the post's type
// (the controller checks it, with its own message, so no cap here).
const updatePost = [postId, string('content', { required: true, max: Infinity, message: 'content is required.' })];

// POST /api/posts/:postId/share-to-feed { content? }
const shareToFeed = [
  postId,
  text('content', { max: 2200, typeMessage: 'Your caption must be text.', message: 'Your caption must be at most 2,200 characters.' }),
];

// GET /api/posts/:postId/comments?parentComment=&page=&limit=
const listComments = [postId, parentComment('query'), common.paging()];

// POST /api/posts/:postId/comments (multipart: optional voice `media`) { body?, parentComment? }
const createComment = [
  postId,
  text('body', { max: 500, typeMessage: 'A comment must be text.', message: 'A comment must be at most 500 characters.' }),
  parentComment('body'),
];

module.exports = {
  validateUpload,
  text,
  postId,
  commentPath,
  listPosts,
  listUserPosts,
  createPost,
  updatePost,
  shareToFeed,
  listComments,
  createComment,
  paging: common.paging(),
};
