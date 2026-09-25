const jwt = require('jsonwebtoken');
const crypto = require('crypto');

/**
 * tokenVersion is embedded so logout can work with plain stateless JWTs:
 * see src/middleware/auth.js (checks it matches the user's current value)
 * and POST /api/auth/logout (bumps the user's value, invalidating this token).
 *
 * sessionId enforces single-device sign-in: see generateSessionId below and
 * src/middleware/auth.js (checks it matches user.currentSessionId).
 */
function signToken(userId, tokenVersion, sessionId) {
  // Sessions intentionally have no time-based expiry. They remain valid until
  // logout increments tokenVersion, or another sign-in rotates sessionId,
  // either of which invalidates every previous token.
  return jwt.sign({ sub: userId, tokenVersion, sessionId }, process.env.JWT_SECRET);
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

/**
 * Call this on every fresh sign-in (signup, login, OAuth) and on
 * password/email change, then save it to user.currentSessionId and embed
 * the same value in the token signToken() returns. Whoever holds the
 * previous sessionId is signed out the next time requireAuth checks them.
 */
function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { signToken, verifyToken, generateSessionId };
