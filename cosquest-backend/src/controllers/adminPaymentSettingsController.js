// Money settings (Admin > Ledger & approvals > Settings).
//   GET  /api/admin/payment-settings            current (nulls = OPEN) + history
//   POST /api/admin/payment-settings/requests   { platformSharePercent, payoutApprovalLimitDollars, note?, reason }
//                                               -> an approval request (another admin approves)
const paymentSettings = require('../utils/paymentSettings');
const { recordAudit } = require('../utils/audit');

async function getSettings(req, res) {
  const [current, history] = await Promise.all([paymentSettings.current(), paymentSettings.history()]);
  return res.json({ current, history });
}

async function requestSettings(req, res) {
  try {
    const request = await paymentSettings.requestChange(req.admin, req.body || {});
    const event = await recordAudit(req.admin, {
      action: 'approval.request',
      area: 'payments',
      target: { type: 'approval', id: request._id, label: `AP-${request.number}` },
      reason: request.reason,
      after: { title: request.title, changes: request.changes },
    });
    return res.status(201).json({ request: { id: String(request._id), number: `AP-${request.number}`, title: request.title, status: request.status }, auditEvent: `EV-${event.number}` });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
    throw error;
  }
}

module.exports = { getSettings, requestSettings };
