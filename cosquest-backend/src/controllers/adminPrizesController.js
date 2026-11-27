// Admin > Ledger & approvals > Payouts (PrizeClaim contract).
//   GET  /api/admin/prizes?status=               masked list (finance approvers can read)
//   POST /api/admin/prizes/:id/verify            submitted -> verified
//   POST /api/admin/prizes/:id/reject            { reason }
//   POST /api/admin/prizes/:id/payout-request    -> Approvals (second admin; finance above the limit)
//   POST /api/admin/prizes/:id/paid              { reference } after the hold
//   POST /api/admin/prizes/:id/reveal            super admins only, audited: full bank and tax numbers
//   GET  /api/admin/prizes/export                CSV (masked)
const mongoose = require('mongoose');
const prizes = require('../utils/prizes');
const { recordAudit } = require('../utils/audit');
const { isSuperAdmin } = require('../utils/superAdmin');

function answer(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  throw error;
}
const audit = (req, action, c, reason = '') => recordAudit(req.admin, { action, area: 'payments', target: { type: 'prize', id: c._id, label: `PC-${c.number}` }, reason: String(reason || '') });

async function list(req, res) {
  return res.json({ prizes: await prizes.list({ status: req.query.status }) });
}

function step(fn, action) {
  return async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.prizeId)) return res.status(404).json({ error: 'Prize not found.' });
    try {
      const out = await fn(req);
      const c = out.claim || out;
      const event = await audit(req, action, c, req.body?.reason || req.body?.reference || '');
      return res.json({ ok: true, ...(out.request ? { request: out.request } : {}), auditEvent: `EV-${event.number}` });
    } catch (error) {
      return answer(res, error);
    }
  };
}

const verify = step((req) => prizes.verify(req.admin, req.params.prizeId), 'prize.verify');
const reject = step((req) => prizes.reject(req.admin, req.params.prizeId, req.body?.reason), 'prize.reject');
const paid = step((req) => prizes.markPaid(req.admin, req.params.prizeId, req.body?.reference), 'prize.paid');
const payoutRequest = step(async (req) => {
  const request = await prizes.requestPayout(req.admin, req.params.prizeId, req.body?.reason);
  const claim = await require('../models/PrizeClaim').findById(req.params.prizeId).lean();
  return { claim, request: { id: String(request._id), number: `AP-${request.number}`, title: request.title } };
}, 'approval.request');

async function reveal(req, res) {
  if (!isSuperAdmin(req.admin)) return res.status(403).json({ error: 'Only super admins can see full bank and tax numbers.' });
  if (!mongoose.isValidObjectId(req.params.prizeId)) return res.status(404).json({ error: 'Prize not found.' });
  if (String(req.body?.reason || '').trim().length < 3) return res.status(400).json({ error: 'A reason is required.', code: 'reason_required' });
  try {
    const details = await prizes.reveal(req.params.prizeId);
    const c = await require('../models/PrizeClaim').findById(req.params.prizeId).lean();
    await audit(req, 'prize.reveal', c, req.body.reason);
    return res.json(details);
  } catch (error) {
    return answer(res, error);
  }
}

const cell = (v) => {
  const s = String(v ?? '');
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

async function exportCsv(req, res) {
  const rows = await prizes.list({ status: req.query.status });
  const head = ['Prize', 'Member', 'Quest', 'Place', 'Amount', 'Currency', 'Status', 'Legal name', 'Payout', 'Account last 4', 'Tax form', 'Tax status', 'TIN last 4', 'Country', 'Hold until', 'Paid at', 'Reference'];
  const lines = rows.map((r) => [r.number, r.member, r.quest?.title, r.place, (r.amountCents / 100).toFixed(2), r.currency, r.status, r.identity?.legalName, r.payoutMethod?.type, r.payoutMethod?.accountLast4, r.tax.form, r.tax.status, r.tax.tinLast4, r.tax.country, r.holdUntil ? new Date(r.holdUntil).toISOString().slice(0, 10) : '', r.paidAt ? new Date(r.paidAt).toISOString().slice(0, 10) : '', r.paymentRef].map(cell).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="cosquest-prizes.csv"');
  return res.send(`\uFEFF${[head.join(','), ...lines].join('\n')}`);
}

/**
 * Tax totals for one calendar year (lock-in WE5): prizes PAID per recipient, with the full
 * tax ID for 1099 filing. Super admins only, audited. 1099-MISC reporting from $2,000 a year
 * for prizes paid after 31 Dec 2025 (confirm with the accountant).
 */
async function taxTotals(req, res) {
  if (!isSuperAdmin(req.admin)) return res.status(403).json({ error: 'Only super admins can export tax totals.' });
  const year = Number.parseInt(req.query.year, 10) || new Date().getUTCFullYear();
  if (String(req.query.reason || '').trim().length < 3) return res.status(400).json({ error: 'A reason is required (?reason=...).', code: 'reason_required' });
  const PrizeClaim = require('../models/PrizeClaim');
  const crypto = require('../utils/payeeCrypto');
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const paid = await PrizeClaim.find({ status: 'paid', paidAt: { $gte: from, $lt: to } }).populate('user', 'profile.username').lean();
  const byUser = new Map();
  for (const c of paid) {
    const k = String(c.user?._id || c.user);
    const row = byUser.get(k) || { member: c.user?.profile?.username ? `@${c.user.profile.username}` : k, legalName: c.identity?.legalName, form: c.tax?.form, country: c.tax?.country, sealed: c.tax?.encrypted, total: 0, count: 0 };
    row.total += c.amountCents;
    row.count += 1;
    byUser.set(k, row);
  }
  const threshold = Number.parseInt(process.env.PRIZE_1099_THRESHOLD_CENTS, 10) || 200000;
  const head = ['Year', 'Member', 'Legal name', 'Tax form', 'Tax ID', 'Country', 'Prizes paid', 'Total (USD)', 'Reportable on 1099-MISC'];
  const lines = [...byUser.values()].map((r) => {
    let tin = '';
    try { tin = crypto.open(r.sealed)?.tin || ''; } catch { tin = '(unreadable)'; }
    return [year, r.member, r.legalName, r.form === 'w9' ? 'W-9' : r.form === 'w8ben' ? 'W-8BEN' : '', tin, r.country, r.count, (r.total / 100).toFixed(2), r.form === 'w9' && r.total >= threshold ? 'yes' : 'no'].map(cell).join(',');
  });
  await recordAudit(req.admin, { action: 'prize.tax_export', area: 'payments', target: { type: 'year', id: null, label: String(year) }, reason: String(req.query.reason) });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cosquest-prize-tax-totals-${year}.csv"`);
  return res.send(`\uFEFF${[head.join(','), ...lines].join('\n')}`);
}

module.exports = { list, verify, reject, payoutRequest, paid, reveal, exportCsv, taxTotals };
