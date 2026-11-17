// Polish (task 059): account deletion, reports, block from anywhere, push
// token removal, game events and the capabilities the app feature-detects.
// See src/controllers/safetyController.js and docs/polish/BACKEND-PORT.md.
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { requireAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const safety = require('../controllers/safetyController');

const perUser = (max) =>
  rateLimit({ windowMs: 60 * 60 * 1000, max, keyGenerator: (req) => String(req.userId), skip: () => process.env.NODE_ENV === 'test' });

router.get('/meta/capabilities', safety.capabilities);
router.post('/notifications/game-events', asyncHandler(safety.gameEvent));
// DELETE /api/users/me/devices is preferencesRoutes.js (the team's version also returns the user).
router.delete('/users/me', requireAuth, perUser(10), asyncHandler(safety.deleteAccount));
// POST /api/reports is reportRoutes.js (the admin moderation queue's own model).
router.post('/blocks', requireAuth, requireCompletedOnboarding, asyncHandler(safety.blockAnywhere));
router.delete('/blocks/:userId', requireAuth, requireCompletedOnboarding, asyncHandler(safety.unblockAnywhere));

module.exports = router;
