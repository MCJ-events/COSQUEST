// Money settings (finance's "Assumptions"): versions, two-person approval, OPEN values.
const User = require('../src/models/User');
const PaymentSettingsVersion = require('../src/models/PaymentSettingsVersion');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let ok = 0;
  let bad = 0;
  const check = (cond, name, value) => {
    if (cond) { ok += 1; console.log(`  ok  - ${name}`); }
    else { bad += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1200)); }
  };
  async function request(method, path, token, body) {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  }
  const suffix = `${Date.now() % 1e7}${Math.floor(Math.random() * 100)}`;
  const mk = async (name) => {
    const u = await User.create({ profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, avatarKey: 'green-knight' }, email: `${name.toLowerCase()}_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants', platformRole: 'admin', adminSince: new Date() });
    return (await request('POST', '/api/admin/auth/exchange', signToken(u.id, u.tokenVersion))).data.token;
  };
  const a = await mk('PsA');
  const b = await mk('PsB');

  const before = await request('GET', '/api/admin/payment-settings', a);
  check(before.status === 200 && 'current' in before.data, 'settings are readable (OPEN until approved)', before.data);
  const badShare = await request('POST', '/api/admin/payment-settings/requests', a, { platformSharePercent: 150, reason: 'Test' });
  check(badShare.status === 400 && badShare.data.code === 'bad_share', 'a share above 100% is refused', badShare.data);
  const asked = await request('POST', '/api/admin/payment-settings/requests', a, { platformSharePercent: '30', payoutApprovalLimitDollars: '500', reason: 'Mark approved (test)' });
  check(asked.status === 201 && /AP-/.test(asked.data.request.number), 'a change waits for approval', asked.data);
  const own = await request('POST', `/api/admin/approvals/${asked.data.request.id}/approve`, a, {});
  check(own.status === 403, "the requester can't approve it", own.data);
  const approved = await request('POST', `/api/admin/approvals/${asked.data.request.id}/approve`, b, { note: 'OK' });
  check(approved.status === 200, 'a second admin approves', approved.data);
  const after = await request('GET', '/api/admin/payment-settings', a);
  const c = after.data.current;
  check(/^f\d+$/.test(c.formulaVersion) && c.platformShareBps === 3000 && c.winnerShareBps === 7000 && c.payoutApprovalLimitCents === 50000, 'new version: platform 30%, winners 70%, payout limit $500', c);
  const same = await request('POST', '/api/admin/payment-settings/requests', a, { platformSharePercent: '30', payoutApprovalLimitDollars: '500', reason: 'Again' });
  check(same.status === 409 && same.data.code === 'no_change', 'asking for the current values: refused (nothing changes)', same.data);
  let edited = true;
  try { await PaymentSettingsVersion.updateOne({}, { $set: { platformShareBps: 0 } }); } catch { edited = false; }
  check(!edited, 'a version can never be edited (append-only)', null);

  console.log(`\npayment settings: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
