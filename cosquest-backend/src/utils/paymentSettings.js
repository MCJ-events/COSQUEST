// The money settings (finance's "Assumptions" sheet). See src/models/PaymentSettingsVersion.js.
//
//   current()          { formulaVersion: 'f2' | null, platformShareBps, winnerShareBps, payoutApprovalLimitCents }
//                      (nulls = OPEN: not decided yet)
//   history()          every approved version, newest first
//   requestChange()    a change waits for a second admin (ApprovalRequest kind 'payment_settings')
//   applyApproved()    called by approvals.decide: the approved change becomes the next version
const PaymentSettingsVersion = require('../models/PaymentSettingsVersion');
const ApprovalRequest = require('../models/ApprovalRequest');
const Counter = require('../models/Counter');

function fail(status, message, code) {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

const label = (v) => (v ? `f${v.version}` : null);

function settingsJson(v) {
  const share = v ? v.platformShareBps : null;
  return {
    formulaVersion: label(v),
    platformShareBps: share ?? null,
    winnerShareBps: share === null || share === undefined ? null : 10000 - share,
    payoutApprovalLimitCents: v ? v.payoutApprovalLimitCents ?? null : null,
    note: v?.note || '',
    approvedAt: v?.createdAt || null,
  };
}

async function latest() {
  return PaymentSettingsVersion.findOne().sort({ version: -1 }).lean();
}

async function current() {
  return settingsJson(await latest());
}

async function history() {
  const rows = await PaymentSettingsVersion.find().sort({ version: -1 }).limit(100).lean();
  return rows.map(settingsJson);
}

// "30" or 30 -> 3000 bps; "" / null -> null (OPEN).
function toBps(percent) {
  if (percent === null || percent === undefined || percent === '') return null;
  const n = Number(percent);
  if (!Number.isFinite(n) || n < 0 || n > 100) fail(400, 'The platform share is a percentage from 0 to 100.', 'bad_share');
  const bps = Math.round(n * 100);
  if (Math.abs(bps - n * 100) > 1e-6) fail(400, 'The platform share can have at most 2 decimals.', 'bad_share');
  return bps;
}

// "500" or 500 (dollars) -> 50000 cents; "" / null -> null (OPEN).
function toCents(dollars) {
  if (dollars === null || dollars === undefined || dollars === '') return null;
  const n = Number(dollars);
  if (!Number.isFinite(n) || n < 0 || n > 10000000) fail(400, 'The payout approval limit is an amount in dollars, 0 or more.', 'bad_limit');
  return Math.round(n * 100);
}

/** A change to the settings, waiting for a second admin. { platformSharePercent, payoutApprovalLimitDollars, note, reason } */
async function requestChange(admin, { platformSharePercent, payoutApprovalLimitDollars, note = '', reason }) {
  if (!reason || String(reason).trim().length < 3) fail(400, 'A reason is required.', 'reason_required');
  const changes = { platformShareBps: toBps(platformSharePercent), payoutApprovalLimitCents: toCents(payoutApprovalLimitDollars), note: String(note || '').slice(0, 500) };
  const now = await latest();
  if (now && now.platformShareBps === changes.platformShareBps && now.payoutApprovalLimitCents === changes.payoutApprovalLimitCents) {
    fail(409, 'Nothing changes: these are the current settings.', 'no_change');
  }
  const share = changes.platformShareBps === null ? 'OPEN' : `${changes.platformShareBps / 100}%`;
  const limit = changes.payoutApprovalLimitCents === null ? 'OPEN' : `$${(changes.payoutApprovalLimitCents / 100).toLocaleString('en-US')}`;
  return ApprovalRequest.create({
    number: await Counter.next('approval', 1),
    kind: 'payment_settings',
    title: `Money settings: platform share ${share}, payout limit ${limit}`,
    changes,
    reason: String(reason).trim().slice(0, 500),
    requestedBy: admin._id,
  });
}

/** The approved change becomes the next version (once per request). */
async function applyApproved(request, admin) {
  const existing = await PaymentSettingsVersion.findOne({ approval: request._id }).lean();
  if (existing) return existing;
  const c = request.changes || {};
  return PaymentSettingsVersion.create({
    version: await Counter.next('paymentSettings', 1),
    platformShareBps: c.platformShareBps ?? null,
    payoutApprovalLimitCents: c.payoutApprovalLimitCents ?? null,
    note: c.note || '',
    approval: request._id,
    requestedBy: request.requestedBy,
    approvedBy: admin._id,
  });
}

module.exports = { current, history, requestChange, applyApproved, toBps, toCents, settingsJson };
