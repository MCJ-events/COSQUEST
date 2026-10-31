const express = require('express');
const { signup, login, logout, forgotPassword, resetPassword } = require('../controllers/authController');
const { startGoogle, startApple, googleCallback, appleCallback, exchange } = require('../controllers/oauthController');
const { signupLimiter, loginLimiter, forgotPasswordLimiter } = require('../middleware/rateLimiter');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');
const rules = require('../validators/auth');

const router = express.Router();

router.post('/signup', signupLimiter, validate(rules.signup), asyncHandler(signup));
router.post('/login', loginLimiter, validate(rules.login), asyncHandler(login));
router.post('/logout', requireAuth, asyncHandler(logout));
router.post('/forgot-password', forgotPasswordLimiter, validate(rules.forgotPassword), asyncHandler(forgotPassword));
router.post('/reset-password', validate(rules.resetPassword), asyncHandler(resetPassword));
// The browser legs of OAuth (start, and the provider's callback) have no
// rules: they must always end in a redirect back to the app, never a JSON
// error page, so their inputs are checked in src/utils/oauth.js instead.
router.get('/oauth/google', startGoogle);
router.get('/oauth/google/callback', asyncHandler(googleCallback));
router.get('/oauth/apple', startApple);
router.post('/oauth/apple/callback', asyncHandler(appleCallback));
router.post('/oauth/exchange', validate(rules.oauthExchange), asyncHandler(exchange));

module.exports = router;
