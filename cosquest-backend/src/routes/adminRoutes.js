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
const members = require('../controllers/adminMembersController');
const groups = require('../controllers/adminGroupsController');
const roles = require('../controllers/adminRolesController');
const settings = require('../controllers/adminSettingsController');
const audit = require('../controllers/adminAuditController');
const sparks = require('../controllers/adminSparksController');
const extras = require('../controllers/adminExtrasController');

const router = express.Router();

// Signing in (no admin token yet). Same attempt limit as the app's login.
router.post('/auth/login', adminLoginLimiter, validate(rules.login), a(auth.login));
router.post('/auth/exchange', requireAuth, a(auth.exchange));

// An invited person answers their invitation with their APP session (they
// aren't an admin yet, so this sits before the super admin guard).
router.get('/invitations/mine', requireAuth, a(roles.myInvitations));
router.post('/invitations/:invitationId/accept', requireAuth, validate(rules.invitationId), a(roles.acceptMine));
router.post('/invitations/:invitationId/decline', requireAuth, validate(rules.invitationId), a(roles.declineMine));

// Everything else: a super admin with a dashboard session.
router.use(a(requireSuperAdmin));
router.get('/auth/me', a(auth.me));
router.post('/auth/logout', a(auth.logout));
router.get('/overview', validate(rules.overview), a(overview));
router.get('/overview/export', validate(rules.overview), a(extras.exportOverview));

// Top bar: search and the bell
router.get('/search', validate(rules.search), a(extras.search));
router.get('/alerts', a(extras.alerts));

// Moderation
router.get('/reports/stats', a(reports.stats));
router.get('/reports/triage', a(extras.triage));
router.get('/reports/export', validate(rules.listReports), a(extras.exportReports));
router.get('/reports', validate(rules.listReports), a(reports.list));
router.get('/reports/:reportId', validate(rules.reportId), a(reports.detail));
router.post('/reports/:reportId/assign', validate(rules.assignReport), a(reports.assign));
router.post('/reports/:reportId/decision', validate(rules.decideReport), a(reports.decide));

// Feeds
router.get('/feeds/stats', validate(rules.feedStats), a(feeds.feedStats));
router.get('/feeds/posts/export', validate(rules.listPosts), a(extras.exportPosts));
router.post('/feeds/posts', validate(rules.createPost), a(extras.createPost));
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

// Members (community-wide restrictions; group-only ones are in Chats / Groups)
router.get('/members/stats', validate(rules.memberStats), a(members.memberStats));
router.get('/members/export', validate(rules.listMembers), a(extras.exportMembers));
router.get('/members', validate(rules.listMembers), a(members.listMembers));
router.get('/members/:userId', validate(rules.memberId), a(members.memberDetail));
router.post('/members/:userId/mute', validate(rules.communityMute), a(members.mute));
router.post('/members/:userId/unmute', validate(rules.memberLift), a(members.unmute));
router.post('/members/:userId/suspend', validate(rules.memberSuspend), a(members.suspend));
router.post('/members/:userId/unsuspend', validate(rules.memberLift), a(members.unsuspend));

// Groups
router.get('/groups/stats', validate(rules.groupStats), a(groups.groupStats));
router.get('/groups/export', validate(rules.listGroups), a(extras.exportGroups));
router.post('/groups', validate(rules.createGroup), a(extras.createGroup));
router.post('/groups/:groupId/contact-owner', validate(rules.contactOwner), a(extras.contactOwner));
router.get('/groups', validate(rules.listGroups), a(groups.listGroups));
router.get('/groups/:groupId', validate(rules.groupId), a(groups.groupDetail));
router.patch('/groups/:groupId/settings', validate(rules.groupSettings), a(groups.updateSettings));
router.post('/groups/:groupId/requests/:requestId/:decision', validate(rules.groupRequest), a(groups.decideRequest));
router.post('/groups/:groupId/archive', validate(rules.groupArchive), a(groups.archive));
router.post('/groups/:groupId/restore', validate(rules.groupArchive), a(groups.restore));

// Sparks (read-only; the module's sparks_sparks, never DMs)
router.get('/sparks/stats', validate(rules.sparkStats), a(sparks.sparkStats));
router.get('/sparks', validate(rules.listSparks), a(sparks.listSparks));
router.get('/sparks/:sparkId', validate(rules.sparkId), a(sparks.sparkDetail));

// Roles & permissions
router.get('/roles', a(roles.overview));
router.post('/roles/invitations', validate(rules.invite), a(roles.invite));
router.post('/roles/invitations/:invitationId/resend', validate(rules.invitationId), a(roles.resend));
router.post('/roles/invitations/:invitationId/revoke', validate(rules.revokeInvitation), a(roles.revokeInvitation));
router.post('/roles/admins/:userId/revoke', validate(rules.revokeAdmin), a(roles.revokeAdmin));
router.post('/roles/review', validate(rules.review), a(roles.review));

// Settings
router.get('/settings', a(settings.getSettings));
router.patch('/settings', validate(rules.settings), a(settings.updateSettings));

// Audit log (export before /:eventId)
router.get('/audit/stats', a(audit.auditStats));
router.get('/audit/export', validate(rules.audit), a(audit.exportAudit));
router.get('/audit', validate(rules.audit), a(audit.listAudit));
router.get('/audit/:eventId', validate(rules.auditId), a(audit.auditDetail));

module.exports = router;
