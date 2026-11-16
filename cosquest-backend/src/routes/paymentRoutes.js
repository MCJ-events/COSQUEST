// Paying on the CosQuest website (src/controllers/paymentController.js).
// The website's calls carry the checkout pass, not a login token.
const express = require('express');
const { requireAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler: a } = require('../utils/asyncHandler');
const rules = require('../validators/payments');
const c = require('../controllers/paymentController');

const router = express.Router();
const member = [requireAuth, requireCompletedOnboarding];

// The app (logged in).
router.post('/payments/handoff', ...member, validate(rules.handoff), a(c.handoff));
router.get('/payments/eligibility', ...member, validate(rules.eligibility), a(c.eligibility));
// The website.
router.post('/payments/handoff/redeem', validate(rules.redeem), a(c.redeem));
router.post('/payments/checkout', a(c.requireCheckoutPass), validate(rules.checkout), a(c.checkout));
router.get('/payments/orders/:orderId', a(c.requireCheckoutPass), validate(rules.orderId), a(c.order));

module.exports = router;
