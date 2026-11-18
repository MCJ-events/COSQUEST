// The Costcoin price table (finance's "Price Table"). See src/models/PriceTableVersion.js.
//
//   current()         { priceVersion: 'v2' | null, bundles } (every bundle, admins)
//   onSale()          { priceVersion, bundles } active bundles only (the app's shop)
//   history()         every approved version, newest first
//   requestChange()   a new table waits for a second admin (ApprovalRequest kind 'price_table')
//   applyApproved()   called by approvals.decide: the approved table becomes the next version
//
// Agreed so far (Sep 2 meeting): B-80 $1 -> 80 Costcoin, B-500 $4 -> 500 Costcoin.
// The $20 starter pack's coin amount is OPEN (status 'open': never sold).
const PriceTableVersion = require('../models/PriceTableVersion');
const ApprovalRequest = require('../models/ApprovalRequest');
const Counter = require('../models/Counter');

function fail(status, message, code) {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

const label = (v) => (v ? `v${v.version}` : null);
const bundleJson = (b) => ({ id: b.id, name: b.name, priceCents: b.priceCents, costcoin: b.costcoin ?? null, costcoinPerDollar: b.costcoin ? Math.round((b.costcoin / b.priceCents) * 100 * 100) / 100 : null, status: b.status, note: b.note || '' });
const tableJson = (v) => ({ priceVersion: label(v), bundles: v ? v.bundles.map(bundleJson) : [], approvedAt: v?.createdAt || null });

async function latest() {
  return PriceTableVersion.findOne().sort({ version: -1 }).lean();
}

async function current() {
  return tableJson(await latest());
}

async function onSale() {
  const table = await current();
  return { priceVersion: table.priceVersion, bundles: table.bundles.filter((b) => b.status === 'active') };
}

async function history() {
  const rows = await PriceTableVersion.find().sort({ version: -1 }).limit(50).lean();
  return rows.map(tableJson);
}

/** Checks a proposed table: [{ id, name, price (dollars), costcoin, status, note }]. */
function cleanBundles(input) {
  if (!Array.isArray(input) || !input.length || input.length > 30) fail(400, 'A price table has between 1 and 30 bundles.', 'bad_table');
  const bundles = input.map((b) => {
    const id = String(b?.id || '').trim().toUpperCase();
    if (!/^B-[A-Z0-9-]{1,20}$/.test(id)) fail(400, `"${b?.id}" is not a bundle id (e.g. B-500).`, 'bad_bundle_id');
    const name = String(b?.name || '').trim();
    if (name.length < 1 || name.length > 40) fail(400, `${id}: the name needs 1-40 characters.`, 'bad_bundle');
    const price = Number(b?.price);
    if (!Number.isFinite(price) || price < 0.5 || price > 1000) fail(400, `${id}: the price is $0.50 to $1,000 (Stripe's minimum is $0.50).`, 'bad_price');
    const status = b?.status === 'open' ? 'open' : 'active';
    const raw = b?.costcoin;
    const costcoin = raw === null || raw === undefined || raw === '' ? null : Number(raw);
    if (costcoin !== null && (!Number.isInteger(costcoin) || costcoin < 1)) fail(400, `${id}: Costcoin is a whole number from 1.`, 'bad_costcoin');
    if (status === 'active' && costcoin === null) fail(400, `${id}: an active bundle needs its Costcoin amount (or mark it open).`, 'bad_costcoin');
    return { id, name, priceCents: Math.round(price * 100), costcoin, status, note: String(b?.note || '').slice(0, 200) };
  });
  if (new Set(bundles.map((b) => b.id)).size !== bundles.length) fail(400, 'Each bundle id once.', 'duplicate_bundle');
  return bundles;
}

async function requestChange(admin, { bundles, reason }) {
  if (!reason || String(reason).trim().length < 3) fail(400, 'A reason is required.', 'reason_required');
  const clean = cleanBundles(bundles);
  const now = await latest();
  if (now && JSON.stringify(now.bundles.map(bundleJson)) === JSON.stringify(clean.map(bundleJson))) fail(409, 'Nothing changes: this is the current table.', 'no_change');
  return ApprovalRequest.create({
    number: await Counter.next('approval', 1),
    kind: 'price_table',
    title: `Price table: ${clean.map((b) => `${b.id} $${(b.priceCents / 100).toFixed(2)} = ${b.costcoin ?? 'OPEN'} coins`).join(', ')}`.slice(0, 160),
    changes: { bundles: clean },
    reason: String(reason).trim().slice(0, 500),
    requestedBy: admin._id,
  });
}

async function applyApproved(request, admin) {
  const existing = await PriceTableVersion.findOne({ approval: request._id }).lean();
  if (existing) return existing;
  return PriceTableVersion.create({
    version: await Counter.next('priceTable', 1),
    bundles: request.changes?.bundles || [],
    approval: request._id,
    requestedBy: request.requestedBy,
    approvedBy: admin._id,
  });
}

module.exports = { current, onSale, history, requestChange, applyApproved, cleanBundles };
