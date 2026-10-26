const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  updateNotificationPrefs,
  updateLocationPrefs,
  registerDevice,
  unregisterDevice,
  completeOnboarding,
} = require('../controllers/preferencesController');

const router = express.Router();

// Signed-in session required on each route (not router.use: this router is
// mounted at /users, and a router-level guard would also run for every
// other /users/* path that falls through to the routers mounted after it).
router.patch('/me/preferences/notifications', requireAuth, asyncHandler(updateNotificationPrefs));
router.patch('/me/preferences/location', requireAuth, asyncHandler(updateLocationPrefs));
router.post('/me/devices', requireAuth, asyncHandler(registerDevice));
router.delete('/me/devices', requireAuth, asyncHandler(unregisterDevice));
router.delete('/me/devices/:pushToken', requireAuth, asyncHandler(unregisterDevice));
router.post('/me/onboarding/complete', requireAuth, asyncHandler(completeOnboarding));

module.exports = router;
