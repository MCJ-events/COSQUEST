const express = require('express');
const { requireAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { postUpload } = require('../middleware/upload');
const { asyncHandler } = require('../utils/asyncHandler');
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
  unsharePost,
  bookmarkPost,
  unbookmarkPost,
  listMyBookmarks,
  listComments,
  createComment,
  deleteComment,
} = require('../controllers/postController');

const router = express.Router();

router.get('/posts', asyncHandler(listPosts));
router.post('/posts', requireAuth, requireCompletedOnboarding, postUpload.array('media', 8), asyncHandler(createPost));
router.get('/posts/:postId', asyncHandler(getPost));
router.patch('/posts/:postId', requireAuth, requireCompletedOnboarding, asyncHandler(updatePost));
router.delete('/posts/:postId', requireAuth, requireCompletedOnboarding, asyncHandler(deletePost));
router.post('/posts/:postId/likes', requireAuth, requireCompletedOnboarding, asyncHandler(likePost));
router.delete('/posts/:postId/likes', requireAuth, requireCompletedOnboarding, asyncHandler(unlikePost));
router.post('/posts/:postId/shares', requireAuth, requireCompletedOnboarding, asyncHandler(sharePost));
router.delete('/posts/:postId/shares', requireAuth, requireCompletedOnboarding, asyncHandler(unsharePost));
router.post('/posts/:postId/bookmarks', requireAuth, requireCompletedOnboarding, asyncHandler(bookmarkPost));
router.delete('/posts/:postId/bookmarks', requireAuth, requireCompletedOnboarding, asyncHandler(unbookmarkPost));
router.get('/users/me/bookmarks', requireAuth, requireCompletedOnboarding, asyncHandler(listMyBookmarks));
router.get('/posts/:postId/comments', asyncHandler(listComments));
router.post('/posts/:postId/comments', requireAuth, requireCompletedOnboarding, asyncHandler(createComment));
router.delete('/posts/:postId/comments/:commentId', requireAuth, requireCompletedOnboarding, asyncHandler(deleteComment));
router.get('/users/:username/posts', asyncHandler(listUserPosts));

module.exports = router;
