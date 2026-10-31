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

module.exports = { SUPER_ADMIN, isSuperAdmin };
