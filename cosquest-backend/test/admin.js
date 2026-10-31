// Super admin dashboard, Phase 1 (src/routes/adminRoutes.js, reportRoutes.js):
// signing in with the dashboard's own session, who may use /api/admin, the
// Overview numbers, members reporting content, and the append-only audit log.
const User = require('../src/models/User');
const Post = require('../src/models/Post');
const Report = require('../src/models/Report');
const AuditEvent = require('../src/models/AuditEvent');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;
  function check(ok, name, value) {
    if (ok) { pass += 1; console.log(`  ok  - ${name}`); }
    else { fail += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1500)); }
  }
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

  const admin = await makeUser('Boss', { platformRole: 'admin', adminSince: new Date() });
  const member = await makeUser('Mem');
  const other = await makeUser('Oth');

  console.log('\n--- admin: signing in ---');
  const notAdmin = await request('POST', '/api/admin/auth/exchange', member.token);
  check(notAdmin.status === 403 && notAdmin.data.code === 'not_admin', 'a member cannot get a dashboard session', notAdmin);
  const noAppToken = await request('POST', '/api/admin/auth/exchange', null);
  check(noAppToken.status === 401, 'exchange needs an app session', noAppToken.status);
  const signedIn = await request('POST', '/api/admin/auth/exchange', admin.token);
  const adminToken = signedIn.data?.token;
  check(signedIn.status === 200 && typeof adminToken === 'string' && signedIn.data.admin.role === 'super_admin', 'a super admin swaps an app session for a dashboard session', signedIn.data);
  const appStill = await request('GET', '/api/users/me/notifications', admin.token);
  check(appStill.status === 200, 'the app session keeps working (the phone is not signed out)', appStill.status);
  const me = await request('GET', '/api/admin/auth/me', adminToken);
  check(me.status === 200 && me.data.admin.id === admin.user.id, 'GET /api/admin/auth/me', me.data);
  const badLogin = await request('POST', '/api/admin/auth/login', null, { email: admin.user.email, password: 'wrong' });
  check(badLogin.status === 401 && badLogin.data.error === 'Wrong email or password.', 'wrong password -> 401 without saying which part', badLogin.data);
  const emptyLogin = await request('POST', '/api/admin/auth/login', null, {});
  check(emptyLogin.status === 400 && Array.isArray(emptyLogin.data.errors), 'login input is validated', emptyLogin.data);

  console.log('\n--- admin: who may use /api/admin ---');
  const appTokenOnAdmin = await request('GET', '/api/admin/overview', admin.token);
  check(appTokenOnAdmin.status === 401 && appTokenOnAdmin.data.code === 'admin_signin', 'an app token does not open /api/admin', appTokenOnAdmin);
  const adminTokenOnApp = await request('GET', '/api/users/me/notifications', adminToken);
  check(adminTokenOnApp.status === 401, 'a dashboard token does not open app routes', adminTokenOnApp.status);
  const memberOnAdmin = await request('GET', '/api/admin/overview', member.token);
  check(memberOnAdmin.status === 401, 'members cannot open /api/admin', memberOnAdmin.status);

  console.log('\n--- reports ---');
  const post = await Post.create({ author: other.user._id, type: 'thought', content: `Free passes, link in bio ${suffix}` });
  const first = await request('POST', '/api/reports', member.token, { targetType: 'post', targetId: post.id, reason: 'spam', statement: 'Asks for account details.' });
  check(first.status === 201 && /^CQ-\d+$/.test(first.data.report.number) && first.data.report.status === 'new', 'reporting a post opens CQ-#### (new)', first.data);
  const stored = await Report.findById(first.data.report.id);
  check(stored?.priority === 'high' && stored.snapshot?.text?.includes('Free passes') && String(stored.targetUser) === other.user.id, 'spam is high priority, the content is kept as evidence', stored);
  const again = await request('POST', '/api/reports', member.token, { targetType: 'post', targetId: post.id, reason: 'spam' });
  check(again.status === 200 && again.data.alreadyReported === true, 'reporting the same thing twice is not a second report', again.data);
  const second = await request('POST', '/api/reports', admin.token, { targetType: 'post', targetId: post.id, reason: 'other', statement: 'Looks fake' });
  const after = await Report.findById(first.data.report.id);
  check(second.status === 200 && second.data.report.id === first.data.report.id && after.reporterCount === 2, 'a second person joins the open report', { second: second.data, count: after?.reporterCount });
  const own = await request('POST', '/api/reports', other.token, { targetType: 'post', targetId: post.id, reason: 'spam' });
  check(own.status === 400, "you can't report your own post", own.data);
  const self = await request('POST', '/api/reports', member.token, { targetType: 'profile', targetId: member.user.id, reason: 'other' });
  check(self.status === 400, "you can't report yourself", self.data);
  const badReason = await request('POST', '/api/reports', member.token, { targetType: 'post', targetId: post.id, reason: 'boring' });
  check(badReason.status === 400 && badReason.data.errors?.[0]?.field === 'reason', 'unknown reasons are refused', badReason.data);
  const missing = await request('POST', '/api/reports', member.token, { targetType: 'post', targetId: '0123456789abcdef01234567', reason: 'spam' });
  check(missing.status === 404, 'a missing post -> 404', missing.status);
  const profile = await request('POST', '/api/reports', member.token, { targetType: 'profile', targetId: other.user.id, reason: 'impersonation' });
  const profileReport = await Report.findById(profile.data?.report?.id);
  check(profile.status === 201 && profileReport?.priority === 'standard', 'reporting a profile (standard priority)', profile.data);

  console.log('\n--- admin: overview ---');
  const ov = await request('GET', '/api/admin/overview', adminToken);
  check(ov.status === 200 && typeof ov.data.stats?.openReports?.value === 'number' && ov.data.stats.openReports.value >= 2, 'overview counts open reports', ov.data?.stats);
  check(Array.isArray(ov.data?.engagement?.current) && ov.data.engagement.current.length === 7, 'overview: 7 days of engagement', ov.data?.engagement);
  check(Array.isArray(ov.data?.queue) && ov.data.queue[0]?.priority === 'high', 'overview: the queue preview shows high priority first', ov.data?.queue);
  check(ov.data?.pulse?.feedPosts >= 1, 'overview: feed posts this week', ov.data?.pulse);
  const badDate = await request('GET', '/api/admin/overview?from=yesterday', adminToken);
  check(badDate.status === 400, 'overview dates are validated', badDate.data);

  console.log('\n--- audit log ---');
  const signins = await AuditEvent.countDocuments({ actor: admin.user._id, action: 'admin.signin' });
  check(signins >= 1, 'signing in to the dashboard is recorded', signins);
  let refused = false;
  try { await AuditEvent.updateOne({ actor: admin.user._id }, { $set: { reason: 'changed' } }); } catch (error) { refused = /cannot be changed/.test(error.message); }
  check(refused, 'audit events cannot be edited', refused);
  let refusedDelete = false;
  try { await AuditEvent.deleteMany({ actor: admin.user._id }); } catch (error) { refusedDelete = /cannot be changed/.test(error.message); }
  check(refusedDelete, 'audit events cannot be deleted', refusedDelete);

  console.log('\n--- admin: losing access ---');
  const signedOut = await request('POST', '/api/admin/auth/logout', adminToken);
  const afterOut = await request('GET', '/api/admin/overview', adminToken);
  check(signedOut.status === 200 && afterOut.status === 401, 'signing out ends the dashboard session', afterOut.status);
  const again2 = await request('POST', '/api/admin/auth/exchange', admin.token);
  await User.updateOne({ _id: admin.user._id }, { $set: { platformRole: null } });
  const revoked = await request('GET', '/api/admin/overview', again2.data.token);
  check(revoked.status === 403 && revoked.data.code === 'not_admin', 'removing the role closes the dashboard at once', revoked.data);

  console.log(`\nadmin: ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
