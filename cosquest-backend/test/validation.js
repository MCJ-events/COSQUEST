// Request validation (src/middleware/validate.js, src/validators/*): the
// shared answer shape, the global guards (MongoDB operators as field names,
// broken JSON) and the rules on each area's routes.
const User = require('../src/models/User');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;
  function check(ok, name, value) {
    if (ok) { pass += 1; console.log(`  ok  - ${name}`); }
    else { fail += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1500)); }
  }
  async function request(method, path, token, body, headers = {}) {
    const raw = typeof body === 'string';
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  }
  const isShape = (r) => r.status >= 400 && typeof r.data?.error === 'string' && Array.isArray(r.data.errors) && r.data.errors.every((e) => 'field' in e && 'location' in e && typeof e.message === 'string');

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const user = await User.create({
    profile: { username: `Valid${suffix}`, usernameNormalized: `valid${suffix}`, firstName: 'Val', lastName: 'Id', avatarKey: 'green-knight' },
    email: `valid_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants',
  });
  const token = signToken(user.id, user.tokenVersion);

  console.log('\n--- validation: global guards ---');
  const injected = await request('POST', '/api/auth/login', null, { email: { $ne: null }, password: { $ne: null } });
  check(injected.status === 400 && /cannot start with "\$"/.test(injected.data.error), 'a MongoDB operator in the body is refused before any lookup', injected);
  const deep = await request('PATCH', '/api/users/me/preferences/notifications', token, { notificationsEnabled: true, nested: { a: { $gt: 1 } } });
  check(deep.status === 400 && deep.data.errors?.[0]?.field === '$gt', 'nested operators are found too', deep);
  const inQuery = await request('GET', '/api/posts?type[$ne]=x', token);
  check(inQuery.status === 400, 'an operator in the query string is refused', inQuery);
  const dollarText = await request('PATCH', '/api/users/me/preferences/notifications', token, { notificationsEnabled: true });
  check(dollarText.status === 200, 'ordinary requests are untouched', dollarText.status);
  const broken = await request('POST', '/api/auth/login', null, '{"email": "a@b.c",');
  check(broken.status === 400 && broken.data.error === 'The request body is not valid JSON.', 'broken JSON -> 400 with a clear message (not a stack trace)', broken);

  console.log('\n--- validation: answer shape and preferences ---');
  const noToken = await request('POST', '/api/users/me/devices', token, { platform: 'ios' });
  check(isShape(noToken) && noToken.status === 400 && noToken.data.error === 'pushToken and platform ("ios" | "android" | "web") are required.' && noToken.data.errors[0].field === 'pushToken' && noToken.data.errors[0].location === 'body',
    '400 { error, errors: [{ field, location, message }] }, with the same message as before', noToken.data);
  const objectToken = await request('POST', '/api/users/me/devices', token, { pushToken: ['ExponentPushToken[x]'], platform: 'ios' });
  check(objectToken.status === 400 && objectToken.data.error === 'pushToken and platform must be short strings.', 'a list where text belongs is refused', objectToken.data);
  const longPlatform = await request('POST', '/api/users/me/devices', token, { pushToken: 'ExponentPushToken[x]', platform: 'x'.repeat(21) });
  check(longPlatform.status === 400, 'too long is refused', longPlatform.data);
  const okDevice = await request('POST', '/api/users/me/devices', token, { pushToken: `ExponentPushToken[v${suffix}]`, platform: 'ios' });
  check(okDevice.status === 200, 'a good request still works', okDevice.status);
  const switchText = await request('PATCH', '/api/users/me/preferences/notifications', token, { friendActivity: 'yes' });
  check(switchText.status === 400 && switchText.data.error === 'friendActivity must be a boolean.', 'switches must be true/false', switchText.data);
  const latText = await request('PATCH', '/api/users/me/preferences/location', token, { locationEnabled: true, lat: '6.5', lng: 3.3 });
  check(latText.status === 400 && /^lat is required/.test(latText.data.error), 'lat as text is refused', latText.data);
  const noEnabled = await request('PATCH', '/api/users/me/preferences/location', token, { lat: 6.5, lng: 3.3 });
  check(noEnabled.status === 400 && noEnabled.data.error === 'locationEnabled (boolean) is required.', 'locationEnabled is required', noEnabled.data);
  const interests = await request('POST', '/api/users/me/onboarding/complete', token, { interests: 'cosplay' });
  check(interests.status === 400 && interests.data.error === 'interests must be an array of interest keys.', 'onboarding: interests must be a list', interests.data);
  const longName = await request('POST', '/api/users/me/onboarding/complete', token, { profile: { firstName: 'x'.repeat(51) } });
  check(longName.status === 400 && /profile\.firstName/.test(longName.data.error), 'onboarding: names are at most 50 characters', longName.data);
  const removeByPath = await request('DELETE', `/api/users/me/devices/${encodeURIComponent(`ExponentPushToken[v${suffix}]`)}`, token);
  check(removeByPath.status === 200, 'DELETE by path still works', removeByPath.status);

  console.log(`\nvalidation: ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
