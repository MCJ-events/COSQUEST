// Platform super admins (the admin dashboard), beside src/utils/roomRoles.js:
// roomRoles answers "is this person an admin of THIS room"; this answers "is
// this person a super admin of ALL of CosQuest". The two never mix: a room or
// group admin is not a super admin, and faction rank never makes anyone one.
//
// The role is User.platformRole = 'admin', given only by an existing super
// admin (Roles & permissions) or, for the first one, scripts/setSuperAdmin.js.

const SUPER_ADMIN = 'admin';

function isSuperAdmin(user) {
  return user?.platformRole === SUPER_ADMIN;
}

// Finance approvers (platformRole 'finance'): the second person for money
// changes (payment brief 6.6). They use only Ledger & approvals.
const FINANCE = 'finance';

function isFinanceApprover(user) {
  return user?.platformRole === FINANCE;
}

/** Can sign in to the dashboard at all (what they may use is in requireSuperAdmin). */
function canUseDashboard(user) {
  return isSuperAdmin(user) || isFinanceApprover(user);
}

// What a finance approver may call (method + path under /api/admin).
const FINANCE_ROUTES = [
  ['GET', /^\/auth\/(me|role)$/],
  ['POST', /^\/auth\/logout$/],
  ['GET', /^\/ledger\/(transactions|balances|check|export)$/],
  ['GET', /^\/regions$/],
  ['GET', /^\/payment-settings$/],
  ['GET', /^\/price-table$/],
  ['GET', /^\/item-catalog$/],
  ['GET', /^\/disputes$/],
  ['GET', /^\/ledger\/stripe-check$/],
  ['GET', /^\/approvals$/],
  ['POST', /^\/approvals\/[a-f\d]{24}\/(approve|reject)$/i],
];

function financeMayUse(method, path) {
  return FINANCE_ROUTES.some(([m, pattern]) => m === method && pattern.test(path));
}

module.exports = { SUPER_ADMIN, FINANCE, isSuperAdmin, isFinanceApprover, canUseDashboard, financeMayUse };
