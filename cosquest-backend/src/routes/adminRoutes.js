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
const reports = require('../controllers/adminReportsController');
const feeds = require('../controllers/adminFeedsController');
const chats = require('../controllers/adminChatsController');

const router = express.Router();

// Signing in (no admin token yet). Same attempt limit as the app's login.
router.post('/auth/login', adminLoginLimiter, validate(rules.login), a(auth.login));
router.post('/auth/exchange', requireAuth, a(auth.exchange));

// Everything else: a super admin with a dashboard session.
router.use(a(requireSuperAdmin));
router.get('/auth/me', a(auth.me));
router.post('/auth/logout', a(auth.logout));
router.get('/overview', validate(rules.overview), a(overview));

// Moderation
router.get('/reports/stats', a(reports.stats));
router.get('/reports', validate(rules.listReports), a(reports.list));
router.get('/reports/:reportId', validate(rules.reportId), a(reports.detail));
router.post('/reports/:reportId/assign', validate(rules.assignReport), a(reports.assign));
router.post('/reports/:reportId/decision', validate(rules.decideReport), a(reports.decide));

// Feeds
router.get('/feeds/stats', validate(rules.feedStats), a(feeds.feedStats));
router.get('/feeds/posts', validate(rules.listPosts), a(feeds.listPosts));
router.get('/feeds/posts/:postId', validate(rules.postId), a(feeds.getPost));
router.post('/feeds/posts/:postId/remove', validate(rules.removePost), a(feeds.removePost));
router.post('/feeds/posts/:postId/restore', validate(rules.restorePost), a(feeds.restorePost));

// Chats
router.get('/chats/stats', validate(rules.chatStats), a(chats.chatStats));
router.get('/chats/conversations', validate(rules.listConversations), a(chats.listConversations));
router.get('/chats/conversations/:conversationId/messages', validate(rules.conversationMessages), a(chats.listMessages));
router.post('/chats/messages/:messageId/delete', validate(rules.deleteMessage), a(chats.deleteMessage));
router.post('/chats/conversations/:conversationId/slow-mode', validate(rules.slowMode), a(chats.slowMode));
router.post('/chats/conversations/:conversationId/members/:userId/mute', validate(rules.memberMute), a(chats.muteMember));
router.post('/chats/conversations/:conversationId/members/:userId/unmute', validate(rules.memberUnmute), a(chats.unmuteMember));
router.post('/chats/conversations/:conversationId/members/:userId/remove', validate(rules.memberRemove), a(chats.removeMember));
router.post('/chats/conversations/:conversationId/members/:userId/ban', validate(rules.memberRemove), a(chats.banMember));

module.exports = router;
