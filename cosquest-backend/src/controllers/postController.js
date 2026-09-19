const fs = require('fs');
const mongoose = require('mongoose');
const Post = require('../models/Post');
const PostLike = require('../models/PostLike');
const PostComment = require('../models/PostComment');
const PostShare = require('../models/PostShare');
const PostBookmark = require('../models/PostBookmark');
const userModel = require('../models/userModel');
const { storePostMedia, deletePostMedia } = require('../utils/imageHost');
const { canViewProfile, canViewActivityFeed } = require('./publicProfileController');

const POST_TYPES = ['image', 'reel', 'thought'];
// 'image/jpg' isn't a registered MIME type, and 'application/octet-stream'/
// 'text/plain' are mislabeled-but-real files (a mobile picker guessing
// wrong) - all accepted here the same way as upload.js's ALLOWED_TYPES,
// deferring real validation to Cloudinary.
const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'application/octet-stream', 'text/plain'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'application/octet-stream', 'text/plain'];

function parseLimit(value, fallback = 20) {
  const limit = Number(value);
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : fallback;
}

function parsePage(value) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? Math.min(page, 1000) : 1;
}

function cleanUpLocalFiles(files) {
  for (const file of files || []) {
    if (file?.path) fs.unlink(file.path, () => {});
  }
}

function authorPreview(author) {
  return {
    id: String(author._id),
    username: author.profile.username,
    name: [author.profile.firstName, author.profile.lastName].filter(Boolean).join(' ') || author.profile.username,
    avatarKey: author.profile.avatarKey,
    avatarPhotoUrl: author.profile.avatarPhotoUrl,
    faction: author.faction,
  };
}

function serializePost(post) {
  const item = post.toObject ? post.toObject() : post;
  return {
    id: String(item._id),
    type: item.type,
    content: item.content,
    media: item.media,
    likeCount: item.likeCount,
    commentCount: item.commentCount,
    shareCount: item.shareCount,
    bookmarkCount: item.bookmarkCount,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    editedAt: item.editedAt || null,
    author: item.author?.profile ? authorPreview(item.author) : undefined,
  };
}

function validatePostInput(type, content, files) {
  if (!POST_TYPES.includes(type)) return 'type must be image, reel, or thought.';
  if (typeof content !== 'string') return 'content must be text.';
  if (type === 'thought' && (!content.trim() || content.trim().length > 300)) {
    return 'A thought must contain 1 to 300 characters.';
  }
  if (type !== 'thought' && content.trim().length > 2200) return 'Post captions must be at most 2,200 characters.';
  if (type === 'thought' && files.length) return 'Thoughts cannot include media.';
  if (type === 'image') {
    if (files.length < 1 || files.length > 8) return 'An image post must contain between 1 and 8 images.';
    if (files.some((file) => !IMAGE_TYPES.includes(file.mimetype) || file.size > 10 * 1024 * 1024)) {
      return 'Each post image must be JPEG, PNG, WEBP, or GIF and no larger than 10MB.';
    }
  }
  if (type === 'reel') {
    if (files.length !== 1 || !VIDEO_TYPES.includes(files[0].mimetype)) {
      return 'A reel must contain exactly one MP4, MOV, or WEBM video.';
    }
  }
  return null;
}

async function loadPost(postId) {
  if (!mongoose.isValidObjectId(postId)) return null;
  return Post.findById(postId).populate('author', 'profile.username profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl faction');
}

async function createPost(req, res) {
  const type = String(req.body.type || '').trim().toLowerCase();
  const content = req.body.content === undefined ? '' : req.body.content;
  const files = req.files || [];
  const validationError = validatePostInput(type, content, files);
  if (validationError) {
    cleanUpLocalFiles(files);
    return res.status(400).json({ error: validationError });
  }

  let media = [];
  try {
    if (files.length) media = await storePostMedia(files, type);
    if (type === 'reel' && Number(media[0].durationSeconds) > 30) {
      await deletePostMedia(media);
      return res.status(400).json({ error: 'A reel must be 30 seconds or shorter.' });
    }
    const post = await Post.create({ author: req.userId, type, content: content.trim(), media });
    await post.populate('author', 'profile.username profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl faction');
    return res.status(201).json({ post: serializePost(post) });
  } catch (error) {
    if (media.length) await deletePostMedia(media);
    throw error;
  }
}

async function listPosts(req, res) {
  const type = req.query.type;
  if (type && !POST_TYPES.includes(type)) return res.status(400).json({ error: 'type must be image, reel, or thought.' });
  const limit = parseLimit(req.query.limit);
  const page = parsePage(req.query.page);
  const query = type ? { type } : {};
  const [posts, total] = await Promise.all([
    Post.find(query)
      .populate('author', 'profile.username profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl faction')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Post.countDocuments(query),
  ]);
  return res.json({ posts: posts.map(serializePost), pagination: { page, limit, total, hasMore: page * limit < total } });
}

async function listUserPosts(req, res) {
  const user = await userModel.findByUsername(req.params.username);
  if (!user || !(await canViewProfile(user, req.userId))) return res.status(404).json({ error: 'Profile not found.' });
  const type = req.query.type;
  if (type && !POST_TYPES.includes(type)) return res.status(400).json({ error: 'type must be image, reel, or thought.' });
  const limit = parseLimit(req.query.limit);
  const page = parsePage(req.query.page);
  // The profile itself is visible, but "Show Activity Feed" being off hides
  // the posts specifically from anyone who isn't the owner or a friend - an
  // empty list, not a 404, since the profile really is there.
  if (!(await canViewActivityFeed(user, req.userId))) {
    return res.json({ posts: [], pagination: { page, limit, total: 0, hasMore: false } });
  }
  const query = { author: user._id, ...(type ? { type } : {}) };
  const [posts, total] = await Promise.all([
    Post.find(query)
      .populate('author', 'profile.username profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl faction')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Post.countDocuments(query),
  ]);
  return res.json({ posts: posts.map(serializePost), pagination: { page, limit, total, hasMore: page * limit < total } });
}

async function getPost(req, res) {
  const post = await loadPost(req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  return res.json({ post: serializePost(post) });
}

async function updatePost(req, res) {
  const post = await loadPost(req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  if (String(post.author._id) !== String(req.userId)) return res.status(403).json({ error: 'You can only edit your own post.' });
  if (req.body.content === undefined || typeof req.body.content !== 'string') {
    return res.status(400).json({ error: 'content is required.' });
  }
  const content = req.body.content.trim();
  const maxLength = post.type === 'thought' ? 300 : 2200;
  if ((post.type === 'thought' && !content) || content.length > maxLength) {
    return res.status(400).json({ error: `content must be ${post.type === 'thought' ? '1 to 300' : 'at most 2,200'} characters.` });
  }
  post.content = content;
  post.editedAt = new Date();
  await post.save();
  return res.json({ post: serializePost(post) });
}

async function deletePost(req, res) {
  const post = await loadPost(req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  if (String(post.author._id) !== String(req.userId)) return res.status(403).json({ error: 'You can only delete your own post.' });
  await Promise.all([
    PostLike.deleteMany({ post: post._id }),
    PostComment.deleteMany({ post: post._id }),
    PostShare.deleteMany({ post: post._id }),
    PostBookmark.deleteMany({ post: post._id }),
    Post.deleteOne({ _id: post._id }),
  ]);
  await deletePostMedia(post.media);
  return res.json({ message: 'Post deleted.' });
}

async function likePost(req, res) {
  const post = await loadPost(req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  try {
    await PostLike.create({ post: post._id, user: req.userId });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'You already liked this post.' });
    throw error;
  }
  const updated = await Post.findByIdAndUpdate(post._id, { $inc: { likeCount: 1 } }, { new: true });
  return res.status(201).json({ liked: true, likeCount: updated.likeCount });
}

async function unlikePost(req, res) {
  const post = await loadPost(req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  const removed = await PostLike.deleteOne({ post: post._id, user: req.userId });
  if (!removed.deletedCount) return res.status(404).json({ error: 'You have not liked this post.' });
  const updated = await Post.findByIdAndUpdate(post._id, { $inc: { likeCount: -1 } }, { new: true });
  return res.json({ liked: false, likeCount: Math.max(0, updated.likeCount) });
}

async function sharePost(req, res) {
  const post = await loadPost(req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  try {
    await PostShare.create({ post: post._id, user: req.userId });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'You already shared this post.' });
    throw error;
  }
  const updated = await Post.findByIdAndUpdate(post._id, { $inc: { shareCount: 1 } }, { new: true });
  return res.status(201).json({ shared: true, shareCount: updated.shareCount });
}

async function unsharePost(req, res) {
  const post = await loadPost(req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  const removed = await PostShare.deleteOne({ post: post._id, user: req.userId });
  if (!removed.deletedCount) return res.status(404).json({ error: 'You have not shared this post.' });
  const updated = await Post.findByIdAndUpdate(post._id, { $inc: { shareCount: -1 } }, { new: true });
  return res.json({ shared: false, shareCount: Math.max(0, updated.shareCount) });
}

async function bookmarkPost(req, res) {
  const post = await loadPost(req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  try {
    await PostBookmark.create({ post: post._id, user: req.userId });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'You already bookmarked this post.' });
    throw error;
  }
  const updated = await Post.findByIdAndUpdate(post._id, { $inc: { bookmarkCount: 1 } }, { new: true });
  return res.status(201).json({ bookmarked: true, bookmarkCount: updated.bookmarkCount });
}

async function unbookmarkPost(req, res) {
  const post = await loadPost(req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  const removed = await PostBookmark.deleteOne({ post: post._id, user: req.userId });
  if (!removed.deletedCount) return res.status(404).json({ error: 'You have not bookmarked this post.' });
  const updated = await Post.findByIdAndUpdate(post._id, { $inc: { bookmarkCount: -1 } }, { new: true });
  return res.json({ bookmarked: false, bookmarkCount: Math.max(0, updated.bookmarkCount) });
}

async function listMyBookmarks(req, res) {
  const limit = parseLimit(req.query.limit);
  const page = parsePage(req.query.page);
  const query = { user: req.userId };
  const [bookmarks, total] = await Promise.all([
    PostBookmark.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({
        path: 'post',
        populate: { path: 'author', select: 'profile.username profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl faction' },
      }),
    PostBookmark.countDocuments(query),
  ]);
  return res.json({
    posts: bookmarks.filter((bookmark) => bookmark.post).map((bookmark) => serializePost(bookmark.post)),
    pagination: { page, limit, total, hasMore: page * limit < total },
  });
}

function serializeComment(comment) {
  return {
    id: String(comment._id),
    body: comment.body,
    author: authorPreview(comment.author),
    parentComment: comment.parentComment ? String(comment.parentComment) : null,
    replyCount: comment.replyCount || 0,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}

// GET /api/posts/:postId/comments - top-level comments by default; pass
// ?parentComment=<id> to fetch the replies under one specific top-level
// comment instead (one level of nesting only - a reply has no replies).
async function listComments(req, res) {
  const post = await loadPost(req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found.' });

  let parentComment = null;
  if (req.query.parentComment) {
    if (!mongoose.isValidObjectId(req.query.parentComment)) return res.status(404).json({ error: 'Comment not found.' });
    const parent = await PostComment.findById(req.query.parentComment);
    if (!parent || String(parent.post) !== String(post._id)) return res.status(404).json({ error: 'Comment not found.' });
    parentComment = parent._id;
  }

  const limit = parseLimit(req.query.limit);
  const page = parsePage(req.query.page);
  const query = { post: post._id, parentComment };
  const [comments, total] = await Promise.all([
    PostComment.find(query)
      .populate('author', 'profile.username profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl faction')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    PostComment.countDocuments(query),
  ]);
  return res.json({
    comments: comments.map(serializeComment),
    pagination: { page, limit, total, hasMore: page * limit < total },
  });
}

// POST /api/posts/:postId/comments - pass parentComment to reply under an
// existing top-level comment; replying to a reply is rejected (one level deep).
async function createComment(req, res) {
  const post = await loadPost(req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  if (!body || body.length > 500) return res.status(400).json({ error: 'A comment must contain 1 to 500 characters.' });

  let parent = null;
  if (req.body.parentComment) {
    if (!mongoose.isValidObjectId(req.body.parentComment)) return res.status(404).json({ error: 'Comment not found.' });
    parent = await PostComment.findById(req.body.parentComment);
    if (!parent || String(parent.post) !== String(post._id)) return res.status(404).json({ error: 'Comment not found.' });
    if (parent.parentComment) return res.status(400).json({ error: 'You can only reply to a top-level comment.' });
  }

  const comment = await PostComment.create({ post: post._id, author: req.userId, body, parentComment: parent ? parent._id : null });
  const [updated] = await Promise.all([
    Post.findByIdAndUpdate(post._id, { $inc: { commentCount: 1 } }, { new: true }),
    parent ? PostComment.updateOne({ _id: parent._id }, { $inc: { replyCount: 1 } }) : Promise.resolve(),
  ]);
  await comment.populate('author', 'profile.username profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl faction');
  return res.status(201).json({
    comment: serializeComment(comment),
    commentCount: updated.commentCount,
  });
}

// Deleting a top-level comment cascades to its replies (they can't exist without it).
async function deleteComment(req, res) {
  if (!mongoose.isValidObjectId(req.params.commentId)) return res.status(404).json({ error: 'Comment not found.' });
  const comment = await PostComment.findById(req.params.commentId);
  if (!comment || String(comment.post) !== String(req.params.postId)) return res.status(404).json({ error: 'Comment not found.' });
  if (String(comment.author) !== String(req.userId)) return res.status(403).json({ error: 'You can only delete your own comment.' });

  const repliesResult = comment.parentComment ? { deletedCount: 0 } : await PostComment.deleteMany({ parentComment: comment._id });
  await PostComment.deleteOne({ _id: comment._id });
  if (comment.parentComment) {
    await PostComment.updateOne({ _id: comment.parentComment }, { $inc: { replyCount: -1 } });
  }
  const removedCount = 1 + repliesResult.deletedCount;
  const updated = await Post.findByIdAndUpdate(comment.post, { $inc: { commentCount: -removedCount } }, { new: true });
  return res.json({ message: 'Comment deleted.', commentCount: Math.max(0, updated?.commentCount || 0) });
}

module.exports = {
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
};
