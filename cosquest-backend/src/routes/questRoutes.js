const express = require('express');
const { requireAuth, optionalAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');
const rules = require('../validators/misc');
const { listQuests, getQuest, registerForQuest, cancelRegistration } = require('../controllers/questController');

const router = express.Router();

// optionalAuth: signed in, each quest says isRegistered.
router.get('/quests', optionalAuth, validate(rules.listQuests), asyncHandler(listQuests));
router.get('/quests/:questId', optionalAuth, validate(rules.getQuest), asyncHandler(getQuest));
router.post('/quests/:questId/registrations', requireAuth, requireCompletedOnboarding, validate(rules.registerForQuest), asyncHandler(registerForQuest));
router.delete('/quests/:questId/registrations', requireAuth, requireCompletedOnboarding, validate(rules.cancelRegistration), asyncHandler(cancelRegistration));

module.exports = router;
