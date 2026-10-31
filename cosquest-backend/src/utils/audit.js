// The audit log (Audit log page): every super admin action goes through
// recordAudit, so nothing is ever missed or written by hand.
//
//   await recordAudit(req.admin, {
//     action: 'post.remove', area: 'feeds',
//     target: { type: 'post', id: post.id, label: 'F-2812 · @ticketboost' },
//     reason, before: { status: 'published' }, after: { status: 'removed' },
//     evidence: snapshot, report: report?._id,
//   });
//
// Events are append-only (see src/models/AuditEvent.js).
const AuditEvent = require('../models/AuditEvent');
const Counter = require('../models/Counter');

const auditLabel = (number) => `EV-${number}`;

async function recordAudit(actor, { action, area, target = {}, reason = '', before = null, after = null, evidence = null, report = null, meta = null }) {
  if (!actor?._id) throw Object.assign(new Error('An audit event needs an acting admin.'), { status: 500 });
  const number = await Counter.next('audit', 2000);
  return AuditEvent.create({
    number,
    actor: actor._id,
    actorRole: actor.platformRole === 'admin' ? 'super_admin' : 'unknown',
    action,
    area,
    target: { type: target.type || null, id: target.id ? String(target.id) : null, label: target.label || null },
    reason: typeof reason === 'string' ? reason.trim().slice(0, 1000) : '',
    before,
    after,
    evidence,
    report,
    meta,
  });
}

/** The JSON the dashboard reads for one event. */
function auditJson(event) {
  const actor = event.actor?.profile ? event.actor : null;
  return {
    id: String(event._id),
    number: auditLabel(event.number),
    action: event.action,
    area: event.area,
    actor: actor
      ? {
          id: String(actor._id),
          username: actor.profile.username || null,
          name: actor.profile.displayName || [actor.profile.firstName, actor.profile.lastName].filter(Boolean).join(' ') || actor.profile.username || 'Admin',
          avatarKey: actor.profile.avatarKey || null,
          avatarPhotoUrl: actor.profile.avatarPhotoUrl || null,
        }
      : { id: String(event.actor) },
    actorRole: event.actorRole,
    target: event.target,
    reason: event.reason,
    before: event.before,
    after: event.after,
    evidence: event.evidence,
    report: event.report ? String(event.report) : null,
    meta: event.meta,
    createdAt: event.createdAt,
  };
}

module.exports = { recordAudit, auditJson, auditLabel };
