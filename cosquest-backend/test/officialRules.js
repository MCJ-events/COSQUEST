// Official rules: versions through two-person approval; checkout needs the current version.
const User = require('../src/models/User');
const officialRules = require('../src/utils/officialRules');
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
  const a = await mk('RuA');
  const b = await mk('RuB');
  const body = '# Who can enter\n- 18 or over\n- Allowed regions only\n# How winners are decided\n- Highest verified points; earlier completion breaks a tie';

  const before = await officialRules.acceptedForCheckout(undefined).catch((e) => e);
  const start = (await request('GET', '/api/rules')).data.rules;
  check(start === null ? before === null : true, 'no rules yet: checkout asks for nothing', before);
  const short = await request('POST', '/api/admin/rules/requests', a, { title: 'Rules', body: 'too short', reason: 'Test' });
  check(short.status === 400, 'rules text that is too short is refused', short.data);
  const asked = await request('POST', '/api/admin/rules/requests', a, { title: 'CosQuest Official Contest Rules', body, reason: 'Reviewed by counsel (test)' });
  check(asked.status === 201, 'a new version waits for approval', asked.data);
  check((await request('POST', `/api/admin/approvals/${asked.data.request.id}/approve`, a, {})).status === 403, "the requester can't approve it", null);
  check((await request('POST', `/api/admin/approvals/${asked.data.request.id}/approve`, b, { note: 'OK' })).status === 200, 'a second admin approves', null);
  const pub = await request('GET', '/api/rules');
  const version = pub.data.rules?.version;
  check(pub.status === 200 && Number.isInteger(version) && pub.data.rules.body === body, 'the rules are public, with a version', pub.data);
  const refused = await officialRules.acceptedForCheckout(undefined).catch((e) => e);
  check(refused?.status === 409 && refused.code === 'rules_not_accepted', 'checkout without accepting the rules: refused', refused?.message);
  const old = await officialRules.acceptedForCheckout(version - 1).catch((e) => e);
  check(old?.code === 'rules_not_accepted', 'accepting an older version: refused', old?.message);
  check((await officialRules.acceptedForCheckout(version)) === version, 'accepting the current version: allowed (saved on the order)', null);
  const v1 = await request('GET', `/api/rules/${version}`);
  check(v1.status === 200 && v1.data.rules.version === version, 'any version can be read again later', v1.data);

  console.log(`\nofficial rules: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
