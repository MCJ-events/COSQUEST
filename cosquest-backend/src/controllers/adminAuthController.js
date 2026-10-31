// Signing in to the admin dashboard (super admins only), with its own
// session that never signs the phone out (see src/utils/adminToken.js).
//
//   POST /api/admin/auth/login     { email, password }  -> { token, admin }
//   POST /api/admin/auth/exchange  app token (Bearer)    -> { token, admin }
//                                  (for Google / Apple accounts with no password)
//   GET  /api/admin/auth/me        admin token          -> { admin }
//   POST /api/admin/auth/logout    admin token          -> { signedOut: true }
//
// One dashboard session per admin: signing in again ends the previous one.
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { newAdminSessionId, signAdminToken } = require('../utils/adminToken');
const { isSuperAdmin } = require('../utils/superAdmin');
const { recordAudit } = require('../utils/audit');

const WRONG = 'Wrong email or password.';

// Same hashing library as the app's own sign-in (authController).
async function passwordMatches(password, hash) {
  if (!hash || typeof password !== 'string') return false;
  return bcrypt.compare(password, hash);
}

function adminJson(user) {
  const p = user.profile || {};
  return {
    id: String(user._id),
    username: p.username || null,
    name: p.displayName || [p.firstName, p.lastName].filter(Boolean).join(' ') || p.username || 'Admin',
    email: user.email || null,
    avatarKey: p.avatarKey || null,
    avatarPhotoUrl: p.avatarPhotoUrl || null,
    role: 'super_admin',
    adminSince: user.adminSince || null,
  };
}

async function startSession(user, req, via) {
  user.adminSessionId = newAdminSessionId();
  await user.save();
  await recordAudit(user, {
    action: 'admin.signin',
    area: 'auth',
    target: { type: 'admin', id: user._id, label: user.profile?.username ? `@${user.profile.username}` : null },
    meta: { via, userAgent: String(req.headers['user-agent'] || '').slice(0, 200) },
  });
  return { token: signAdminToken(user), admin: adminJson(user) };
}

async function login(req, res) {
  const email = String(req.body.email).trim().toLowerCase();
  const user = await User.findOne({ email });
  if (!user || !(await passwordMatches(req.body.password, user.passwordHash))) {
    return res.status(401).json({ error: WRONG });
  }
  if (!isSuperAdmin(user)) return res.status(403).json({ error: 'This account is not a super admin.', code: 'not_admin' });
  return res.json(await startSession(user, req, 'password'));
}

// An app session (requireAuth) swaps itself for a dashboard session; the app
// session stays as it is.
async function exchange(req, res) {
  if (!isSuperAdmin(req.user)) return res.status(403).json({ error: 'This account is not a super admin.', code: 'not_admin' });
  const user = await User.findById(req.user._id);
  return res.json(await startSession(user, req, 'app_session'));
}

async function me(req, res) {
  return res.json({ admin: adminJson(req.admin) });
}

async function logout(req, res) {
  req.admin.adminSessionId = null;
  await req.admin.save();
  await recordAudit(req.admin, { action: 'admin.signout', area: 'auth', target: { type: 'admin', id: req.admin._id } });
  return res.json({ signedOut: true });
}

module.exports = { login, exchange, me, logout, adminJson };
