// Money admin (super admin dashboard): the ledger, regions and approvals.
//
//   GET  /api/admin/ledger/transactions?book&account&kind&from&to&offset
//   GET  /api/admin/ledger/balances?book&prefix
//   GET  /api/admin/ledger/check                     debits = credits?
//   GET  /api/admin/ledger/export?book&from&to       CSV, one row per line (spreadsheets)
//   POST /api/admin/ledger/transactions/:txId/reverse { reason }   a correction (never an edit)
//   GET  /api/admin/regions                          the region table (paid quests)
//   POST /api/admin/regions/requests                 { changes: [{ region, name?, status, note? }], reason }
//   GET  /api/admin/approvals?status
//   POST /api/admin/approvals/:requestId/approve     { note? }   another admin only
//   POST /api/admin/approvals/:requestId/reject      { note }
//   POST /api/admin/approvals/:requestId/withdraw    the requester
const mongoose = require('mongoose');
const LedgerTransaction = require('../models/LedgerTransaction');
const RegionRule = require('../models/RegionRule');
const ApprovalRequest = require('../models/ApprovalRequest');
const User = require('../models/User');
const ledger = require('../utils/ledger');
const approvals = require('../utils/approvals');
const { mode } = require('../utils/eligibility');
const { recordAudit } = require('../utils/audit');

const PAGE = 50;

function answer(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  throw error;
}

function range(query) {
  const created = {};
  if (query.from && !Number.isNaN(Date.parse(query.from))) created.$gte = new Date(query.from);
  if (query.to && !Number.isNaN(Date.parse(query.to))) created.$lte = new Date(query.to);
  return Object.keys(created).length ? { createdAt: created } : {};
}

function txFilter(query) {
  return {
    ...range(query),
    ...(['money', 'costcoin'].includes(query.book) ? { book: query.book } : {}),
    ...(query.kind ? { kind: String(query.kind).slice(0, 60) } : {}),
    ...(query.account ? { 'lines.account': String(query.account).slice(0, 120) } : {}),
  };
}

// ---------- ledger ----------

async function transactions(req, res) {
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const filter = txFilter(req.query);
  const [rows, total] = await Promise.all([
    LedgerTransaction.find(filter).sort({ createdAt: -1, number: -1 }).skip(offset).limit(PAGE),
    LedgerTransaction.countDocuments(filter),
  ]);
  return res.json({ transactions: rows.map(ledger.txJson), total, offset, pageSize: PAGE });
}

async function balances(req, res) {
  const book = ['money', 'costcoin'].includes(req.query.book) ? req.query.book : null;
  return res.json({ balances: await ledger.balances({ book, prefix: req.query.prefix ? String(req.query.prefix) : null }) });
}

async function check(req, res) {
  return res.json(await ledger.check());
}

const csvCell = (value) => {
  const s = value == null ? '' : String(value);
  // Spreadsheet-safe: quote, and neutralise formulas (=, +, -, @).
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

// Finance's sheets (src/utils/ledgerExport.js): ?book=money (Cash Ledger, the
// default) or ?book=costcoin (CosCoin Ledger), same columns and order as the
// CosQuest Sample Ledger, with account names, usernames and quest titles.
async function exportCsv(req, res) {
  const { financeRows, toCsv } = require('../utils/ledgerExport');
  const chart = require('../utils/ledgerAccounts');
  const book = req.query.book === 'costcoin' ? 'costcoin' : 'money';
  const rows = await LedgerTransaction.find({ ...txFilter(req.query), book }).sort({ createdAt: 1, number: 1 }).limit(50000).lean();
  const ids = { users: new Set(), quests: new Set(), txs: new Set() };
  for (const tx of rows) {
    if (tx.user) ids.users.add(String(tx.user));
    (tx.approvedBy || []).forEach((id) => ids.users.add(String(id)));
    if (tx.quest) ids.quests.add(String(tx.quest));
    if (tx.linkedTx) ids.txs.add(String(tx.linkedTx));
    for (const l of tx.lines) {
      const account = chart.normalize(l.account);
      if (account.startsWith('2010:')) ids.quests.add(account.slice(5));
      if (account.startsWith('CC-WALLET:')) ids.users.add(account.slice(10));
    }
  }
  const valid = (set) => [...set].filter((id) => mongoose.isValidObjectId(id));
  const [users, quests, linked] = await Promise.all([
    User.find({ _id: { $in: valid(ids.users) } }).select('profile.username').lean(),
    require('../models/Quest').find({ _id: { $in: valid(ids.quests) } }).select('title').lean(),
    LedgerTransaction.find({ _id: { $in: valid(ids.txs) } }).select('number').lean(),
  ]);
  const names = {
    users: Object.fromEntries(users.map((u) => [String(u._id), u.profile?.username ? `@${u.profile.username}` : String(u._id)])),
    quests: Object.fromEntries(quests.map((q) => [String(q._id), q.title])),
    txs: Object.fromEntries(linked.map((t) => [String(t._id), `TX-${t.number}`])),
  };
  const csv = toCsv(financeRows(rows, book, names));
  await recordAudit(req.admin, { action: 'ledger.export', area: 'payments', target: { type: 'ledger', id: null, label: book === 'costcoin' ? 'CosCoin Ledger export' : 'Cash Ledger export' }, meta: { rows: rows.length, ...req.query } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cosquest-${book === 'costcoin' ? 'costcoin' : 'cash'}-ledger-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.send(csv);
}

// The previous export (one row per line, internal names): kept for engineers.
async function exportLinesCsv(req, res) {
  const rows = await LedgerTransaction.find(txFilter(req.query)).sort({ createdAt: 1, number: 1 }).limit(50000);
  const header = ['transaction', 'date', 'kind', 'book', 'currency', 'account', 'debit', 'credit', 'order', 'quest', 'user', 'processor_ref', 'jurisdiction', 'price_version', 'reverses', 'memo'];
  const lines = [header.join(',')];
  for (const tx of rows) {
    for (const l of tx.lines) {
      lines.push([ledger.label(tx), tx.createdAt.toISOString(), tx.kind, tx.book, tx.currency, l.account, l.debit, l.credit, tx.order, tx.quest, tx.user, tx.processorRef, tx.jurisdiction, tx.priceVersion, tx.reverses, tx.memo].map(csvCell).join(','));
    }
  }
  await recordAudit(req.admin, { action: 'ledger.export', area: 'payments', target: { type: 'ledger', id: null, label: 'Ledger export' }, meta: { rows: rows.length, ...req.query } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cosquest-ledger-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.send(lines.join('\n'));
}

async function reverseTx(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.txId)) return res.status(404).json({ error: 'Ledger transaction not found.' });
    // A correction needs a second person (Mark): this asks; another admin or
    // the finance approver approves it in Approvals, and only then is it recorded.
    const request = await require('../utils/ledgerCorrections').requestReversal(req.admin, req.params.txId, req.body.reason);
    const event = await recordAudit(req.admin, {
      action: 'approval.request',
      area: 'payments',
      target: { type: 'approval', id: request._id, label: `AP-${request.number}` },
      reason: request.reason,
      after: { title: request.title, transaction: request.changes.number },
    });
    return res.status(202).json({ request: { id: String(request._id), number: `AP-${request.number}`, title: request.title, status: request.status }, auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

// ---------- regions ----------

async function regions(req, res) {
  const rows = await RegionRule.find().sort({ region: 1 });
  return res.json({
    mode: mode(),
    regions: rows.map((r) => ({ region: r.region, name: r.name, status: r.status, note: r.note, updatedAt: r.updatedAt })),
  });
}

async function requestRegions(req, res) {
  try {
    const request = await approvals.requestRegionChanges(req.admin, { changes: req.body.changes, reason: req.body.reason });
    const event = await recordAudit(req.admin, {
      action: 'approval.request',
      area: 'payments',
      target: { type: 'approval', id: request._id, label: approvals.approvalLabel(request) },
      reason: request.reason,
      after: { title: request.title, changes: request.changes },
    });
    return res.status(201).json({ request: await requestJson(request), auditEvent: `EV-${event.number}` });
  } catch (error) {
    return answer(res, error);
  }
}

// ---------- approvals ----------

async function requestJson(r) {
  const people = await User.find({ _id: { $in: [r.requestedBy, r.decidedBy].filter(Boolean) } }).select('profile').lean();
  const name = (id) => {
    const p = people.find((u) => String(u._id) === String(id))?.profile || {};
    return id ? p.displayName || p.username || 'Admin' : null;
  };
  return {
    id: String(r._id),
    number: approvals.approvalLabel(r),
    kind: r.kind,
    title: r.title,
    changes: r.changes,
    reason: r.reason,
    status: r.status,
    requestedBy: { id: String(r.requestedBy), name: name(r.requestedBy) },
    decidedBy: r.decidedBy ? { id: String(r.decidedBy), name: name(r.decidedBy) } : null,
    decisionNote: r.decisionNote,
    decidedAt: r.decidedAt,
    createdAt: r.createdAt,
  };
}

async function listApprovals(req, res) {
  const status = ['pending', 'approved', 'rejected', 'withdrawn'].includes(req.query.status) ? req.query.status : 'pending';
  const rows = await ApprovalRequest.find({ status }).sort({ createdAt: -1 }).limit(100);
  const pending = await ApprovalRequest.countDocuments({ status: 'pending' });
  return res.json({ requests: await Promise.all(rows.map(requestJson)), pending, me: String(req.admin._id) });
}

function deciding(approve) {
  return async (req, res) => {
    try {
      const note = String(req.body?.note || '').trim();
      const request = await approvals.decide(req.admin, req.params.requestId, { approve, note });
      const event = await recordAudit(req.admin, {
        action: approve ? 'approval.approve' : 'approval.reject',
        area: 'payments',
        target: { type: 'approval', id: request._id, label: approvals.approvalLabel(request) },
        reason: note,
        before: { status: 'pending' },
        after: { status: request.status, ...(approve ? { applied: request.changes } : {}) },
      });
      return res.json({ request: await requestJson(request), auditEvent: `EV-${event.number}` });
    } catch (error) {
      return answer(res, error);
    }
  };
}

async function withdrawApproval(req, res) {
  try {
    const request = await approvals.withdraw(req.admin, req.params.requestId);
    await recordAudit(req.admin, { action: 'approval.withdraw', area: 'payments', target: { type: 'approval', id: request._id, label: approvals.approvalLabel(request) } });
    return res.json({ request: await requestJson(request) });
  } catch (error) {
    return answer(res, error);
  }
}

module.exports = {
  exportLinesCsv,
  transactions,
  balances,
  check,
  exportCsv,
  reverseTx,
  regions,
  requestRegions,
  listApprovals,
  approve: deciding(true),
  reject: deciding(false),
  withdrawApproval,
};
