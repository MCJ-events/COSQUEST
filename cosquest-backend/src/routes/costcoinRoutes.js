// Costcoin for members: buying bundles on the CosQuest website, the wallet.
// The website's calls carry the checkout pass, not a login token.
const express = require('express');
const { requireAuth, requireCompletedOnboarding } = require('../middleware/auth');
const { asyncHandler: a } = require('../utils/asyncHandler');
const c = require('../controllers/costcoinController');
const { requireCheckoutPass } = require('../controllers/paymentController');

const router = express.Router();
const member = [requireAuth, requireCompletedOnboarding];

router.post('/costcoin/handoff', ...member, a(c.handoff));
router.get('/costcoin/wallet', ...member, a(c.walletAndHistory));
router.post('/costcoin/handoff/redeem', a(c.redeem));
router.post('/costcoin/checkout', a(requireCheckoutPass), a(c.checkout));
router.get('/costcoin/orders/:orderId', a(requireCheckoutPass), a(c.order));

module.exports = router;
