const router = require('express').Router();
const { requireAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { asyncHandler: a } = require('../utils/asyncHandler');
const c = require('../controllers/scheduledCallController');
const { validate } = require('../middleware/validate');
const rules = require('../validators/planning');
router.use(['/chats/:conversationId/scheduled-calls', '/groups/:groupId/scheduled-calls', '/groups/:groupId/meet-now', '/scheduled-calls', '/call-invitations'], requireAuth, requireCompletedOnboarding);
// The app's Calls tab (services/scheduledCalls.ts): the group chat's calls.
router.get('/chats/:conversationId/scheduled-calls', validate(rules.chatGroupId), a(c.listForChat));
router.post('/chats/:conversationId/scheduled-calls', validate(rules.createForChat), a(c.create));
router.post('/groups/:groupId/scheduled-calls', validate(rules.createForGroup), a(c.create));
router.get('/groups/:groupId/scheduled-calls', validate(rules.listScheduled), a(c.list));
router.post('/groups/:groupId/meet-now', validate(rules.meetNow), a(c.create));
router.get('/call-invitations/:code', validate(rules.resolveInvite), a(c.resolveInvite));
router.get('/scheduled-calls/:callId', validate(rules.scheduledCallId), a(c.details));
router.patch('/scheduled-calls/:callId', validate(rules.updateScheduled), a(c.update));
router.post('/scheduled-calls/:callId/cancel', validate(rules.scheduledCallId), a(c.cancel));
router.post('/scheduled-calls/:callId/rsvp', validate(rules.rsvp), a(c.rsvp));
router.get('/scheduled-calls/:callId/calendar.ics', validate(rules.scheduledCallId), a(c.exportCalendar));
// { passcode } is left to the handler: any wrong or non-text passcode is 403, and the host needs none.
router.post('/scheduled-calls/:callId/join', validate(rules.scheduledCallId), a(c.join));
router.post('/scheduled-calls/:callId/admission/:userId', validate(rules.admit), a(c.admit));
module.exports = router;
