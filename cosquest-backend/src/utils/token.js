const jwt = require('jsonwebtoken');

/**
 * tokenVersion is embedded so logout can work with plain stateless JWTs:
 * see src/middleware/auth.js (checks it matches the user's current value)
 * and POST /api/auth/logout (bumps the user's value, invalidating this token).
 */
function signToken(userId, tokenVersion) {
  // Sessions intentionally have no time-based expiry. They remain valid until
  // logout increments tokenVersion, which invalidates every previous token.
  return jwt.sign({ sub: userId, tokenVersion }, process.env.JWT_SECRET);
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { signToken, verifyToken };
