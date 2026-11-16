// Finance approvers (payment brief 6.6: two people for money changes).
//
// A "finance approver" (User.platformRole 'finance') is the second person:
// they sign in to the dashboard but only see Ledger & approvals, and can
// approve or reject money changes. They can't request changes, correct the
// ledger, or use any other page (src/middleware/requireSuperAdmin.js).
// Super admins request; finance approvers (or another super admin) approve.
//
//   GET    /api/admin/auth/role                      { role: 'admin' | 'finance' } (both)
//   GET    /api/admin/finance-approvers              super admins only
//   POST   /api/admin/finance-approvers              { username, reason }
//   DELETE /api/admin/finance-approvers/:userId      { reason }
const mongoose = require('mongoose');
const User = require('../models/User');
const { recordAudit } = require('../utils/audit');
const { personJson } = require('./adminOverviewController');

async function myRole(req, res) {
  return res.json({ role: req.admin.platformRole === 'admin' ? 'admin' : 'finance' });
}

async function list(req, res) {
  const rows = await User.find({ platformRole: 'finance' }).select('profile adminSince').limit(100);
  return res.json({ approvers: rows.map((u) => ({ ...personJson(u), since: u.adminSince })) });
}

async function add(req, res) {
  const username = String(req.body.username || '').trim().replace(/^@/, '').toLowerCase();
  const reason = String(req.body.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'A reason is required.', code: 'reason_required' });
  const user = await User.findOne({ 'profile.usernameNormalized': username });
  if (!user) return res.status(404).json({ error: `No member @${username}.`, code: 'unknown_member' });
  if (String(user._id) === String(req.admin._id)) return res.status(409).json({ error: "You can't make yourself your own second approver.", code: 'self' });
  if (user.platformRole === 'admin') return res.status(409).json({ error: 'This person is already a super admin (super admins can approve too).', code: 'already_admin' });
  if (user.platformRole === 'finance') return res.status(409).json({ error: 'This person is already a finance approver.', code: 'already_finance' });
  if (require('../utils/communityRestrictions').suspendedAnswer(user)) return res.status(409).json({ error: 'This account is suspended.', code: 'suspended' });
  const updated = await User.findOneAndUpdate(
    { _id: user._id, platformRole: null },
    { $set: { platformRole: 'finance', adminSince: new Date(), adminAssignedBy: req.admin._id } },
    { new: true }
  );
  if (!updated) return res.status(409).json({ error: 'Their role just changed. Refresh and try again.', code: 'changed' });
  const event = await recordAudit(req.admin, {
    action: 'role.finance_add',
    area: 'roles',
    target: { type: 'user', id: user._id, label: `@${user.profile?.username || username}` },
    reason,
    before: { role: 'member' },
    after: { role: 'finance approver' },
  });
  // They hear about it: nobody holds a money role without knowing.
  require('../models/notificationModel').createForUser(updated._id, 'You are now a CosQuest finance approver: you can see the ledger and approve or reject money changes in the admin dashboard.').catch(() => {});
  return res.status(201).json({ approver: { ...personJson(updated), since: updated.adminSince }, auditEvent: `EV-${event.number}` });
}

async function remove(req, res) {
  if (!mongoose.isValidObjectId(req.params.userId)) return res.status(404).json({ error: 'Not found.' });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'A reason is required.', code: 'reason_required' });
  const updated = await User.findOneAndUpdate(
    { _id: req.params.userId, platformRole: 'finance' },
    // A new adminSessionId ends their dashboard session at once.
    { $set: { platformRole: null, adminSessionId: null } },
    { new: true }
  );
  if (!updated) return res.status(404).json({ error: 'This person is not a finance approver.', code: 'not_finance' });
  const event = await recordAudit(req.admin, {
    action: 'role.finance_remove',
    area: 'roles',
    target: { type: 'user', id: updated._id, label: `@${updated.profile?.username || ''}` },
    reason,
    before: { role: 'finance approver' },
    after: { role: 'member' },
  });
  return res.json({ removed: true, auditEvent: `EV-${event.number}` });
}

module.exports = { myRole, list, add, remove };
