const { verifyToken } = require('../utils/token');
const userModel = require('../models/userModel');

/**
 * Used by every onboarding-step endpoint (profile, avatar, faction,
 * interests, preferences, onboarding/complete). These have to work in two
 * situations:
 *  - BEFORE login: right after signup, no token exists yet, and no
 *    server-generated id is handed out to use as a stand-in credential
 *    either - onboarding is identified using the `email` the client already
 *    has (the same one just typed into the signup form).
 *  - AFTER login: editing profile/faction/interests later (the front-end
 *    allows changing faction/interests after onboarding) - identified the
 *    normal way, via Authorization: Bearer <token>.
 * A Bearer token always wins if both are somehow present.
 */
async function identifyUser(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme === 'Bearer' && token) {
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
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }
  }

  const email = req.body?.email || req.query?.email;
  if (!email) {
    return res.status(401).json({
      error: 'Provide the email you signed up with (before login) or an Authorization Bearer token (after login).',
    });
  }

  const user = await userModel.findByEmail(email);
  if (!user) {
    return res.status(404).json({ error: 'No account found for that email.' });
  }
  req.userId = user.id;
  req.user = user;
  return next();
}

module.exports = { identifyUser };
