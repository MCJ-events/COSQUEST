// Counting helpers for the admin dashboard (Overview and the stat cards on
// each page). Everything takes a time window { from, to } and only counts
// documents created in it, using the createdAt indexes the models already
// have (plus the ones the new admin models add).
const Message = require('../models/Message');
const Post = require('../models/Post');
const PostComment = require('../models/PostComment');
const PostLike = require('../models/PostLike');
const CommentLike = require('../models/CommentLike');
const MessageReaction = require('../models/MessageReaction');

const DAY = 24 * 60 * 60 * 1000;
// System entries in chats, not people talking.
const NOT_PEOPLE = ['call', 'scheduled_call', 'sparks_bot'];

const inWindow = ({ from, to }) => ({ createdAt: { $gte: from, $lt: to } });

/** The window the dashboard asked for (default: the last 7 days), and the one before it. */
function windows(query = {}) {
  const to = query.to ? new Date(query.to) : new Date();
  // A date without a time means "the whole day".
  if (query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.to)) to.setUTCHours(24, 0, 0, 0);
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 7 * DAY);
  const span = Math.max(DAY, to.getTime() - from.getTime());
  return { current: { from, to }, previous: { from: new Date(from.getTime() - span), to: from }, span };
}

/** "+12.4" (percent change), or null when there's nothing to compare with. */
function change(now, before) {
  if (!before) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

const chatFilter = (w) => ({ ...inWindow(w), kind: { $nin: NOT_PEOPLE } });

async function interactionMix(w) {
  const [postLikes, commentLikes, chatReactions, comments, replies] = await Promise.all([
    PostLike.countDocuments(inWindow(w)),
    CommentLike.countDocuments(inWindow(w)),
    MessageReaction.countDocuments(inWindow(w)),
    PostComment.countDocuments({ ...inWindow(w), parentComment: null }),
    PostComment.countDocuments({ ...inWindow(w), parentComment: { $ne: null } }),
  ]);
  const reactions = postLikes + commentLikes + chatReactions;
  return { reactions, comments, replies, total: reactions + comments + replies };
}

/** People who did something (posted, commented, liked or sent a message). */
async function activePeople(w) {
  const [senders, authors, commenters, likers] = await Promise.all([
    Message.distinct('sender', chatFilter(w)),
    Post.distinct('author', inWindow(w)),
    PostComment.distinct('author', inWindow(w)),
    PostLike.distinct('user', inWindow(w)),
  ]);
  return new Set([...senders, ...authors, ...commenters, ...likers].filter(Boolean).map(String)).size;
}

/** Interactions (reactions + comments + replies) and chat messages, per day. */
async function dailySeries({ from, to }) {
  const days = [];
  for (let start = new Date(from); start < to; start = new Date(start.getTime() + DAY)) {
    days.push({ from: start, to: new Date(Math.min(start.getTime() + DAY, to.getTime())) });
  }
  return Promise.all(
    days.map(async (day) => {
      const [mix, messages] = await Promise.all([interactionMix(day), Message.countDocuments(chatFilter(day))]);
      return { date: day.from.toISOString().slice(0, 10), interactions: mix.total + messages, messages };
    })
  );
}

module.exports = { DAY, NOT_PEOPLE, inWindow, windows, change, chatFilter, interactionMix, activePeople, dailySeries };
