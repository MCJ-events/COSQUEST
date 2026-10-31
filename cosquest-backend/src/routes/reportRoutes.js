// Members reporting content: POST /api/reports (the app's "Report" option on
// posts, comments, chat messages and profiles). Reviewed in the admin
// dashboard's Moderation page.
const express = require('express');
const { requireAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler: a } = require('../utils/asyncHandler');
const rules = require('../validators/admin');
const { createReport } = require('../controllers/reportController');

const router = express.Router();

router.post('/reports', requireAuth, requireCompletedOnboarding, validate(rules.createReport), a(createReport));

module.exports = router;
