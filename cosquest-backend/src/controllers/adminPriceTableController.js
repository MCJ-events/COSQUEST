// The Costcoin price table.
//   GET  /api/admin/price-table             current table (every bundle) + history
//   POST /api/admin/price-table/requests    { bundles: [{ id, name, price, costcoin, status, note }], reason }
//   GET  /api/costcoin/bundles              (members) the bundles on sale and the price version
const priceTable = require('../utils/priceTable');
const { recordAudit } = require('../utils/audit');

async function getTable(req, res) {
  const [current, history] = await Promise.all([priceTable.current(), priceTable.history()]);
  return res.json({ current, history });
}

async function requestTable(req, res) {
  try {
    const request = await priceTable.requestChange(req.admin, req.body || {});
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

async function bundlesOnSale(req, res) {
  return res.json(await priceTable.onSale());
}

module.exports = { getTable, requestTable, bundlesOnSale };
