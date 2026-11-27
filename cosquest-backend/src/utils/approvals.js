// Two-person approval (payment brief 6.6). See src/models/ApprovalRequest.js.
const ApprovalRequest = require('../models/ApprovalRequest');
const RegionRule = require('../models/RegionRule');
const Counter = require('../models/Counter');

const REGION = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/; // "US", "US-CA"

function fail(status, message, code) {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

/** A request to change region rules: [{ region, name?, status, note? }]. */
async function requestRegionChanges(admin, { changes, reason }) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 100) fail(400, 'Add between 1 and 100 region changes.');
  const clean = changes.map((c) => {
    const region = String(c?.region || '').trim().toUpperCase();
    if (!REGION.test(region)) fail(400, `"${c?.region}" is not a region code (e.g. US-CA).`, 'bad_region');
    if (!['allowed', 'blocked', 'needs_license'].includes(c?.status)) fail(400, 'Status must be allowed, blocked or needs_license.', 'bad_status');
    return { region, name: String(c?.name || '').slice(0, 80), status: c.status, note: String(c?.note || '').slice(0, 500) };
  });
  if (new Set(clean.map((c) => c.region)).size !== clean.length) fail(400, 'Each region once per request.', 'duplicate_region');
  if (!reason || String(reason).trim().length < 3) fail(400, 'A reason is required.', 'reason_required');
  return ApprovalRequest.create({
    number: await Counter.next('approval', 1),
    kind: 'region_rules',
    title: clean.length === 1 ? `Region ${clean[0].region}: ${clean[0].status.replace('_', ' ')}` : `${clean.length} region changes`,
    changes: clean,
    reason: String(reason).trim().slice(0, 500),
    requestedBy: admin._id,
  });
}

/** Approves (and applies) or rejects a pending request. Never by its requester. */
async function decide(admin, requestId, { approve, note = '' }) {
  const request = await ApprovalRequest.findById(requestId);
  if (!request) fail(404, 'Approval request not found.');
  if (request.status !== 'pending') fail(409, `This request was already ${request.status}.`, 'already_decided');
  if (String(request.requestedBy) === String(admin._id)) fail(403, "You can't approve or reject your own request: another admin must.", 'own_request');
  if (!approve && String(note).trim().length < 3) fail(400, 'Say why it is rejected.', 'reason_required');
  // Claim the decision once (two admins clicking at the same time).
  const claimed = await ApprovalRequest.findOneAndUpdate(
    { _id: request._id, status: 'pending' },
    { $set: { status: approve ? 'approved' : 'rejected', decidedBy: admin._id, decisionNote: String(note).slice(0, 500), decidedAt: new Date() } },
    { new: true }
  );
  if (!claimed) fail(409, 'This request was just decided by someone else.', 'already_decided');
  // Money settings: the approved change becomes the next version (f1, f2...).
  // CosCoin price table: the approved table becomes the next version (v1, v2...).
  // What CosCoin can buy: the approved catalog becomes the next version (c1, c2...).
  // Ledger corrections: recorded only once a second person approves.
  // Official rules: the approved text becomes the next version.
  if (approve && claimed.kind === 'official_rules') await require('./officialRules').applyApproved(claimed, admin);
  if (approve && claimed.kind === 'ledger_reversal') await require('./ledgerCorrections').applyApproved(claimed, admin);
  if (approve && claimed.kind === 'item_catalog') await require('./itemCatalog').applyApproved(claimed, admin);
  if (approve && claimed.kind === 'price_table') await require('./priceTable').applyApproved(claimed, admin);
  if (approve && claimed.kind === 'payment_settings') await require('./paymentSettings').applyApproved(claimed, admin);
  if (approve && claimed.kind === 'region_rules') {
    for (const c of claimed.changes) {
      await RegionRule.findOneAndUpdate(
        { region: c.region },
        { $set: { name: c.name, status: c.status, note: c.note, approval: claimed._id, updatedBy: admin._id } },
        { upsert: true }
      );
    }
  }
  return claimed;
}

/** The requester withdraws their own pending request. */
async function withdraw(admin, requestId) {
  const updated = await ApprovalRequest.findOneAndUpdate(
    { _id: requestId, status: 'pending', requestedBy: admin._id },
    { $set: { status: 'withdrawn', decidedAt: new Date() } },
    { new: true }
  );
  if (!updated) fail(409, 'Only your own pending requests can be withdrawn.', 'not_withdrawable');
  return updated;
}

const approvalLabel = (r) => `AP-${r.number}`;

module.exports = { requestRegionChanges, decide, withdraw, approvalLabel, REGION };
