// The official contest rules (legal plan, section 9).
//   current()         the published version (null until the first one)
//   byVersion(n)      an older version (what an order accepted)
//   requestPublish()  a new version waits for a second admin (ApprovalRequest kind 'official_rules')
//   applyApproved()   called by approvals.decide
//   acceptedForCheckout(version)  the check at checkout: once rules are published, buyers
//                     must accept the CURRENT version (409 rules_not_accepted otherwise)
const OfficialRulesVersion = require('../models/OfficialRulesVersion');
const ApprovalRequest = require('../models/ApprovalRequest');
const Counter = require('../models/Counter');

function fail(status, message, code, extra) {
  throw Object.assign(new Error(message), { status, ...(code ? { code } : {}), ...(extra ? { extra } : {}) });
}

const json = (v) => (v ? { version: v.version, title: v.title, body: v.body, publishedAt: v.createdAt } : null);

async function current() {
  return json(await OfficialRulesVersion.findOne().sort({ version: -1 }).lean());
}

async function byVersion(version) {
  return json(await OfficialRulesVersion.findOne({ version: Number(version) }).lean());
}

async function history() {
  const rows = await OfficialRulesVersion.find().sort({ version: -1 }).select('version title createdAt').limit(50).lean();
  return rows.map((v) => ({ version: v.version, title: v.title, publishedAt: v.createdAt }));
}

async function requestPublish(admin, { title, body, reason }) {
  const t = String(title || '').trim();
  const b = String(body || '').replace(/\r\n/g, '\n').trim();
  if (t.length < 3 || t.length > 120) fail(400, 'The title needs 3 to 120 characters.', 'bad_title');
  if (b.length < 50) fail(400, 'The rules text is too short.', 'bad_body');
  if (b.length > 60000) fail(400, 'The rules text is too long (60,000 characters at most).', 'bad_body');
  if (!reason || String(reason).trim().length < 3) fail(400, 'A reason is required.', 'reason_required');
  const now = await current();
  if (now && now.title === t && now.body === b) fail(409, 'Nothing changes: these are the current rules.', 'no_change');
  if (await ApprovalRequest.exists({ kind: 'official_rules', status: 'pending' })) fail(409, 'A new version of the rules is already waiting for approval.', 'already_requested');
  return ApprovalRequest.create({
    number: await Counter.next('approval', 1),
    kind: 'official_rules',
    title: `Official rules: ${t} (version ${(now?.version || 0) + 1})`.slice(0, 160),
    changes: { title: t, body: b },
    reason: String(reason).trim().slice(0, 500),
    requestedBy: admin._id,
  });
}

async function applyApproved(request, admin) {
  const existing = await OfficialRulesVersion.findOne({ approval: request._id }).lean();
  if (existing) return existing;
  return OfficialRulesVersion.create({
    version: await Counter.next('officialRules', 1),
    title: request.changes?.title,
    body: request.changes?.body,
    approval: request._id,
    requestedBy: request.requestedBy,
    approvedBy: admin._id,
  });
}

/** At checkout: the version to save on the order (null while no rules are published). */
async function acceptedForCheckout(acceptedVersion) {
  const now = await current();
  if (!now) return null;
  if (Number(acceptedVersion) !== now.version) {
    fail(409, `Please read and accept the official rules (version ${now.version}) to continue.`, 'rules_not_accepted', { rulesVersion: now.version });
  }
  return now.version;
}

module.exports = { current, byVersion, history, requestPublish, applyApproved, acceptedForCheckout };
