const express = require('express');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { getGameSession } = require('../controllers/gameController');
const { getRedisClient } = require('../config/redis');

// The CostQuest game's one login (src/controllers/gameController.js). Mounted
// at /api/game in server.js.
const router = express.Router();

// Per caller IP (server.js sets trust proxy), shared across instances in
// Redis like the auth limiters. Generous: the game backend asks once per
// sign-in, and it rate-limits sign-ins itself (per network and per account).
// Off in tests unless GAME_SESSION_RATE_MAX is set, as the auth limiters are.
const max = Number(process.env.GAME_SESSION_RATE_MAX || 120);
const sessionLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many game sign-in checks. Please try again in a few minutes.' },
  skip: () => process.env.NODE_ENV === 'test' && !process.env.GAME_SESSION_RATE_MAX,
  store: new RedisStore({
    prefix: 'rl:game-session:',
    sendCommand: (...args) => getRedisClient().call(...args),
  }),
});

// The game backend's single sign-on checks a chat session here.
router.get('/session', sessionLimiter, requireAuth, asyncHandler(getGameSession));

module.exports = router;
