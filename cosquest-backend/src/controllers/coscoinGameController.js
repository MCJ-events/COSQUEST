// Game servers (CostQuest, Cost Trivia, Parlay...) -> the one CosCoin wallet.
// Server to server only: header  x-game-key: <GAME_REWARDS_KEY>  (never in an app).
//   POST /api/costcoin/game/rewards   { userId, amount, reason, key, game? }  coins earned in gameplay
//   POST /api/costcoin/game/flags     { userId, reason, freeze? }             a fraud flag (freezes by default)
//   GET  /api/costcoin/game/wallet/:userId                                    balance, bought, earned, frozen
const crypto = require('crypto');
const mongoose = require('mongoose');
const Wallet = require('../models/Wallet');
const rewards = require('../utils/coscoinRewards');

function requireGameKey(req, res, next) {
  const expected = process.env.GAME_REWARDS_KEY;
  if (!expected) return res.status(503).json({ error: 'Game rewards are not set up on this server (GAME_REWARDS_KEY).', code: 'not_configured' });
  const given = String(req.get('x-game-key') || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (!given || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Wrong game key.', code: 'bad_game_key' });
  return next();
}

function answer(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.extra || {}) });
  throw error;
}

const validUser = (id) => mongoose.isValidObjectId(id);

async function reward(req, res) {
  if (!validUser(req.body?.userId)) return res.status(400).json({ error: 'userId is a CosQuest member id.', code: 'bad_user' });
  try {
    return res.json(await rewards.grant(req.body.userId, req.body));
  } catch (error) {
    return answer(res, error);
  }
}

async function flag(req, res) {
  if (!validUser(req.body?.userId)) return res.status(400).json({ error: 'userId is a CosQuest member id.', code: 'bad_user' });
  try {
    const w = await rewards.flag(req.body.userId, { reason: req.body.reason, by: `game:${String(req.body.game || 'game').slice(0, 20)}`, freeze: req.body.freeze !== false });
    return res.json({ frozen: Boolean(w?.frozen), flags: (w?.flags || []).length });
  } catch (error) {
    return answer(res, error);
  }
}

async function walletOf(req, res) {
  if (!validUser(req.params.userId)) return res.status(400).json({ error: 'userId is a CosQuest member id.', code: 'bad_user' });
  const w = await Wallet.findOne({ user: req.params.userId }).lean();
  return res.json({ ...rewards.split(w), frozen: Boolean(w?.frozen) });
}

module.exports = { requireGameKey, reward, flag, walletOf };
