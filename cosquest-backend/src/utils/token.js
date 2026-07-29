const jwt = require('jsonwebtoken');

/**
 * tokenVersion is embedded so logout can work with plain stateless JWTs:
 * see src/middleware/auth.js (checks it matches the user's current value)
 * and POST /api/auth/logout (bumps the user's value, invalidating this token).
 */
function signToken(userId, tokenVersion) {
  return jwt.sign({ sub: userId, tokenVersion }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { signToken, verifyToken };
