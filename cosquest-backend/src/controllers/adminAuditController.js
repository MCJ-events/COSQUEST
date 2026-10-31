// The Audit log (super admin dashboard, Phase 5). Read-only: events are
// append-only (src/models/AuditEvent.js).
//
//   GET /api/admin/audit/stats                       today: actions, acting admins, reports decided, role changes
//   GET /api/admin/audit?q&actor&area&action&from&to&offset
//   GET /api/admin/audit/export?<same filters>       CSV (up to 5,000 events)
//   GET /api/admin/audit/:eventId                    one event, with its report
const mongoose = require('mongoose');
const AuditEvent = require('../models/AuditEvent');
const Report = require('../models/Report');
const { auditJson } = require('../utils/audit');
const { reportLabel } = require('./reportController');

const PAGE = 25;
const EXPORT_MAX = 5000;

function startOfToday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function filterFrom(query) {
  const filter = {};
  if (query.actor && mongoose.isValidObjectId(query.actor)) filter.actor = query.actor;
  if (query.area) filter.area = query.area;
  if (query.action) filter.action = query.action;
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) {
      const to = new Date(query.to);
      if (/^\d{4}-\d{2}-\d{2}$/.test(query.to)) to.setUTCHours(24, 0, 0, 0);
      filter.createdAt.$lt = to;
    }
  }
  if (query.q) {
    const q = String(query.q).trim();
    const number = Number(q.replace(/^ev-?/i, ''));
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      ...(Number.isInteger(number) && number > 0 ? [{ number }] : []),
      { 'target.label': { $regex: safe, $options: 'i' } },
      { reason: { $regex: safe, $options: 'i' } },
      { action: { $regex: safe, $options: 'i' } },
    ];
  }
  return filter;
}

async function auditStats(req, res) {
  const today = { createdAt: { $gte: startOfToday() } };
  const [actions, actors, decided, roleChanges] = await Promise.all([
    AuditEvent.countDocuments({ ...today, area: { $ne: 'auth' } }),
    AuditEvent.distinct('actor', { ...today, area: { $ne: 'auth' } }),
    Report.countDocuments({ status: { $in: ['resolved', 'dismissed'] }, 'decision.at': { $gte: startOfToday() } }),
    AuditEvent.countDocuments({ ...today, action: { $in: ['admin.grant', 'admin.revoke'] } }),
  ]);
  return res.json({ actions, actingAdmins: actors.length, reportsDecided: decided, roleChanges });
}

async function listAudit(req, res) {
  const filter = filterFrom(req.query);
  const offset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
  const [rows, total] = await Promise.all([
    AuditEvent.find(filter).sort({ createdAt: -1, _id: -1 }).skip(offset).limit(PAGE).populate('actor', 'profile'),
    AuditEvent.countDocuments(filter),
  ]);
  return res.json({ events: rows.map(auditJson), total, nextOffset: offset + rows.length < total ? offset + rows.length : null });
}

async function auditDetail(req, res) {
  if (!mongoose.isValidObjectId(req.params.eventId)) return res.status(404).json({ error: 'Event not found.' });
  const event = await AuditEvent.findById(req.params.eventId).populate('actor', 'profile');
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  const report = event.report ? await Report.findById(event.report) : null;
  return res.json({
    event: auditJson(event),
    report: report ? { id: String(report._id), number: reportLabel(report.number), status: report.status, reason: report.reason } : null,
  });
}

const csvCell = (value) => {
  const s = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Spreadsheets must never run a cell as a formula.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

async function exportAudit(req, res) {
  const rows = await AuditEvent.find(filterFrom(req.query)).sort({ createdAt: -1, _id: -1 }).limit(EXPORT_MAX).populate('actor', 'profile');
  const header = ['event', 'time_utc', 'admin', 'action', 'area', 'target_type', 'target', 'reason', 'before', 'after', 'report'];
  const lines = rows.map((e) => {
    const json = auditJson(e);
    return [json.number, e.createdAt.toISOString(), json.actor?.username ? `@${json.actor.username}` : json.actor?.id, e.action, e.area, e.target?.type, e.target?.label, e.reason, e.before, e.after, e.report ? String(e.report) : '']
      .map(csvCell)
      .join(',');
  });
  const { recordAudit } = require('../utils/audit');
  await recordAudit(req.admin, { action: 'audit.export', area: 'auth', target: { type: 'audit', id: null, label: `${rows.length} events` } });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="cosquest-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.send([header.join(','), ...lines].join('\n'));
}

module.exports = { auditStats, listAudit, auditDetail, exportAudit, filterFrom, csvCell };
