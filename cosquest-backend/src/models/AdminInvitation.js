const mongoose = require('mongoose');

/**
 * An invitation to become a platform super admin (Roles & permissions).
 * Only an existing super admin can send one; it grants nothing until the
 * invited person accepts it, signed in as themselves
 * (POST /api/admin/invitations/:id/accept). Expires after 7 days.
 */
const adminInvitationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['super_admin'], default: 'super_admin' },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'revoked', 'declined'], default: 'pending' },
    expiresAt: { type: Date, required: true },
    decidedAt: { type: Date, default: null },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// One pending invitation per person.
adminInvitationSchema.index({ user: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });
// Roles & permissions: pending invitations, newest first.
adminInvitationSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('AdminInvitation', adminInvitationSchema);
