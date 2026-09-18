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

const router = express.Router();

router.use('/auth', authRoutes); // /api/auth/signup, /api/auth/login
router.use('/users', profileRoutes); // /api/users/me, /api/users/check-username, avatar routes
router.use('/', postRoutes); // /api/posts, /api/users/:username/posts
router.use('/', factionRoutes); // /api/factions, /api/users/me/faction
router.use('/', interestRoutes); // /api/interests, /api/users/me/interests
router.use('/users', preferencesRoutes); // /api/users/me/preferences/*, devices, onboarding/complete
router.use('/users', notificationRoutes); // /api/users/me/notifications
router.use('/meta', metaRoutes); // /api/meta/avatars
router.use('/', questRoutes); // /api/quests
router.use('/home', homeRoutes); // /api/home/dashboard
router.use('/', chatRoutes); // /api/chats

module.exports = router;
