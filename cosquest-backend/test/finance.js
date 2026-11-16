// Finance approvers: the second person for money changes (payment brief 6.6).
const User = require('../src/models/User');
const RegionRule = require('../src/models/RegionRule');
const AuditEvent = require('../src/models/AuditEvent');
const Notification = require('../src/models/Notification');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let ok = 0;
  let bad = 0;
  const check = (cond, name, value) => {
    if (cond) { ok += 1; console.log(`  ok  - ${name}`); }
    else { bad += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1500)); }
  };
  async function request(method, path, token, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  }
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  async function makeUser(name, extra = {}) {
    const user = await User.create({
      profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, lastName: 'Test', avatarKey: 'green-knight' },
      email: `${name.toLowerCase()}_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants', ...extra,
    });
    return { user, token: signToken(user.id, user.tokenVersion) };
  }
  const mark = await makeUser('FinMark', { platformRole: 'admin', adminSince: new Date() });
  const ade = await makeUser('FinAde');
  const member = await makeUser('FinMember');
  const markToken = (await request('POST', '/api/admin/auth/exchange', mark.token)).data.token;

  console.log('\n--- adding a finance approver ---');
  const before = await request('POST', '/api/admin/auth/exchange', ade.token);
  check(before.status === 403, 'a member cannot open the dashboard', before.data);
  const self = await request('POST', '/api/admin/finance-approvers', markToken, { username: mark.user.profile.username, reason: 'Test' });
  check(self.status === 409 && self.data.code === 'self', 'a super admin cannot make themselves the second approver', self.data);
  const unknown = await request('POST', '/api/admin/finance-approvers', markToken, { username: 'nobody_here_x', reason: 'Test' });
  check(unknown.status === 404, 'an unknown username is refused', unknown.data);
  const added = await request('POST', '/api/admin/finance-approvers', markToken, { username: `@${ade.user.profile.username}`, reason: 'Second approver for money changes' });
  check(added.status === 201 && /^EV-/.test(added.data.auditEvent), 'Mark adds Ade as finance approver (audit logged)', added.data);
  const list = await request('GET', '/api/admin/finance-approvers', markToken);
  check(list.data.approvers?.some((a) => a.id === ade.user.id), 'the list of finance approvers', list.data);

  console.log('\n--- what a finance approver can do ---');
  const adeToken = (await request('POST', '/api/admin/auth/exchange', ade.token)).data.token;
  const role = await request('GET', '/api/admin/auth/role', adeToken);
  check(role.status === 200 && role.data.role === 'finance', 'Ade signs in as a finance approver', role.data);
  const overview = await request('GET', '/api/admin/overview', adeToken);
  check(overview.status === 403 && overview.data.code === 'finance_only', 'but cannot open the rest of the dashboard', overview.data);
  const members = await request('GET', '/api/admin/members', adeToken);
  check(members.status === 403, '...members included', members.status);
  const ledger = await request('GET', '/api/admin/ledger/transactions', adeToken);
  check(ledger.status === 200, 'Ade can see the ledger', ledger.status);
  const asks = await request('POST', '/api/admin/regions/requests', adeToken, { changes: [{ region: 'US-NV', status: 'allowed' }], reason: 'Test' });
  check(asks.status === 403, 'Ade cannot request changes (only approve)', asks.status);
  const manage = await request('POST', '/api/admin/finance-approvers', adeToken, { username: member.user.profile.username, reason: 'Test' });
  check(manage.status === 403, 'Ade cannot add approvers', manage.status);

  console.log('\n--- two people: Mark asks, Ade approves ---');
  const requested = await request('POST', '/api/admin/regions/requests', markToken, { changes: [{ region: 'US-WA', name: 'Washington', status: 'allowed' }], reason: 'Per legal advice' });
  const own = await request('POST', `/api/admin/approvals/${requested.data.request.id}/approve`, markToken, {});
  check(own.status === 403 && own.data.code === 'own_request', "Mark can't approve his own request", own.data);
  const approved = await request('POST', `/api/admin/approvals/${requested.data.request.id}/approve`, adeToken, { note: 'Checked' });
  check(approved.status === 200 && (await RegionRule.findOne({ region: 'US-WA' }))?.status === 'allowed', 'Ade approves: it applies', approved.data);

  const approvalEvent = await AuditEvent.findOne({ action: 'approval.approve', actor: ade.user._id });
  check(approvalEvent?.actorRole === 'finance_approver', "the audit log names Ade's role (not 'unknown')", approvalEvent);
  check(await Notification.exists({ user: ade.user._id, message: /finance approver/ }), 'Ade was told about the role', null);

  console.log('\n--- suspended accounts ---');
  await User.updateOne({ _id: ade.user._id }, { $set: { 'moderation.suspendedUntil': new Date(Date.now() + 3600e3) } });
  const whileSuspended = await request('GET', '/api/admin/ledger/transactions', adeToken);
  check(whileSuspended.status === 403 && whileSuspended.data.code === 'account_suspended', "a suspended approver's access is paused", whileSuspended.data);
  await User.updateOne({ _id: ade.user._id }, { $set: { 'moderation.suspendedUntil': null } });
  const suspendedMember = await makeUser('FinSuspended', { moderation: { suspendedUntil: new Date(Date.now() + 3600e3) } });
  const addSuspended = await request('POST', '/api/admin/finance-approvers', markToken, { username: suspendedMember.user.profile.username, reason: 'Test' });
  check(addSuspended.status === 409 && addSuspended.data.code === 'suspended', 'a suspended member cannot be made an approver', addSuspended.data);

  console.log('\n--- removing ---');
  const noReason = await request('DELETE', `/api/admin/finance-approvers/${ade.user.id}`, markToken, { reason: '' });
  check(noReason.status === 400, 'removing needs a reason', noReason.data);
  const removed = await request('DELETE', `/api/admin/finance-approvers/${ade.user.id}`, markToken, { reason: 'Changed roles' });
  check(removed.status === 200 && removed.data.removed, 'Mark removes Ade', removed.data);
  const after = await request('GET', '/api/admin/approvals', adeToken);
  check(after.status === 401 || after.status === 403, "Ade's dashboard session ends at once", after.status);

  console.log(`\nfinance approvers: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
