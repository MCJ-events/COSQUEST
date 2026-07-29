const rateLimit = require('express-rate-limit');

/**
 * Brute-force protection for auth endpoints, keyed by IP.
 * NOTE: if this ever runs behind a reverse proxy/load balancer (Heroku,
 * Nginx, etc.) you MUST set `app.set('trust proxy', 1)` in server.js first,
 * otherwise every request appears to come from the proxy's single IP and
 * one real user could lock out everyone else.
 */

const loginLimiter = rateLimit({
  windowMs: 2 * 60 * 60 * 1000, // 2 hours
  max: 10, // 10 attempts per IP per window
  standardHeaders: true, // RateLimit-* response headers
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in a couple of hours.' },
});

const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // 10 account creations per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many accounts created from this address. Please try again later.' },
});

module.exports = { loginLimiter, signupLimiter };
