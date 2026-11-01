const express = require('express');
const { requireAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');
const rules = require('../validators/misc');
const { recentJoins } = require('../controllers/questFeedController');

const router = express.Router();

// The latest people who joined (home page, under the big pin).
router.get('/quests/:questId/joins', requireAuth, requireCompletedOnboarding, validate(rules.getQuest), asyncHandler(recentJoins));

module.exports = router;
