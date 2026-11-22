// The daily Stripe check (Admin > Ledger).
//   GET  /api/admin/ledger/stripe-check        the last 14 days
//   POST /api/admin/ledger/stripe-check/run    { day: 'YYYY-MM-DD' } run it again (or for the first time)
const stripeReconcile = require('../utils/stripeReconcile');
const { recordAudit } = require('../utils/audit');

async function recent(req, res) {
  return res.json({ days: await stripeReconcile.recent(14) });
}

async function runDay(req, res) {
  const day = String(req.body?.day || '');
  const today = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= today || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
    return res.status(400).json({ error: 'Choose a past day (YYYY-MM-DD).', code: 'bad_day' });
  }
  const result = await stripeReconcile.run(day);
  if (!result) return res.status(503).json({ error: 'Stripe is not set up on this server.', code: 'payments_unavailable' });
  await recordAudit(req.admin, { action: 'ledger.stripe_check', area: 'payments', target: { type: 'ledger', id: null, label: `Stripe check ${day}` }, meta: { ok: result.ok, problems: result.problems.length } });
  return res.json(result);
}

module.exports = { recent, runDay };
