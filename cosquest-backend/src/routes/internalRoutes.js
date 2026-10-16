/**
 * Server-to-server routes. Not for phones.
 *
 * POST /api/internal/push: the CostQuest game server asks for a push to some
 * chat accounts (a raid starting, a friend's gift, a live event). The game
 * knows a player's chat account through one login (its sso_players table:
 * the chat user id is the `subject`), and this backend owns the phones'
 * tokens and the users' notification switches, so the game never sees a
 * token.
 *
 *   Authorization: Bearer <GAME_PUSH_SECRET>
 *   { "userIds": ["<chat user id>", ...],      at most 500
 *     "title": "Boss Hour", "body": "...",      body required, clipped to 180
 *     "url": "cosquest://play?raid=...",        optional, opens the game there
 *     "category": "questUpdates" }              optional, a notificationCategories key
 *
 * -> 202 { accepted: <phones Expo took it for> }. With GAME_PUSH_SECRET unset
 * the route does not exist (404), so nothing is open by default.
 */
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const { asyncHandler } = require('../utils/asyncHandler');
const push = require('../utils/push');

const router = express.Router();
const MAX_USERS = 500;
const PLAY_URL = /^cosquest:\/\/play(\?[A-Za-z0-9%:_.=&-]{0,300})?$/;

function secretMatches(header) {
  const secret = process.env.GAME_PUSH_SECRET || '';
  const match = /^Bearer (.+)$/.exec(header || '');
  if (!secret || !match) return false;
  const a = crypto.createHash('sha256').update(match[1]).digest();
  const b = crypto.createHash('sha256').update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

router.post('/push', asyncHandler(async (req, res) => {
  if (!process.env.GAME_PUSH_SECRET) return res.status(404).json({ error: 'Not found.' });
  if (!secretMatches(req.headers.authorization)) return res.status(401).json({ error: 'Bad credentials.' });

  const { userIds, title, body, url, category } = req.body || {};
  if (!Array.isArray(userIds) || !userIds.length || userIds.length > MAX_USERS) {
    return res.status(400).json({ error: `userIds: 1 to ${MAX_USERS} chat user ids.` });
  }
  const ids = userIds.filter((id) => typeof id === 'string' && mongoose.isValidObjectId(id));
  if (typeof body !== 'string' || !body.trim()) return res.status(400).json({ error: 'body is required.' });
  if (title !== undefined && typeof title !== 'string') return res.status(400).json({ error: 'title must be a string.' });
  if (url !== undefined && (typeof url !== 'string' || !PLAY_URL.test(url))) {
    return res.status(400).json({ error: 'url must be a cosquest://play link.' });
  }
  if (category !== undefined && !push.CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category must be one of ${push.CATEGORIES.join(', ')}.` });
  }

  const accepted = await push.sendToUsers(ids, {
    title,
    body,
    data: { type: 'game', ...(url ? { url } : {}) },
    channel: 'game',
    category,
    skipOnline: false,
  });
  return res.status(202).json({ accepted });
}));

module.exports = router;
