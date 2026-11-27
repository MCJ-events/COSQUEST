const express = require('express');

const authRoutes = require('./authRoutes');
const profileRoutes = require('./profileRoutes');
const factionRoutes = require('./factionRoutes');
const interestRoutes = require('./interestRoutes');
const preferencesRoutes = require('./preferencesRoutes');
const notificationRoutes = require('./notificationRoutes');
const metaRoutes = require('./metaRoutes');
const questRoutes = require('./questRoutes');
const homeRoutes = require('./homeRoutes');
const postRoutes = require('./postRoutes');
const chatRoutes = require('./chatRoutes');
const callRoutes = require('./callRoutes');
const groupRoutes = require('./groupRoutes');
const expertiseRoutes = require('./expertiseRoutes');

const router = express.Router();

// Polish (task 059): first, so /users/me DELETE and /meta/capabilities are not
// caught by the routers below.
router.use('/', require('./safetyRoutes'));
router.use('/auth', authRoutes); // /api/auth/signup, /api/auth/login
router.use('/admin', require('./adminRoutes')); // /api/admin/* (super admin dashboard)
router.use('/', require('./reportRoutes')); // /api/reports (members report content)
router.use('/internal', require('./internalRoutes')); // /api/internal/push (game server -> phones)
// LiveKit webhooks: signed by LiveKit (no user token), raw body for the signature check.
router.post('/livekit/webhook', express.raw({ type: () => true, limit: '1mb' }), require('../utils/asyncHandler').asyncHandler(require('../controllers/livekitWebhookController').receive));
// Authentication is attached per settings endpoint, leaving onboarding routes usable.
router.use('/users/me', require('./settingsRoutes'));
router.use('/users', profileRoutes); // /api/users/me, /api/users/check-username, avatar routes
router.use('/', postRoutes); // /api/posts, /api/users/:username/posts
router.use('/', factionRoutes); // /api/factions, /api/users/me/faction
router.use('/', interestRoutes); // /api/interests, /api/users/me/interests
router.use('/users', preferencesRoutes); // /api/users/me/preferences/*, devices, onboarding/complete
router.use('/users', notificationRoutes); // /api/users/me/notifications
router.use('/meta', metaRoutes); // /api/meta/avatars
router.use('/', questRoutes); // /api/quests
router.use('/', require('./questFeedRoutes')); // /api/quests/:questId/joins (who just joined)
router.use('/', require('./ticketRoutes')); // /api/quests/:id/ticket-types|checkout, /api/orders/:id, /api/me/tickets
// The CosCoin bundles on sale (public: the app's shop).
router.get('/costcoin/bundles', require('../utils/asyncHandler').asyncHandler(require('../controllers/adminPriceTableController').bundlesOnSale));
// The official contest rules (public).
router.get('/rules', require('../utils/asyncHandler').asyncHandler(require('../controllers/rulesController').current));
router.get('/rules/:version', require('../utils/asyncHandler').asyncHandler(require('../controllers/rulesController').version));
router.use('/', require('./prizeRoutes')); // /api/prizes (my prizes, claiming)
router.use('/', require('./costcoinRoutes')); // /api/costcoin/* (buying CosCoin on the website, the wallet)
router.use('/', require('./paymentRoutes')); // /api/payments/* (paying on the CosQuest website)
router.use('/home', homeRoutes); // /api/home/dashboard
router.use('/', callRoutes); // /api/calls and /api/chats/:conversationId/calls
router.use('/', require('./projectRoutes'));
router.use('/', require('./scheduledCallRoutes'));
router.use('/', groupRoutes); // /api/groups (user-created groups)
router.use('/', expertiseRoutes); // /api/expertise (expertise roles)
router.use('/', require('./rankRoutes')); // /api/ranks (faction rank ladder, public)
router.use('/', chatRoutes); // /api/chats
router.use('/spotlight', require('./spotlightRoutes'));
router.use('/game', require('./gameRoutes')); // /api/game/session (the game's single sign-on)

module.exports = router;
