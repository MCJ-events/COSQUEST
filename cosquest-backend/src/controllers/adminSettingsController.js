// Community settings (super admin dashboard, Phase 5).
//
//   GET   /api/admin/settings   { settings, version, updatedAt, updatedBy, needsEmail: [...] }
//   PATCH /api/admin/settings   { version, changes: { identity?: {...}, guidelines?, privacy?, notifications?, moderation? }, reason? }
//
// Only the fields below can change; anything else is refused. A stale
// `version` (another admin saved first) answers 409 so nothing is overwritten.
// Every save is recorded in the audit log with only the changed fields.
const User = require('../models/User');
const CommunitySettings = require('../models/CommunitySettings');
const { recordAudit } = require('../utils/audit');
const { isSuperAdmin } = require('../utils/superAdmin');
const content = require('../utils/adminContent');
const { personJson } = require('./adminOverviewController');

const text = (max) => (v) => typeof v === 'string' && v.trim().length <= max;
const bool = (v) => typeof v === 'boolean';
const oneOf = (...values) => (v) => values.includes(v);

// section.field -> check
const FIELDS = {
  'identity.name': (v) => text(80)(v) && v.trim().length > 0,
  // A web address the dashboard can link to: http(s) only, never javascript: or data:.
  'identity.url': (v) => text(200)(v) && (v.trim() === '' || /^https?:\/\/[^\s]+$/i.test(v.trim())),
  'identity.description': text(500),
  'identity.language': oneOf('en-US', 'en-GB', 'es', 'fr', 'pt-BR', 'yo', 'ig', 'ha'),
  'identity.reportingTimeZone': (v) => typeof v === 'string' && v.length <= 60 && /^[A-Za-z_]+\/[A-Za-z_]+/.test(v),
  'guidelines.title': text(120),
  'guidelines.standards': text(4000),
  'guidelines.requireAcceptance': bool,
  'privacy.visibility': oneOf('members', 'public'),
  'privacy.allowMemberInvitations': bool,
  'privacy.showMemberDirectory': bool,
  'privacy.publicSearchIndexing': bool,
  'notifications.highPriorityAlerts': bool,
  'notifications.joinRequestSummaries': bool,
  'notifications.roleChanges': bool,
  'notifications.dailyDigest': bool,
  'notifications.digestTime': (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v),
  'notifications.digestTo': (v) => typeof v === 'string' && (v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)),
  'moderation.reportRouting': (v) => typeof v === 'string' && (v === 'unassigned' || /^[a-f\d]{24}$/i.test(v)),
  'moderation.newGroupSlowMode': oneOf(0, 10, 30, 60, 300, 3600),
  'moderation.defaultMuteDuration': oneOf('1h', '1d', '1w', '30d'),
  'moderation.prioritizeHarm': bool,
  'moderation.notifyAuthors': bool,
};

// Stored, but with no effect until the backend can send email.
const NEEDS_EMAIL = ['notifications.dailyDigest', 'notifications.digestTime', 'notifications.digestTo'];

const pick = (doc, path) => path.split('.').reduce((obj, key) => (obj == null ? obj : obj[key]), doc);

function settingsJson(s) {
  const plain = s.toObject ? s.toObject() : s;
  const { identity, guidelines, privacy, notifications, moderation, accessReview } = plain;
  return { identity, guidelines, privacy, notifications, moderation, accessReview };
}

async function getSettings(req, res) {
  const s = await CommunitySettings.current();
  const updatedBy = s.updatedBy ? await User.findById(s.updatedBy).select('profile') : null;
  return res.json({ settings: settingsJson(s), version: s.version, updatedAt: s.updatedAt, updatedBy: personJson(updatedBy), needsEmail: NEEDS_EMAIL });
}

async function updateSettings(req, res) {
  try {
    const { version, changes } = req.body;
    const current = await CommunitySettings.current();
    if (version !== current.version) content.fail(409, 'Another admin saved settings since you opened them. Reload to see their changes.', 'stale_settings');

    const set = {};
    const before = {};
    const after = {};
    for (const [section, fields] of Object.entries(changes || {})) {
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) content.fail(400, `${section} must be an object.`);
      for (const [field, value] of Object.entries(fields)) {
        const path = `${section}.${field}`;
        const check = FIELDS[path];
        if (!check) content.fail(400, `${path} can't be changed here.`);
        if (!check(value)) content.fail(400, `${path} has an invalid value.`);
        const clean = typeof value === 'string' ? value.trim() : value;
        if (JSON.stringify(pick(current, path)) === JSON.stringify(clean)) continue;
        if (path === 'moderation.reportRouting' && clean !== 'unassigned') {
          const target = await User.findById(clean);
          if (!target || !isSuperAdmin(target)) content.fail(400, 'Reports can only be routed to a super admin.');
        }
        set[path] = clean;
        before[path] = pick(current, path);
        after[path] = clean;
      }
    }
    if (!Object.keys(set).length) return res.json({ settings: settingsJson(current), version: current.version, changed: 0, auditEvent: null });

    const updated = await CommunitySettings.findOneAndUpdate(
      { _id: 'community', version: current.version },
      { $set: { ...set, updatedBy: req.admin._id }, $inc: { version: 1 } },
      { new: true }
    );
    if (!updated) content.fail(409, 'Another admin saved settings at the same moment. Reload to see their changes.', 'stale_settings');
    const event = await recordAudit(req.admin, {
      action: 'settings.update',
      area: 'settings',
      target: { type: 'settings', id: 'community', label: `${Object.keys(set).length} setting${Object.keys(set).length === 1 ? '' : 's'}` },
      reason: typeof req.body.reason === 'string' ? req.body.reason.trim() : '',
      before,
      after,
    });
    return res.json({ settings: settingsJson(updated), version: updated.version, changed: Object.keys(set).length, auditEvent: `EV-${event.number}` });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
    throw error;
  }
}

module.exports = { getSettings, updateSettings, FIELDS, NEEDS_EMAIL };
