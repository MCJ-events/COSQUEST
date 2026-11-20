// Ledger corrections need a second person (Mark, 20 Nov 2026): reversing an
// entry is a request (ApprovalRequest kind 'ledger_reversal'); another admin or
// the finance approver approves it, and only then is the reversal recorded
// (debits and credits swapped, the original kept). The requester can never
// approve their own (approvals.js).
const mongoose = require('mongoose');
const LedgerTransaction = require('../models/LedgerTransaction');
const ApprovalRequest = require('../models/ApprovalRequest');
const Counter = require('../models/Counter');
const ledger = require('./ledger');

function fail(status, message, code) {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

const total = (tx) => tx.lines.reduce((sum, l) => sum + (l.debit || 0), 0);

async function requestReversal(admin, txId, reason) {
  const why = String(reason || '').trim();
  if (why.length < 3) fail(400, 'A reason is required.', 'reason_required');
  if (!mongoose.isValidObjectId(txId)) fail(404, 'Ledger transaction not found.');
  const original = await LedgerTransaction.findById(txId).lean();
  if (!original) fail(404, 'Ledger transaction not found.');
  if (original.reverses) fail(409, 'A reversal cannot itself be reversed: record a new correction.', 'is_reversal');
  if (await LedgerTransaction.exists({ key: `reverse-${original._id}` })) fail(409, `${ledger.label(original)} was already reversed.`, 'already_reversed');
  if (await ApprovalRequest.exists({ kind: 'ledger_reversal', status: 'pending', 'changes.transactionId': String(original._id) })) fail(409, `A correction of ${ledger.label(original)} is already waiting for approval.`, 'already_requested');
  const amount = total(original);
  const shown = original.book === 'money' ? `$${(amount / 100).toFixed(2)}` : `${amount} CosCoin`;
  return ApprovalRequest.create({
    number: await Counter.next('approval', 1),
    kind: 'ledger_reversal',
    title: `Reverse ${ledger.label(original)} (${ledger.typeOf(original.kind)}, ${shown})`,
    changes: { transactionId: String(original._id), number: ledger.label(original), type: ledger.typeOf(original.kind), book: original.book, currency: original.currency, total: amount },
    reason: why.slice(0, 500),
    requestedBy: admin._id,
  });
}

/** Approved: the reversal is recorded (once), with who asked and who approved. */
async function applyApproved(request, admin) {
  const txId = request.changes?.transactionId;
  const existing = await LedgerTransaction.findOne({ key: `reverse-${txId}` }).lean();
  if (existing) return existing;
  return ledger.reverse(txId, { reason: request.reason, by: request.requestedBy, approvedBy: [admin._id] });
}

module.exports = { requestReversal, applyApproved };
