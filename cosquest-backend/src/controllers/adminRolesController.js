// Roles & permissions (super admin dashboard, Phase 5).
//
// Super admins (admin token):
//   GET  /api/admin/roles                                admins, pending invitations, permission matrix, access review
//   POST /api/admin/roles/invitations                    { member: "@username" | email, reason }
//   POST /api/admin/roles/invitations/:id/resend         7 more days, notice again
//   POST /api/admin/roles/invitations/:id/revoke         { reason }
//   POST /api/admin/roles/admins/:userId/revoke          { reason }   (not yourself, never the last admin)
//   POST /api/admin/roles/review                         { note? }    records an access review (next in 30 days)
// The invited person (their APP token - nobody becomes an admin without accepting):
//   GET  /api/admin/invitations/mine
//   POST /api/admin/invitations/:id/accept
//   POST /api/admin/invitations/:id/decline
const mongoose = require('mongoose');
const User = require('../models/User');
const AdminInvitation = require('../models/AdminInvitation');
const CommunitySettings = require('../models/CommunitySettings');
const AuditEvent = require('../models/AuditEvent');
const notificationModel = require('../models/notificationModel');
const { recordAudit } = require('../utils/audit');
const { isSuperAdmin } = require('../utils/superAdmin');
const content = require('../utils/adminContent');
const { personJson } = require('./adminOverviewController');

const WEEK = 7 * 24 * 60 * 60 * 1000;
const REVIEW_EVERY = 30 * 24 * 60 * 60 * 1000;

// The permission matrix shown on the page (what the code enforces).
const MATRIX = [
  { capability: 'Review reports & record decisions', admin: 'allowed', member: 'not_allowed', rank: 'no_access' },
  { capability: 'Delete chat messages', admin: 'any_message', member: 'own_messages', rank: 'no_extra_access' },
  { capability: 'Remove or ban group members', admin: 'allowed', member: 'not_allowed', rank: 'no_access' },
  { capability: 'Mute members & set slow mode', admin: 'allowed', member: 'not_allowed', rank: 'no_access' },
  { capability: 'Manage groups & join approvals', admin: 'allowed', member: 'not_allowed', rank: 'no_access' },
  { capability: 'Manage feed posts', admin: 'allowed', member: 'own_posts', rank: 'no_extra_access' },
  { capability: 'Start a Spark', admin: 'allowed', member: 'allowed', rank: 'no_rank_required' },
  { capability: 'Pin / delete / merge Sparks', admin: 'pending', member: 'not_available', rank: 'no_access' },
  { capability: 'Manage community settings', admin: 'allowed', member: 'not_allowed', rank: 'no_access' },
  { capability: 'Assign admin roles & view audit log', admin: 'allowed', member: 'not_allowed', rank: 'no_access' },
];

function answer(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  throw error;
}

const handle = (user) => (user?.profile?.username ? `@${user.profile.username}` : 'a member');

function invitationJson(inv) {
  return {
    id: String(inv._id),
    user: personJson(inv.user),
    email: inv.user?.email || null,
    role: inv.role,
    reason: inv.reason,
    invitedBy: personJson(inv.invitedBy),
    status: inv.status === 'pending' && inv.expiresAt < new Date() ? 'expired' : inv.status,
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
  };
}

async function overview(req, res) {
  const [admins, invitations, settings] = await Promise.all([
    User.find({ platformRole: 'admin' }).select('profile email adminSince adminAssignedBy lastActiveAt').populate('adminAssignedBy', 'profile').sort({ adminSince: 1 }),
    AdminInvitation.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(50).populate('user', 'profile email').populate('invitedBy', 'profile'),
    CommunitySettings.current(),
  ]);
  return res.json({
    admins: admins.map((a) => ({
      ...personJson(a),
      email: a.email || null,
      role: 'super_admin',
      since: a.adminSince || null,
      assignedBy: personJson(a.adminAssignedBy),
      lastActiveAt: a.lastActiveAt || null,
      you: String(a._id) === req.adminId,
    })),
    invitations: invitations.map(invitationJson),
    matrix: MATRIX,
    accessReview: settings.accessReview?.lastAt
      ? { lastAt: settings.accessReview.lastAt, nextAt: settings.accessReview.nextAt, lastBy: settings.accessReview.lastBy ? String(settings.accessReview.lastBy) : null }
      : null,
  });
}

async function findMember(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  if (value.includes('@') && !value.startsWith('@')) return User.findOne({ email: value.toLowerCase() });
  return User.findOne({ 'profile.usernameNormalized': value.replace(/^@/, '').toLowerCase() });
}

async function invite(req, res) {
  try {
    const reason = content.requireReason(req.body.reason);
    const user = await findMember(req.body.member);
    if (!user || !user.onboardingComplete) content.fail(404, 'No CosQuest member with that @username or email. They need a CosQuest account first.');
    if (isSuperAdmin(user)) content.fail(409, `${handle(user)} is already a super admin.`);
    let invitation;
    try {
      invitation = await AdminInvitation.create({ user: user._id, reason, invitedBy: req.admin._id, expiresAt: new Date(Date.now() + WEEK) });
    } catch (error) {
      if (error?.code === 11000) content.fail(409, `${handle(user)} already has a pending invitation.`);
      throw error;
    }
    notificationModel
      .createForUser(user._id, `${handle(req.admin)} invited you to be a CosQuest super admin. Open the admin dashboard to accept.`, { type: 'system' })
      .catch(() => {});
    const event = await recordAudit(req.admin, {
      action: 'admin.invite',
      area: 'roles',
      target: { type: 'admin', id: user._id, label: handle(user) },
      reason,
      after: { invited: true, role: 'super_admin', expiresAt: invitation.expiresAt },
      meta: { invitationId: String(invitation._id) },
    });
    await invitation.populate([{ path: 'user', select: 'profile email' }, { path: 'invitedBy', select: 'profile' }]);
    return res.status(201).json({ invitation: invitationJson(invitation), auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

async function loadInvitation(id) {
  if (!mongoose.isValidObjectId(id)) content.fail(404, 'Invitation not found.');
  const invitation = await AdminInvitation.findById(id).populate('user', 'profile email platformRole').populate('invitedBy', 'profile');
  if (!invitation) content.fail(404, 'Invitation not found.');
  return invitation;
}

async function resend(req, res) {
  try {
    const invitation = await loadInvitation(req.params.invitationId);
    if (invitation.status !== 'pending') content.fail(409, 'This invitation is no longer pending.');
    invitation.expiresAt = new Date(Date.now() + WEEK);
    await invitation.save();
    notificationModel
      .createForUser(invitation.user._id, `Reminder: you're invited to be a CosQuest super admin. Open the admin dashboard to accept.`, { type: 'system' })
      .catch(() => {});
    await recordAudit(req.admin, { action: 'admin.invite_resend', area: 'roles', target: { type: 'admin', id: invitation.user._id, label: handle(invitation.user) }, after: { expiresAt: invitation.expiresAt } });
    return res.json({ invitation: invitationJson(invitation) });
  } catch (error) {
    return answer(res, error);
  }
}

async function revokeInvitation(req, res) {
  try {
    const reason = content.requireReason(req.body.reason);
    const invitation = await loadInvitation(req.params.invitationId);
    if (invitation.status !== 'pending') content.fail(409, 'This invitation is no longer pending.');
    invitation.status = 'revoked';
    invitation.decidedAt = new Date();
    invitation.revokedBy = req.admin._id;
    await invitation.save();
    const event = await recordAudit(req.admin, {
      action: 'admin.invite_revoke',
      area: 'roles',
      target: { type: 'admin', id: invitation.user._id, label: handle(invitation.user) },
      reason,
      before: { invited: true },
      after: { invited: false },
    });
    return res.json({ invitation: invitationJson(invitation), auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

async function revokeAdmin(req, res) {
  try {
    const reason = content.requireReason(req.body.reason);
    if (!mongoose.isValidObjectId(req.params.userId)) content.fail(404, 'Admin not found.');
    if (req.params.userId === req.adminId) content.fail(400, "You can't remove your own access. Ask another super admin.");
    const user = await User.findById(req.params.userId);
    if (!user || !isSuperAdmin(user)) content.fail(404, 'This person is not a super admin.');
    if ((await User.countDocuments({ platformRole: 'admin' })) <= 1) content.fail(409, 'CosQuest needs at least one super admin.');
    await User.updateOne({ _id: user._id, platformRole: 'admin' }, { $set: { platformRole: null, adminSessionId: null } });
    // Two admins removing each other at the same moment could both pass the
    // check above: if nobody is left, put this one back.
    if ((await User.countDocuments({ platformRole: 'admin' })) < 1) {
      await User.updateOne({ _id: user._id }, { $set: { platformRole: 'admin' } });
      content.fail(409, 'CosQuest needs at least one super admin.');
    }
    // Invitations they sent and nobody has answered yet go with them.
    await AdminInvitation.updateMany(
      { invitedBy: user._id, status: 'pending' },
      { $set: { status: 'revoked', decidedAt: new Date(), revokedBy: req.admin._id } }
    );
    notificationModel.createForUser(user._id, 'Your CosQuest super admin access has been removed.', { type: 'system' }).catch(() => {});
    const event = await recordAudit(req.admin, {
      action: 'admin.revoke',
      area: 'roles',
      target: { type: 'admin', id: user._id, label: handle(user) },
      reason,
      before: { platformRole: 'admin' },
      after: { platformRole: null },
    });
    return res.json({ revoked: true, auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

async function review(req, res) {
  const settings = await CommunitySettings.current();
  const now = new Date();
  const admins = await User.countDocuments({ platformRole: 'admin' });
  await CommunitySettings.updateOne(
    { _id: 'community' },
    { $set: { 'accessReview.lastAt': now, 'accessReview.lastBy': req.admin._id, 'accessReview.nextAt': new Date(now.getTime() + REVIEW_EVERY) }, $inc: { version: 1 } }
  );
  const event = await recordAudit(req.admin, {
    action: 'roles.review',
    area: 'roles',
    target: { type: 'settings', id: 'access-review', label: `${admins} super admin${admins === 1 ? '' : 's'} reviewed` },
    reason: typeof req.body?.note === 'string' ? req.body.note.trim() : '',
    before: { lastAt: settings.accessReview?.lastAt || null },
    after: { lastAt: now },
  });
  return res.json({ accessReview: { lastAt: now, nextAt: new Date(now.getTime() + REVIEW_EVERY) }, auditEvent: `EV-${event.number}` });
}

// ---------- the invited person (app token) ----------
async function myInvitations(req, res) {
  const rows = await AdminInvitation.find({ user: req.user._id, status: 'pending', expiresAt: { $gt: new Date() } }).populate('invitedBy', 'profile');
  return res.json({ invitations: rows.map((inv) => ({ id: String(inv._id), role: inv.role, reason: inv.reason, invitedBy: personJson(inv.invitedBy), expiresAt: inv.expiresAt })) });
}

function decideMine(accept) {
  return async (req, res) => {
    try {
      const invitation = await loadInvitation(req.params.invitationId);
      if (String(invitation.user._id) !== String(req.user._id)) content.fail(404, 'Invitation not found.');
      if (invitation.status !== 'pending') content.fail(409, 'This invitation is no longer pending.');
      if (invitation.expiresAt < new Date()) content.fail(410, 'This invitation has expired. Ask a super admin to send a new one.');
      // An invitation is only as good as the admin who sent it.
      if (accept) {
        const inviter = await User.findById(invitation.invitedBy?._id || invitation.invitedBy).select('platformRole');
        if (!isSuperAdmin(inviter)) content.fail(409, 'The admin who invited you no longer has admin access. Ask a current super admin for a new invitation.');
      }
      invitation.status = accept ? 'accepted' : 'declined';
      invitation.decidedAt = new Date();
      await invitation.save();
      if (accept) {
        await User.updateOne(
          { _id: req.user._id },
          { $set: { platformRole: 'admin', adminSince: new Date(), adminAssignedBy: invitation.invitedBy?._id || invitation.invitedBy } }
        );
      }
      const me = await User.findById(req.user._id);
      await recordAudit(me, {
        action: accept ? 'admin.grant' : 'admin.invite_decline',
        area: 'roles',
        target: { type: 'admin', id: me._id, label: handle(me) },
        reason: invitation.reason,
        before: { platformRole: null },
        after: { platformRole: accept ? 'admin' : null },
        meta: { invitedBy: String(invitation.invitedBy?._id || invitation.invitedBy), via: 'invitation' },
      });
      return res.json({ accepted: accept, role: accept ? 'super_admin' : null });
    } catch (error) {
      return answer(res, error);
    }
  };
}

module.exports = {
  overview,
  invite,
  resend,
  revokeInvitation,
  revokeAdmin,
  review,
  myInvitations,
  acceptMine: decideMine(true),
  declineMine: decideMine(false),
  MATRIX,
};
