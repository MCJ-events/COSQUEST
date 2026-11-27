// Official rules.
//   GET  /api/rules                  (public) the current version, or { rules: null }
//   GET  /api/rules/:version         (public) an older version
//   GET  /api/admin/rules            current + history
//   POST /api/admin/rules/requests   { title, body, reason }  -> waits for a second admin
const rules = require('../utils/officialRules');
const { recordAudit } = require('../utils/audit');

async function current(req, res) {
  return res.json({ rules: await rules.current() });
}

async function version(req, res) {
  const found = await rules.byVersion(req.params.version);
  if (!found) return res.status(404).json({ error: 'No such version of the rules.' });
  return res.json({ rules: found });
}

async function admin(req, res) {
  const [now, history] = await Promise.all([rules.current(), rules.history()]);
  return res.json({ current: now, history });
}

async function requestPublish(req, res) {
  try {
    const request = await rules.requestPublish(req.admin, req.body || {});
    const event = await recordAudit(req.admin, { action: 'approval.request', area: 'payments', target: { type: 'approval', id: request._id, label: `AP-${request.number}` }, reason: request.reason, after: { title: request.title } });
    return res.status(201).json({ request: { id: String(request._id), number: `AP-${request.number}`, title: request.title, status: request.status }, auditEvent: `EV-${event.number}` });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
    throw error;
  }
}

module.exports = { current, version, admin, requestPublish };
