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

router.use('/auth', authRoutes); // /api/auth/signup, /api/auth/login
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
router.use('/home', homeRoutes); // /api/home/dashboard
router.use('/', callRoutes); // /api/calls and /api/chats/:conversationId/calls
router.use('/', groupRoutes); // /api/groups (user-created groups)
router.use('/', expertiseRoutes); // /api/expertise (expertise roles)
router.use('/', require('./rankRoutes')); // /api/ranks (faction rank ladder, public)
router.use('/', chatRoutes); // /api/chats
router.use('/spotlight', require('./spotlightRoutes'));

module.exports = router;
