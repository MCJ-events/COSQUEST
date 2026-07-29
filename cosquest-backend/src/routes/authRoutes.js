const express = require('express');
const { signup, login, logout } = require('../controllers/authController');
const { signupLimiter, loginLimiter } = require('../middleware/rateLimiter');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.post('/signup', signupLimiter, asyncHandler(signup));
router.post('/login', loginLimiter, asyncHandler(login));
router.post('/logout', requireAuth, asyncHandler(logout));

module.exports = router;
