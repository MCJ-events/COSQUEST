// CosCoin for members: buying bundles on the CosQuest website, the wallet.
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
// Spending, for every app and game (costcoinSpendController.js).
const s = require('../controllers/costcoinSpendController');
router.get('/costcoin/items', ...member, a(s.items));
router.post('/costcoin/spend', ...member, a(s.spend));
router.get('/costcoin/inventory', ...member, a(s.inventory));
router.post('/costcoin/handoff/redeem', a(c.redeem));
router.post('/costcoin/checkout', a(requireCheckoutPass), a(c.checkout));
router.get('/costcoin/orders/:orderId', a(requireCheckoutPass), a(c.order));
// Game servers only (secret x-game-key): rewards earned in gameplay, fraud flags, a wallet.
const g = require('../controllers/coscoinGameController');
router.post('/costcoin/game/rewards', g.requireGameKey, a(g.reward));
router.post('/costcoin/game/flags', g.requireGameKey, a(g.flag));
router.get('/costcoin/game/wallet/:userId', g.requireGameKey, a(g.walletOf));
// The Shop screen: one call, and free rewards.
const shopC = require('../controllers/shopController');
router.get('/shop', ...member, a(shopC.shop));
router.post('/shop/free/:itemId', ...member, a(shopC.claimFree));

module.exports = router;
