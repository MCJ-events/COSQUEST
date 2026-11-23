// CosCoin wallets for admins (Admin > Ledger & approvals > Wallets): flagged and frozen
// wallets, freeze one (fraud), unfreeze after review. Audited.
//   GET  /api/admin/wallets?show=flagged|frozen
//   POST /api/admin/wallets/freeze     { username, reason }
//   POST /api/admin/wallets/unfreeze   { userId, reason }
const mongoose = require('mongoose');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const rewards = require('../utils/coscoinRewards');
const { recordAudit } = require('../utils/audit');

function answer(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  throw error;
}

async function list(req, res) {
  const filter = req.query.show === 'frozen' ? { frozen: true } : { $or: [{ frozen: true }, { 'flags.0': { $exists: true } }] };
  const rows = await Wallet.find(filter).sort({ updatedAt: -1 }).limit(200).lean();
  const users = await User.find({ _id: { $in: rows.map((w) => w.user) } }).select('profile.username').lean();
  const names = new Map(users.map((u) => [String(u._id), u.profile?.username ? `@${u.profile.username}` : String(u._id)]));
  return res.json({
    wallets: rows.map((w) => ({ userId: String(w.user), member: names.get(String(w.user)) || String(w.user), ...rewards.split(w), frozen: Boolean(w.frozen), frozenReason: w.frozenReason || null, flags: (w.flags || []).slice(-5).reverse().map((f) => ({ reason: f.reason, by: f.by, at: f.at })) })),
  });
}

async function freeze(req, res) {
  const username = String(req.body?.username || '').trim().replace(/^@/, '').toLowerCase();
  if (!username) return res.status(400).json({ error: 'Which member? (username)', code: 'username_required' });
  const user = await User.findOne({ 'profile.usernameNormalized': username }).select('_id profile.username').lean();
  if (!user) return res.status(404).json({ error: 'Member not found.', code: 'member_not_found' });
  try {
    await rewards.flag(user._id, { reason: req.body?.reason, by: `admin:${req.admin._id}`, freeze: true });
    const event = await recordAudit(req.admin, { action: 'wallet.freeze', area: 'payments', target: { type: 'user', id: user._id, label: `@${user.profile?.username}` }, reason: String(req.body?.reason || '') });
    return res.json({ ok: true, auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

async function unfreeze(req, res) {
  if (!mongoose.isValidObjectId(req.body?.userId)) return res.status(400).json({ error: 'userId is required.', code: 'bad_user' });
  try {
    await rewards.unfreeze(req.body.userId, { reason: req.body?.reason, by: `admin:${req.admin._id}` });
    const event = await recordAudit(req.admin, { action: 'wallet.unfreeze', area: 'payments', target: { type: 'user', id: req.body.userId, label: req.body.userId }, reason: String(req.body?.reason || '') });
    return res.json({ ok: true, auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

module.exports = { list, freeze, unfreeze };
