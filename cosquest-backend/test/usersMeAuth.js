/**
 * /api/users/me* needs a signed-in session token on every read and write.
 * An email, username or identifier (query, JSON body or multipart field),
 * a password in the body, or HTTP Basic credentials never stand in for it,
 * and the token goes through the full checks: signature, logout
 * (tokenVersion) and single-device sign-in (currentSessionId).
 *
 * Run from smoke.js against the same ephemeral server.
 */
const jwt = require('jsonwebtoken');
const User = require('../src/models/User');

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;
  function check(cond, label, extra) {
    if (cond) {
      pass++;
      console.log(`  ok  - ${label}`);
    } else {
      fail++;
      console.log(`FAIL  - ${label}`);
      if (extra !== undefined) console.log('        ', JSON.stringify(extra));
    }
  }

  async function call(method, path, { token, authorization, body, form } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (authorization) headers.Authorization = authorization;
    let payload;
    if (form) {
      payload = form;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* no body */
    }
    return { status: res.status, data };
  }

  const stamp = Date.now().toString(36);
  const password = 'Quest@1234';

  async function signup(tag) {
    const email = `meauth_${tag}_${stamp}@example.com`;
    const r = await call('POST', '/api/auth/signup', { body: { email, password, confirmPassword: password } });
    return { email, token: r.data?.token, id: r.data?.user?.id };
  }

  function onboarding(username) {
    return {
      profile: { firstName: 'Me', lastName: 'Auth', username, age: 30, gender: 'Female', avatar: 'adventurer' },
      faction: 'ascendants',
      interests: ['anime'],
      preferences: { notificationsEnabled: true },
      location: { locationEnabled: true, radiusMiles: 50, lat: 6.5244, lng: 3.3792 },
    };
  }

  console.log('\n--- /api/users/me* requires a session token (no email/username stand-in) ---');

  // Victim: fully onboarded, with contact details and a signed-in device.
  const victim = await signup('victim');
  const victimUsername = `Vic${stamp}`.slice(0, 20);
  const done = await call('POST', '/api/users/me/onboarding/complete', { token: victim.token, body: onboarding(victimUsername) });
  check(done.status === 200 && done.data.user.onboardingComplete === true, 'victim fixture onboards with its signup token', done);
  await call('PATCH', '/api/users/me/contact', { token: victim.token, body: { phone: '+15550001111', businessAddress: '1 Victim Road' } });
  await call('POST', '/api/users/me/devices', { token: victim.token, body: { pushToken: `ExponentPushToken[victim-${stamp}]`, platform: 'ios' } });
  const before = await User.findById(victim.id).lean();

  // Attacker: has their own valid account and session.
  const attacker = await signup('attacker');
  const attackerUsername = `Att${stamp}`.slice(0, 20);
  await call('POST', '/api/users/me/onboarding/complete', { token: attacker.token, body: onboarding(attackerUsername) });

  const q = (path, params) => `${path}?${new URLSearchParams(params).toString()}`;
  const attackerPushToken = `ExponentPushToken[attacker-${stamp}]`;

  // Every /me endpoint that used to accept an identifier, with a body that
  // would change something if it were accepted.
  const endpoints = [
    { method: 'GET', path: '/api/users/me' },
    { method: 'PATCH', path: '/api/users/me/profile', body: { firstName: 'Hijacked', bio: 'changed' } },
    { method: 'PATCH', path: '/api/users/me/avatar', body: { avatar: 'green-knight' } },
    { method: 'POST', path: '/api/users/me/avatar/photo', multipart: true },
    { method: 'GET', path: '/api/users/me/contact' },
    { method: 'PATCH', path: '/api/users/me/contact', body: { phone: '+15559999999', businessAddress: 'Somewhere else' } },
    { method: 'POST', path: '/api/users/me/faction', body: { factionKey: 'icons' } },
    { method: 'PUT', path: '/api/users/me/interests', body: { interests: ['music'] } },
    { method: 'PATCH', path: '/api/users/me/preferences/notifications', body: { notificationsEnabled: false } },
    { method: 'PATCH', path: '/api/users/me/preferences/location', body: { locationEnabled: false } },
    { method: 'POST', path: '/api/users/me/devices', body: { pushToken: attackerPushToken, platform: 'android' } },
    { method: 'DELETE', path: '/api/users/me/devices', body: { pushToken: `ExponentPushToken[victim-${stamp}]` } },
    { method: 'POST', path: '/api/users/me/onboarding/complete', body: onboarding(victimUsername) },
  ];

  const wrongSecretToken = jwt.sign(
    { sub: victim.id, tokenVersion: before.tokenVersion, sessionId: before.currentSessionId },
    'not-the-server-secret'
  );

  function request(ep, { token, authorization, idField, idValue, extraBody = {} }) {
    const params = idField ? { [idField]: idValue } : null;
    const path = params ? q(ep.path, params) : ep.path;
    if (ep.multipart) {
      const form = new FormData();
      if (idField) form.append(idField, idValue);
      form.append('photo', new Blob([Buffer.from('not really a png')], { type: 'image/png' }), 'x.png');
      return call(ep.method, path, { token, authorization, form });
    }
    const body = ep.body || ep.method !== 'GET' ? { ...(ep.body || {}), ...(idField ? { [idField]: idValue } : {}), ...extraBody } : undefined;
    return call(ep.method, path, { token, authorization, body });
  }

  for (const ep of endpoints) {
    const label = `${ep.method} ${ep.path}`;
    const attempts = [
      ['no token', {}],
      ["no token + victim's email", { idField: 'email', idValue: victim.email }],
      ["no token + victim's username", { idField: 'username', idValue: victimUsername }],
      ["no token + victim's identifier", { idField: 'identifier', idValue: victim.email }],
      ['no token + email and password in the body', { idField: 'email', idValue: victim.email, extraBody: { password } }],
      ['HTTP Basic email:password', { authorization: `Basic ${Buffer.from(`${victim.email}:${password}`).toString('base64')}` }],
      ['malformed Bearer token', { token: 'not-a-jwt' }],
      ['token signed with the wrong secret', { token: wrongSecretToken }],
    ];
    for (const [what, opts] of attempts) {
      const r = await request(ep, opts);
      check(r.status === 401 && !r.data?.user && !r.data?.contact, `${label} (${what}) -> 401, nothing returned`, r);
    }
  }

  // Another signed-in user naming the victim acts only on their own account.
  {
    const r = await call('GET', q('/api/users/me', { email: victim.email }), { token: attacker.token });
    check(r.status === 200 && r.data.user.email === attacker.email, "GET /api/users/me?email=<victim> with another user's token -> the caller's own profile", r.data?.user?.email);
  }
  {
    const r = await call('GET', q('/api/users/me/contact', { username: victimUsername }), { token: attacker.token });
    check(r.status === 200 && r.data.contact.phone !== '+15550001111', "GET contact naming the victim with another user's token -> not the victim's contact", r.data);
  }
  for (const ep of endpoints.filter((e) => e.method !== 'GET' && !e.multipart && e.path !== '/api/users/me/onboarding/complete')) {
    await request(ep, { token: attacker.token, idField: 'email', idValue: victim.email });
    await request(ep, { token: attacker.token, idField: 'username', idValue: victimUsername });
  }

  // Stale sessions: signed in elsewhere, and logged out.
  {
    const relogin = await call('POST', '/api/auth/login', { body: { email: victim.email, password } });
    check(relogin.status === 200 && relogin.data.token, 'victim signs in again (rotates the session)', relogin.status);
    for (const ep of endpoints) {
      const r = await request(ep, { token: victim.token });
      check(r.status === 401, `${ep.method} ${ep.path} with a token from an older sign-in -> 401 (single-device rule)`, r);
    }
    const current = relogin.data.token;
    const me = await call('GET', '/api/users/me', { token: current });
    check(me.status === 200 && me.data.user.email === victim.email, 'GET /api/users/me with the current session token -> 200', me.status);

    // Compare against the state just before any of the attempts above.
    const after = await User.findById(victim.id).lean();
    check(after.profile.firstName === before.profile.firstName && after.profile.bio === before.profile.bio, "victim's profile unchanged", after.profile);
    check(after.profile.avatarKey === before.profile.avatarKey && after.profile.avatarPhotoUrl === before.profile.avatarPhotoUrl, "victim's avatar unchanged", after.profile);
    check(after.contact?.phone === '+15550001111' && after.contact?.businessAddress === '1 Victim Road', "victim's contact unchanged", after.contact);
    check(after.faction === 'ascendants' && JSON.stringify(after.interests) === JSON.stringify(['anime']), "victim's faction and interests unchanged", { faction: after.faction, interests: after.interests });
    check(after.preferences.notificationsEnabled === true && after.preferences.locationEnabled === true, "victim's preferences unchanged", after.preferences);
    check(
      after.devices.length === 1 && after.devices[0].pushToken === `ExponentPushToken[victim-${stamp}]` && !after.devices.some((d) => d.pushToken === attackerPushToken),
      "victim's devices unchanged: no foreign device added, own device not removed",
      after.devices
    );

    await call('POST', '/api/auth/logout', { token: current });
    const loggedOut = await call('GET', '/api/users/me', { token: current });
    check(loggedOut.status === 401, 'GET /api/users/me with a logged-out token -> 401', loggedOut);
    const loggedOutWrite = await call('PATCH', '/api/users/me/profile', { token: current, body: { bio: 'after logout' } });
    check(loggedOutWrite.status === 401, 'PATCH /api/users/me/profile with a logged-out token -> 401', loggedOutWrite);
  }

  console.log('\n--- GET /api/users/check-username (public, boolean only) ---');
  {
    const taken = await call('GET', q('/api/users/check-username', { username: victimUsername }));
    check(
      taken.status === 200 && taken.data.available === false && Object.keys(taken.data).sort().join(',') === 'available,username',
      'check-username (taken, no token) -> available:false and nothing else',
      taken.data
    );
    const free = await call('GET', q('/api/users/check-username', { username: `Free${stamp}`.slice(0, 20) }));
    check(free.status === 200 && free.data.available === true, 'check-username (free, no token) -> available:true', free.data);
    const withEmail = await call('GET', q('/api/users/check-username', { username: victimUsername, email: victim.email }));
    check(withEmail.status === 200 && withEmail.data.available === false, "check-username with the owner's email but no token -> still taken (email is ignored)", withEmail.data);
    const own = await call('GET', q('/api/users/check-username', { username: attackerUsername }), { token: attacker.token });
    check(own.status === 200 && own.data.available === true, "check-username for your own current name, with your token -> available", own.data);
    const othersName = await call('GET', q('/api/users/check-username', { username: victimUsername }), { token: attacker.token });
    check(othersName.status === 200 && othersName.data.available === false, "check-username for someone else's name, with a token -> taken", othersName.data);
    const missing = await call('GET', '/api/users/check-username');
    check(missing.status === 400, 'check-username with no username -> 400', missing);
    const repeated = await call('GET', '/api/users/check-username?username=a&username=b');
    check(repeated.status === 400, 'check-username with a repeated username param -> 400', repeated);
  }

  console.log('\n--- normal token flow: signup -> onboarding steps -> login -> edits -> devices ---');
  {
    const user = await signup('flow');
    check(Boolean(user.token), 'signup returns a session token', user);
    const username = `Flow${stamp}`.slice(0, 20);
    const t = user.token;
    const steps = [
      ['GET', '/api/users/me', undefined, (d) => d.user.email === user.email],
      ['PATCH', '/api/users/me/profile', { email: user.email, firstName: 'Flo', lastName: 'W', username, age: 22, gender: 'Male' }, (d) => d.user.profile.username === username],
      ['PATCH', '/api/users/me/avatar', { email: user.email, avatar: 'green-knight' }, (d) => d.user.profile.avatarKey === 'green-knight'],
      ['POST', '/api/users/me/faction', { email: user.email, factionKey: 'icons' }, (d) => d.user.faction === 'icons'],
      ['PUT', '/api/users/me/interests', { email: user.email, interests: ['game'] }, (d) => d.user.interests.join() === 'game'],
      ['PATCH', '/api/users/me/preferences/notifications', { email: user.email, notificationsEnabled: true }, (d) => d.user.preferences.notificationsEnabled === true],
      ['PATCH', '/api/users/me/preferences/location', { email: user.email, locationEnabled: true, radiusMiles: 50, lat: 6.5, lng: 3.3 }, (d) => d.user.preferences.locationEnabled === true],
      ['PATCH', '/api/users/me/contact', { email: user.email, phone: '+15551234567', businessAddress: '2 Flow St' }, (d) => d.contact.phone === '+15551234567'],
      ['GET', '/api/users/me/contact', undefined, (d) => d.contact.businessAddress === '2 Flow St'],
      ['POST', '/api/users/me/onboarding/complete', { email: user.email }, (d) => d.user.onboardingComplete === true],
    ];
    for (const [method, path, body, ok] of steps) {
      const r = await call(method, path, { token: t, body });
      check(r.status === 200 && ok(r.data), `${method} ${path} with the signup token -> 200`, r);
    }
    const login = await call('POST', '/api/auth/login', { body: { email: user.email, password } });
    check(login.status === 200 && login.data.token, 'login after onboarding -> token', login.status);
    const lt = login.data.token;
    const edit = await call('PATCH', '/api/users/me/profile', { token: lt, body: { bio: 'edited after login' } });
    check(edit.status === 200 && edit.data.user.profile.bio === 'edited after login', 'PATCH /api/users/me/profile after login -> 200', edit);
    const photoForm = new FormData();
    photoForm.append('email', user.email);
    photoForm.append('photo', new Blob([Buffer.from('not really a png')], { type: 'application/pdf' }), 'x.pdf');
    const photo = await call('POST', '/api/users/me/avatar/photo', { token: lt, form: photoForm });
    check(photo.status === 400, 'POST /api/users/me/avatar/photo with a token reaches the upload checks (bad type -> 400, not 401)', photo);
    const pushToken = `ExponentPushToken[flow-${stamp}]`;
    const reg = await call('POST', '/api/users/me/devices', { token: lt, body: { pushToken, platform: 'ios' } });
    check(reg.status === 200 && reg.data.user.devices.some((d) => d.pushToken === pushToken && d.authed === true), 'POST /api/users/me/devices with a token -> registered, trusted for pushes', reg.data);
    const unreg = await call('DELETE', '/api/users/me/devices', { token: lt, body: { pushToken } });
    check(unreg.status === 200 && !unreg.data.user.devices.some((d) => d.pushToken === pushToken), 'DELETE /api/users/me/devices with a token -> removed', unreg.data);
    const points = await call('GET', '/api/users/me/points', { token: lt });
    check(points.status === 200, 'GET /api/users/me/points after onboarding -> 200', points.status);
  }

  console.log(`\n${pass} passed, ${fail} failed (users/me auth)\n`);
  return { pass, fail };
}

module.exports = { run };
