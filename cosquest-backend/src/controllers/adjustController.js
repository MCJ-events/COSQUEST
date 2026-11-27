// POST /api/admin/wallets/adjustments  { username, amount, reason }
// Adds or removes CosCoin for one member once a second admin (or the finance approver) approves.
const adjust = require('../utils/coscoinAdjust');
const { recordAudit } = require('../utils/audit');

async function requestAdjustment(req, res) {
  try {
    const request = await adjust.request(req.admin, req.body || {});
    const event = await recordAudit(req.admin, { action: 'approval.request', area: 'payments', target: { type: 'approval', id: request._id, label: `AP-${request.number}` }, reason: request.reason, after: { title: request.title } });
    return res.status(201).json({ request: { id: String(request._id), number: `AP-${request.number}`, title: request.title, status: request.status }, auditEvent: `EV-${event.number}` });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
    throw error;
  }
}

module.exports = { requestAdjustment };
