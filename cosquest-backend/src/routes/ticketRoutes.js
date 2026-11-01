// Tickets for members (the app). The Stripe webhook is NOT here: it is
// mounted in server.js before express.json() (raw body for the signature).
const express = require('express');
const { requireAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler: a } = require('../utils/asyncHandler');
const rules = require('../validators/tickets');
const c = require('../controllers/ticketController');

const router = express.Router();
const member = [requireAuth, requireCompletedOnboarding];

router.get('/quests/:questId/ticket-types', validate(rules.questId), a(c.listTicketTypes));
router.post('/quests/:questId/checkout', ...member, validate(rules.checkout), a(c.checkout));
router.post('/quests/:questId/payment-sheet', ...member, validate(rules.checkout), a(c.paymentSheet));
router.get('/orders/:orderId', ...member, validate(rules.orderId), a(c.getOrder));
router.get('/me/tickets', ...member, validate(rules.myTickets), a(c.myTickets));
router.get('/me/tickets/:ticketId', ...member, validate(rules.ticketId), a(c.myTicket));
router.post('/me/tickets/:ticketId/cancel', ...member, validate(rules.ticketId), a(c.cancelMyTicket));

module.exports = router;
