// Disputes (chargebacks): Admin > Ledger & approvals > Disputes.
//   GET  /api/admin/disputes?outcome=open|won|lost
//   POST /api/admin/disputes/:id/unfreeze   { reason }  (the member can spend CosCoin again)
const mongoose = require('mongoose');
const Dispute = require('../models/Dispute');
const User = require('../models/User');
const disputes = require('../utils/disputes');
const { recordAudit } = require('../utils/audit');

async function list(req, res) {
  // Disputes that arrived before their payment was recorded are matched again first.
  await require('../utils/disputes').rematchUnknown().catch((error) => console.error('[disputes] rematch failed:', error.message));
  const filter = ['open', 'won', 'lost'].includes(req.query.outcome) ? { outcome: req.query.outcome } : {};
  const rows = await Dispute.find(filter).sort({ openedAt: -1 }).limit(200).lean();
  const users = await User.find({ _id: { $in: rows.map((r) => r.user).filter(Boolean) } }).select('profile.username').lean();
  const names = new Map(users.map((u) => [String(u._id), u.profile?.username ? `@${u.profile.username}` : String(u._id)]));
  return res.json({ disputes: rows.map((r) => ({ ...disputes.disputeJson(r), member: r.user ? names.get(String(r.user)) || null : null })) });
}

async function unfreeze(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Dispute not found.' });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'A reason is required.', code: 'reason_required' });
  try {
    const dispute = await disputes.unfreeze(req.params.id, req.admin, reason);
    const event = await recordAudit(req.admin, { action: 'wallet.unfreeze', area: 'payments', target: { type: 'dispute', id: dispute._id, label: dispute.stripeDisputeId }, reason });
    return res.json({ dispute: disputes.disputeJson(dispute), auditEvent: `EV-${event.number}` });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
    throw error;
  }
}

module.exports = { list, unfreeze };
