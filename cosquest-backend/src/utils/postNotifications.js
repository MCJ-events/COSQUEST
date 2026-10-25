// Notifications about posts, in the same inbox as follows and mentions
// (GET /api/users/me/notifications), live (notification:new) and as a push
// (the "Friend activity" category):
//   like     someone liked your post, or your comment
//   comment  someone commented on your post, or replied to your comment
//   repost   someone reposted your post
//   post     someone you follow posted, or reposted someone's post
//
// Never about yourself, never across a block. Each has a delivery key, so
// like/unlike/like or a retried request never notifies twice. Everything
// here runs after the response and never fails a request.
const Notification = require('../models/Notification');
const Follow = require('../models/Follow');
const Block = require('../models/Block');
const User = require('../models/User');
const notificationModel = require('../models/notificationModel');
const { emitToUser, emitToUsers } = require('../realtime/socket');
const push = require('./push');

const ACTOR_FIELDS = 'profile.username profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl';
const FANOUT_BATCH = 500;

function nameOf(user) {
  return user?.profile?.username || user?.profile?.firstName || 'Someone';
}

function snippet(text, max = 80) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

async function blockedEitherWay(a, b) {
  return Boolean(await Block.exists({ $or: [{ blocker: a, blocked: b }, { blocker: b, blocked: a }] }));
}

// One notification to one person, once per `key`.
async function notifyOne({ recipient, actor, type, message, post, comment = null, key }) {
  if (!recipient || String(recipient) === String(actor._id)) return;
  if (await blockedEitherWay(recipient, actor._id)) return;
  const result = await Notification.updateOne(
    { deliveryKey: key },
    { $setOnInsert: { user: recipient, message, type, actor: actor._id, post, postComment: comment, deliveryKey: key } },
    { upsert: true }
  ).catch((error) => { if (error?.code === 11000) return null; throw error; });
  if (!result?.upsertedCount) return;
  const doc = await Notification.findById(result.upsertedId).populate('actor', ACTOR_FIELDS);
  emitToUser(String(recipient), 'notification:new', notificationModel.sanitize(doc));
  push.notifyFromNotification([String(recipient)], { type, message, post, comment, actor });
}

function run(task) {
  task().catch((error) => console.error('[post notifications]', error.message));
}

const authorOf = (post) => post.author?._id || post.author;

function postLiked(post, actor) {
  run(() => notifyOne({ recipient: authorOf(post), actor, type: 'like', post: post._id, key: `like:${post._id}:${actor._id}`, message: `${nameOf(actor)} liked your post.` }));
}

function commentLiked(comment, actor) {
  run(() => notifyOne({ recipient: comment.author?._id || comment.author, actor, type: 'like', post: comment.post, comment: comment._id, key: `commentlike:${comment._id}:${actor._id}`, message: `${nameOf(actor)} liked your comment.` }));
}

// A comment notifies the post's author; a reply notifies the comment it
// answers (and the post's author too, when that is someone else).
function commented(post, comment, actor, repliedTo = null) {
  const said = comment.body ? `: "${snippet(comment.body)}"` : ' with a voice note.';
  run(async () => {
    const postAuthor = String(authorOf(post));
    const parentAuthor = repliedTo ? String(repliedTo.author?._id || repliedTo.author) : null;
    if (parentAuthor) {
      await notifyOne({ recipient: parentAuthor, actor, type: 'comment', post: post._id, comment: comment._id, key: `reply:${comment._id}:${parentAuthor}`, message: `${nameOf(actor)} replied to your comment${said}` });
    }
    if (postAuthor !== parentAuthor) {
      await notifyOne({ recipient: postAuthor, actor, type: 'comment', post: post._id, comment: comment._id, key: `comment:${comment._id}:${postAuthor}`, message: `${nameOf(actor)} commented on your post${said}` });
    }
  });
}

function reposted(original, actor) {
  run(() => notifyOne({ recipient: authorOf(original), actor, type: 'repost', post: original._id, key: `repost:${original._id}:${actor._id}`, message: `${nameOf(actor)} reposted your post.` }));
}

// Followers who may see the author's posts: everyone, mutual followers only
// (a friends-only profile, or "Show Activity Feed" off), or nobody (a
// private profile) - the same rule as GET /api/users/:username/posts.
async function audienceOf(author) {
  const visibility = author.privacy?.profileVisibility || 'public';
  if (visibility === 'private') return [];
  let ids = (await Follow.find({ following: author._id }, 'follower').lean()).map((row) => String(row.follower));
  if (visibility === 'friends' || author.privacy?.showActivityFeed === false) {
    const back = new Set((await Follow.find({ follower: author._id, following: { $in: ids } }, 'following').lean()).map((row) => String(row.following)));
    ids = ids.filter((id) => back.has(id));
  }
  if (!ids.length) return [];
  const blocks = await Block.find({ $or: [{ blocker: author._id, blocked: { $in: ids } }, { blocker: { $in: ids }, blocked: author._id }] }, 'blocker blocked').lean();
  const blocked = new Set(blocks.map((b) => (String(b.blocker) === String(author._id) ? String(b.blocked) : String(b.blocker))));
  return ids.filter((id) => !blocked.has(id));
}

const KIND = { image: 'a new photo', reel: 'a new reel', thought: 'a new thought' };

// Someone posted (or reposted): their followers hear about it, in batches.
function newPost(post, authorId, original = null) {
  run(async () => {
    const author = await User.findById(authorId).select(`${ACTOR_FIELDS} privacy`);
    if (!author) return;
    const followers = await audienceOf(author);
    if (!followers.length) return;
    const originalAuthor = original ? await User.findById(authorOf(original)).select('profile.username profile.firstName') : null;
    const message = original
      ? `${nameOf(author)} reposted ${String(authorOf(original)) === String(author._id) ? 'their own' : `${nameOf(originalAuthor)}'s`} post.`
      : `${nameOf(author)} posted ${KIND[post.type] || 'something new'}${post.content ? `: "${snippet(post.content)}"` : '.'}`;
    for (let i = 0; i < followers.length; i += FANOUT_BATCH) {
      const batch = followers.slice(i, i + FANOUT_BATCH);
      const docs = await Notification.insertMany(
        batch.map((userId) => ({ user: userId, message, type: 'post', actor: author._id, post: post._id, deliveryKey: `post:${post._id}:${userId}` })),
        { ordered: false }
      ).catch((error) => error?.insertedDocs || []);
      if (!docs.length) continue;
      const sample = notificationModel.sanitize({ ...docs[0].toObject(), actor: author });
      const delivered = docs.map((doc) => String(doc.user));
      emitToUsers(delivered, 'notification:new', { ...sample, id: null });
      push.notifyFromNotification(delivered, { type: 'post', message, post: post._id, actor: author });
    }
  });
}

// A deleted post takes its notifications with it (a tap would open nothing).
function postDeleted(postId) {
  run(() => Notification.deleteMany({ post: postId }));
}

module.exports = { postLiked, commentLiked, commented, reposted, newPost, postDeleted };
