const { verifyToken } = require('../utils/token');
const userModel = require('../models/userModel');

/**
 * Expects: Authorization: Bearer <token>
 * On success, attaches req.userId and req.user (full Mongoose doc, incl.
 * passwordHash - controllers must sanitize before sending anything back).
 *
 * Also enforces logout: a token is only valid if the tokenVersion embedded
 * in it at sign-time still matches the user's current tokenVersion. Logging
 * out (POST /api/auth/logout) bumps that number, which instantly invalidates
 * this and every other previously-issued token for the account.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header. Expected: Bearer <token>' });
  }

  try {
    const decoded = verifyToken(token);
    const user = await userModel.findById(decoded.sub);
    if (!user) {
      return res.status(401).json({ error: 'Token is valid but the user no longer exists.' });
    }
    if (decoded.tokenVersion !== user.tokenVersion) {
      return res.status(401).json({ error: 'This session has been logged out. Please log in again.' });
    }
    req.userId = user.id;
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function requireCompletedOnboarding(req, res, next) {
  if (!req.user?.onboardingComplete) {
    return res.status(403).json({ error: 'Please complete onboarding before accessing this feature.' });
  }
  return next();
}

module.exports = { requireAuth, requireCompletedOnboarding };
