// The super admin dashboard's API: /api/admin/... (website only, super admins
// only). Mounted with its own line in src/routes/index.js; the guard below
// applies to this router's paths only.
//
// Signing in uses the dashboard's own session (src/utils/adminToken.js), so
// it never signs a super admin's phone out.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { adminLoginLimiter } = require('../middleware/rateLimiter');
const { requireSuperAdmin } = require('../middleware/requireSuperAdmin');
const { validate } = require('../middleware/validate');
const { asyncHandler: a } = require('../utils/asyncHandler');
const rules = require('../validators/admin');
const auth = require('../controllers/adminAuthController');
const { overview } = require('../controllers/adminOverviewController');

const router = express.Router();

// Signing in (no admin token yet). Same attempt limit as the app's login.
router.post('/auth/login', adminLoginLimiter, validate(rules.login), a(auth.login));
router.post('/auth/exchange', requireAuth, a(auth.exchange));

// Everything else: a super admin with a dashboard session.
router.use(a(requireSuperAdmin));
router.get('/auth/me', a(auth.me));
router.post('/auth/logout', a(auth.logout));
router.get('/overview', validate(rules.overview), a(overview));

module.exports = router;
