const User = require('../models/User');
const { verifyAdminToken } = require('../utils/adminToken');
const { isSuperAdmin, isFinanceApprover, financeMayUse } = require('../utils/superAdmin');

/**
 * Every /api/admin route (except signing in): a valid ADMIN token
 * (src/utils/adminToken.js) from someone who is STILL a super admin, or a
 * finance approver on one of their few routes (src/utils/superAdmin.js
 * financeMayUse).
 *
 *   Authorization: Bearer <admin token>
 *
 * On success: req.admin (the user document), req.adminId.
 * 401 for a missing, expired or signed-out token; 403 when the person is no
 * longer a super admin (the role was revoked after the token was issued).
 */
async function requireSuperAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Sign in to the admin dashboard.', code: 'admin_signin' });
  }
  const decoded = verifyAdminToken(token);
  if (!decoded) return res.status(401).json({ error: 'Your admin session has expired. Sign in again.', code: 'admin_signin' });

  const user = await User.findById(decoded.sub);
  if (!user || decoded.tokenVersion !== user.tokenVersion || !user.adminSessionId || decoded.adminSessionId !== user.adminSessionId) {
    return res.status(401).json({ error: 'Your admin session has ended. Sign in again.', code: 'admin_signin' });
  }
  // Finance approvers: only Ledger & approvals (see, approve, reject), and
  // not while their account is suspended.
  if (!isSuperAdmin(user) && isFinanceApprover(user)) {
    const suspended = require('../utils/communityRestrictions').suspendedAnswer(user);
    if (suspended) return res.status(403).json({ ...suspended, error: 'Your account is suspended, so your finance approver access is paused.' });
  }
  if (!isSuperAdmin(user) && !(isFinanceApprover(user) && financeMayUse(req.method, req.path))) {
    return res.status(403).json({ error: isFinanceApprover(user) ? 'Finance approvers can only use Ledger & approvals.' : 'Your super admin access has been removed.', code: isFinanceApprover(user) ? 'finance_only' : 'not_admin' });
  }

  req.admin = user;
  req.adminId = String(user._id);
  return next();
}

module.exports = { requireSuperAdmin };
