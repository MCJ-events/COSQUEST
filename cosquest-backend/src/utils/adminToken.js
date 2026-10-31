// The admin dashboard's own session token.
//
// Sign-in in the app is one device at a time (User.currentSessionId): signing
// in on the website signs the phone out. A super admin opening the dashboard
// must not lose their phone session, so the dashboard gets its OWN token:
//   - signed with ADMIN_JWT_SECRET (or JWT_SECRET when that isn't set);
//   - carries scope 'admin' and the user's adminSessionId (not the app's
//     sessionId), so it never rotates or checks User.currentSessionId;
//   - only /api/admin accepts it (requireSuperAdmin), and requireAuth never
//     does, because it has no app sessionId.
// Signing out of the dashboard, or losing the super admin role, ends it.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const SCOPE = 'admin';
const LIFETIME = process.env.ADMIN_TOKEN_TTL || '12h';

function secret() {
  const value = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;
  if (!value) throw Object.assign(new Error('ADMIN_JWT_SECRET (or JWT_SECRET) is not set.'), { status: 500 });
  return value;
}

function newAdminSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

function signAdminToken(user) {
  return jwt.sign(
    { sub: String(user._id), scope: SCOPE, adminSessionId: user.adminSessionId, tokenVersion: user.tokenVersion },
    secret(),
    { expiresIn: LIFETIME }
  );
}

/** The decoded admin token, or null when it isn't a valid admin token. */
function verifyAdminToken(token) {
  try {
    const decoded = jwt.verify(token, secret());
    return decoded?.scope === SCOPE && decoded.sub && decoded.adminSessionId ? decoded : null;
  } catch {
    return null;
  }
}

module.exports = { signAdminToken, verifyAdminToken, newAdminSessionId, ADMIN_SCOPE: SCOPE };
