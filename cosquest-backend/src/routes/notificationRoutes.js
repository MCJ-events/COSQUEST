const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { listNotifications, markRead } = require('../controllers/notificationController');

const router = express.Router();

router.use(requireAuth); // every route below requires a valid Bearer token

router.get('/me/notifications', asyncHandler(listNotifications));
router.patch('/me/notifications/read', asyncHandler(markRead));

module.exports = router;
