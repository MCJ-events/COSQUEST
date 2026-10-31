const express = require('express');
const { requireAuth, optionalAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { postUpload, chatUpload } = require('../middleware/upload');
const { asyncHandler } = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');
const rules = require('../validators/posts');
const { getPostShareLink } = require('../controllers/contentShareController');
const {
  createPost,
  listPosts,
  listUserPosts,
  getPost,
  updatePost,
  deletePost,
  likePost,
  unlikePost,
  sharePost,
  shareToFeed,
  unsharePost,
  bookmarkPost,
  unbookmarkPost,
  listMyBookmarks,
  listComments,
  createComment,
  deleteComment,
  setCommentLike,
} = require('../controllers/postController');

const router = express.Router();

router.get('/posts', asyncHandler(optionalAuth), validate(rules.listPosts), asyncHandler(listPosts));
// Multipart routes validate after multer (the fields only exist then); a
// refused request's staged files are deleted.
router.post('/posts', requireAuth, requireCompletedOnboarding, postUpload.array('media', 8), rules.validateUpload(rules.createPost), asyncHandler(createPost));
router.get('/posts/:postId', asyncHandler(optionalAuth), validate(rules.postId), asyncHandler(getPost));
router.get('/posts/:postId/share', validate(rules.postId), asyncHandler(getPostShareLink));
router.patch('/posts/:postId', requireAuth, requireCompletedOnboarding, validate(rules.updatePost), asyncHandler(updatePost));
router.delete('/posts/:postId', requireAuth, requireCompletedOnboarding, validate(rules.postId), asyncHandler(deletePost));
router.post('/posts/:postId/likes', requireAuth, requireCompletedOnboarding, validate(rules.postId), asyncHandler(likePost));
router.delete('/posts/:postId/likes', requireAuth, requireCompletedOnboarding, validate(rules.postId), asyncHandler(unlikePost));
router.post('/posts/:postId/shares', requireAuth, requireCompletedOnboarding, validate(rules.postId), asyncHandler(sharePost));
router.delete('/posts/:postId/shares', requireAuth, requireCompletedOnboarding, validate(rules.postId), asyncHandler(unsharePost));
// Share a post into your feed (like Facebook's "Share now"), with an
// optional caption: body { content? }.
router.post('/posts/:postId/share-to-feed', requireAuth, requireCompletedOnboarding, validate(rules.shareToFeed), asyncHandler(shareToFeed));
router.post('/posts/:postId/bookmarks', requireAuth, requireCompletedOnboarding, validate(rules.postId), asyncHandler(bookmarkPost));
router.delete('/posts/:postId/bookmarks', requireAuth, requireCompletedOnboarding, validate(rules.postId), asyncHandler(unbookmarkPost));
router.get('/users/me/bookmarks', requireAuth, requireCompletedOnboarding, validate(rules.paging), asyncHandler(listMyBookmarks));
router.get('/posts/:postId/comments', asyncHandler(optionalAuth), validate(rules.listComments), asyncHandler(listComments));
router.post('/posts/:postId/comments', requireAuth, requireCompletedOnboarding, chatUpload.single('media'), rules.validateUpload(rules.createComment), asyncHandler(createComment));
router.delete('/posts/:postId/comments/:commentId', requireAuth, requireCompletedOnboarding, validate(rules.commentPath), asyncHandler(deleteComment));
router.post('/posts/:postId/comments/:commentId/likes', requireAuth, requireCompletedOnboarding, validate(rules.commentPath), asyncHandler(setCommentLike));
router.delete('/posts/:postId/comments/:commentId/likes', requireAuth, requireCompletedOnboarding, validate(rules.commentPath), asyncHandler(setCommentLike));
router.get('/users/:username/posts', asyncHandler(optionalAuth), validate(rules.listUserPosts), asyncHandler(listUserPosts));

module.exports = router;
