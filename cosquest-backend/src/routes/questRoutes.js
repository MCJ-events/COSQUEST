const express = require('express');
const { requireAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');
const rules = require('../validators/misc');
const { listQuests, getQuest, registerForQuest, cancelRegistration } = require('../controllers/questController');

const router = express.Router();

router.get('/quests', validate(rules.listQuests), asyncHandler(listQuests));
router.get('/quests/:questId', validate(rules.getQuest), asyncHandler(getQuest));
router.post('/quests/:questId/registrations', requireAuth, requireCompletedOnboarding, validate(rules.registerForQuest), asyncHandler(registerForQuest));
router.delete('/quests/:questId/registrations', requireAuth, requireCompletedOnboarding, validate(rules.cancelRegistration), asyncHandler(cancelRegistration));

module.exports = router;
