/**
 * End-to-end smoke test for the onboarding steps 1-4 API, plus auth/logout.
 * Two ways to run it:
 *   1. `npm start` in one terminal, then `node test/smoke.js` in another
 *      (talks to whatever BASE_URL/PORT your real server is on).
 *   2. `npm test` - spins up an ephemeral in-memory MongoDB and a throwaway
 *      server instance automatically (see test/runWithMemoryMongo.js), no
 *      real MongoDB or manually-running server needed.
 *
 * Flow tested here matches the real rule: signup is just step 0 of one
 * continuous onboarding process. There's no token yet at that point, and no
 * server-generated id is handed out as a stand-in credential either - every
 * onboarding-step call below is identified by the plain `email` the client
 * already has. Login refuses to issue a token until onboardingComplete is
 * true - so login only ever succeeds *after* onboarding is finished, not before.
 */

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const sendNotification = require('../scripts/sendNotification');
const Quest = require('../src/models/Quest');
const { createCompletionCode } = require('../src/utils/oauth');
const userModel = require('../src/models/userModel');

async function call(baseUrl, method, path, { token, body, isForm } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let fetchBody = body;
  if (body && !isForm) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: fetchBody });
  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    /* no body */
  }
  return { status: res.status, json };
}

async function run(baseUrlArg) {
  const baseUrl = baseUrlArg || process.env.BASE_URL || 'http://localhost:4000';
  let pass = 0;
  let fail = 0;

  function assert(cond, label, extra) {
    if (cond) {
      pass++;
      console.log(`  ok  - ${label}`);
    } else {
      fail++;
      console.log(`FAIL  - ${label}`);
      if (extra) console.log('        ', JSON.stringify(extra));
    }
  }

  const c = (method, path, opts) => call(baseUrl, method, path, opts);
  const email = `hero_${Date.now()}@example.com`;
  const password = 'Quest@1234';

  console.log('\n--- health ---');
  {
    const r = await c('GET', '/health');
    assert(r.status === 200 && r.json.ok === true, 'GET /health -> 200 { ok: true }', r);
  }

  console.log('\n--- signup (step 0 of onboarding - no token, no id handed out) ---');
  {
    const r = await c('POST', '/api/auth/signup', { body: { email: `weak_${Date.now()}@example.com`, password: 'quest1234', confirmPassword: 'quest1234' } });
    assert(r.status === 400, 'POST /api/auth/signup (weak password) -> 400', r);
  }
  {
    const r = await c('POST', '/api/auth/signup', { body: { email, password, confirmPassword: password } });
    assert(r.status === 201 && !r.json.token, 'POST /api/auth/signup -> 201, no token', r);
  }
  {
    const r = await c('POST', '/api/auth/signup', { body: { email, password, confirmPassword: password } });
    assert(r.status === 409, 'POST /api/auth/signup (duplicate email) -> 409', r);
  }
  {
    const username = `Nova${Date.now()}`.slice(0, 20);
    const r = await c('POST', '/api/auth/signup', {
      body: { identifier: username, password, confirmPassword: password },
    });
    assert(
      r.status === 201 && r.json.user.profile.username === username,
      'POST /api/auth/signup (username + password) -> 201 and username becomes the profile username',
      r
    );
    const readByUsername = await c('GET', `/api/users/me?identifier=${username}`);
    assert(
      readByUsername.status === 200 && readByUsername.json.user.profile.username === username,
      'GET /api/users/me?identifier=username works before sign-in',
      readByUsername
    );
    const duplicate = await c('POST', '/api/auth/signup', {
      body: { identifier: username, password, confirmPassword: password },
    });
    assert(duplicate.status === 409, 'POST /api/auth/signup (duplicate username) -> 409', duplicate);
  }
  {
    const r = await c('POST', '/api/auth/login', { body: { email, password: 'wrong' } });
    assert(r.status === 401, 'POST /api/auth/login (wrong password) -> 401', r);
  }
  {
    const r = await c('POST', '/api/auth/login', { body: { email, password } });
    assert(
      r.status === 403,
      'POST /api/auth/login (onboarding not complete yet) -> 403, blocked until onboarding is done',
      r
    );
  }
  {
    const r = await c('GET', '/api/users/me');
    assert(r.status === 401, 'GET /api/users/me with NO email and NO token -> 401', r);
  }

  console.log('\n--- step 1: profile (identified by email - no token exists yet) ---');
  {
    const r = await c('GET', `/api/users/me?email=${email}`);
    assert(r.status === 200 && r.json.user.email === email, 'GET /api/users/me?email=... -> matches signed-up email', r);
  }
  {
    const r = await c('GET', `/api/users/check-username?username=Ravencaller&email=${email}`);
    assert(r.status === 200 && r.json.available === true, 'GET check-username (free) -> available:true', r);
  }
  {
    const r = await c('PATCH', '/api/users/me/profile', {
      body: { email, firstName: 'Alex', lastName: 'Rivera', username: 'Ravencaller', age: 24, gender: 'Female' },
    });
    assert(
      r.status === 200 && r.json.user.profile.username === 'Ravencaller',
      'PATCH /api/users/me/profile -> profile saved',
      r
    );
  }
  {
    const emailDuplicateUsername = `duplicate_${Date.now()}@example.com`;
    await c('POST', '/api/auth/signup', { body: { email: emailDuplicateUsername, password, confirmPassword: password } });
    const r = await c('PATCH', '/api/users/me/profile', {
      body: { email: emailDuplicateUsername, username: 'Ravencaller' },
    });
    assert(r.status === 409, 'PATCH /api/users/me/profile (duplicate username) -> 409', r);
  }
  {
    const r = await c('PATCH', '/api/users/me/avatar', { body: { email, avatar: 'green-knight' } });
    assert(
      r.status === 200 && r.json.user.profile.avatarKey === 'green-knight',
      'PATCH /api/users/me/avatar -> saved',
      r
    );
  }
  {
    const r = await c('PATCH', '/api/users/me/avatar', { body: { email, avatar: 'not-a-real-avatar' } });
    assert(r.status === 400, 'PATCH /api/users/me/avatar (invalid key) -> 400', r);
  }
  {
    // multipart/form-data - email travels as a form field, not JSON, since
    // there's no token yet; confirms identifyUser reading it after multer parses the body.
    const form = new FormData();
    form.append('email', email);
    form.append('photo', new Blob([Buffer.from('fake-image-bytes')], { type: 'image/png' }), 'test.png');
    const r = await c('POST', '/api/users/me/avatar/photo', { body: form, isForm: true });
    assert(
        r.status === 200 &&
        typeof r.json.user.profile.avatarPhotoUrl === 'string' &&
        r.json.user.profile.avatarPhotoUrl.includes('res.cloudinary.com'),
      'POST /api/users/me/avatar/photo (email as a form field, no token) -> Cloudinary URL set',
      r
    );
  }
  {
    const r = await c('GET', '/api/meta/avatars');
    assert(
      r.status === 200 &&
        Array.isArray(r.json.avatars) &&
        r.json.avatars.length === 100 &&
        r.json.avatars[0].key &&
        r.json.avatars[0].imageUrl.startsWith('http'),
      'GET /api/meta/avatars -> 100 illustrated options with full image URLs',
      r
    );
  }

  console.log('\n--- step 2: faction ---');
  {
    const r = await c('GET', '/api/factions');
    assert(r.status === 200 && r.json.factions.length === 3, 'GET /api/factions -> 3 factions', r);
  }
  {
    const r = await c('POST', '/api/users/me/faction', { body: { email, factionKey: 'anime' } });
    assert(r.status === 200 && r.json.user.faction === 'anime', 'POST faction "anime" -> saved', r);
  }
  {
    const r = await c('POST', '/api/users/me/faction', { body: { email, factionKey: 'bogus' } });
    assert(r.status === 400, 'POST faction (invalid key) -> 400', r);
  }

  console.log('\n--- step 3: interests ---');
  {
    const r = await c('GET', '/api/interests');
    assert(r.status === 200 && r.json.interests.length === 12, 'GET /api/interests -> 12 interests', r);
  }
  {
    const r = await c('PUT', '/api/users/me/interests', {
      body: { email, interests: ['anime', 'comic', 'cosplay'] },
    });
    assert(r.status === 200 && r.json.user.interests.length === 3, 'PUT interests -> saved 3', r);
  }
  {
    const r = await c('PUT', '/api/users/me/interests', { body: { email, interests: ['not-a-real-key'] } });
    assert(r.status === 400, 'PUT interests (invalid key) -> 400', r);
  }

  console.log('\n--- step 4: location & notification preferences ---');
  {
    const r = await c('PATCH', '/api/users/me/preferences/location', {
      body: { email, locationEnabled: true, radiusMiles: 50, lat: 32.7157, lng: -117.1611 },
    });
    assert(
      r.status === 200 &&
        r.json.user.preferences.radiusMiles === 50 &&
        r.json.user.preferences.lastKnownLocation.lat === 32.7157,
      'PATCH preferences/location -> saved radius + coords',
      r
    );
  }
  {
    const r = await c('PATCH', '/api/users/me/preferences/location', { body: { email, radiusMiles: 500 } });
    assert(r.status === 400, 'PATCH preferences/location (radius out of range) -> 400', r);
  }
  {
    const r = await c('PATCH', '/api/users/me/preferences/notifications', {
      body: { email, notificationsEnabled: true },
    });
    assert(
      r.status === 200 && r.json.user.preferences.notificationsEnabled === true,
      'PATCH preferences/notifications -> saved',
      r
    );
  }
  {
    const r = await c('POST', '/api/users/me/devices', {
      body: { email, pushToken: 'fake-fcm-token-123', platform: 'web' },
    });
    assert(r.status === 200 && r.json.user.devices.length === 1, 'POST devices -> registered 1 device', r);
  }

  console.log('\n--- finish onboarding, then login (only now does login succeed) ---');
  let token;
  {
    const r = await c('POST', '/api/users/me/onboarding/complete', { body: { email } });
    assert(r.status === 200 && r.json.user.onboardingComplete === true, 'POST onboarding/complete -> true', r);
  }
  {
    const r = await c('GET', `/api/users/me?email=${email}`);
    const u = r.json.user;
    assert(
      u.profile.username === 'Ravencaller' &&
        u.faction === 'anime' &&
        u.interests.length === 3 &&
        u.preferences.locationEnabled === true &&
        u.onboardingComplete === true &&
        u.passwordHash === undefined,
      'GET /api/users/me?email=... (final) -> full onboarded state, no passwordHash leaked',
      u
    );
  }
  {
    const r = await c('POST', '/api/auth/login', { body: { email, password } });
    assert(
      r.status === 200 && r.json.token && r.json.message === 'Logged in successfully.',
      'POST /api/auth/login (onboarding now complete) -> 200 + token + success message',
      r
    );
    token = r.json.token;
  }
  {
    assert(jwt.decode(token).exp === undefined, 'login token has no time-based expiration', jwt.decode(token));
  }
  {
    const r = await c('POST', '/api/auth/login', { body: { identifier: 'Ravencaller', password } });
    assert(r.status === 200 && r.json.token, 'POST /api/auth/login (username + password) -> 200 + token', r);
  }
  {
    // The welcome notification was created at signup - only visible now, after onboarding + login.
    const r = await c('GET', '/api/users/me/notifications', { token });
    assert(
      r.status === 200 &&
        r.json.notifications.length === 1 &&
        r.json.notifications[0].message.includes('Welcome to CosQuest') &&
        r.json.notifications[0].read === false,
      'GET /api/users/me/notifications (right after first login) -> welcome message waiting, unread',
      r.json
    );
  }
  {
    // Bearer token also works for post-login edits (e.g. changing faction later), not just email.
    const r = await c('GET', '/api/users/me', { token });
    assert(r.status === 200 && r.json.user.email === email, 'GET /api/users/me with Bearer token (post-login) -> works too', r);
  }

  console.log('\n--- Home Dashboard quests ---');
  if (mongoose.connection.readyState === 1) {
    const now = Date.now();
    const questBase = {
      description: 'A test quest for the Home Dashboard.',
      location: { name: 'Test Square', address: 'San Diego', lat: 32.7157, lng: -117.1611 },
      prizePool: { amount: 50000, currency: 'NGN' },
      entryFee: { amount: 500, currency: 'NGN' },
      maxParticipants: 2,
      interests: ['anime', 'cosplay'],
      isPublished: true,
    };
    const liveQuest = await Quest.create({
      ...questBase, slug: `live-test-${Date.now()}`, title: 'Live Test Quest', status: 'live',
      startsAt: new Date(now - 60 * 60 * 1000), endsAt: new Date(now + 60 * 60 * 1000),
    });
    await Quest.create({
      ...questBase, slug: `upcoming-test-${Date.now()}`, title: 'Upcoming Test Quest', status: 'upcoming',
      startsAt: new Date(now + 24 * 60 * 60 * 1000), endsAt: new Date(now + 26 * 60 * 60 * 1000),
    });
    {
      const r = await c('GET', '/api/home/dashboard', { token });
      assert(r.status === 200 && r.json.liveQuest?.id === String(liveQuest._id) && r.json.upcomingQuests.length >= 1, 'GET /api/home/dashboard -> greeting, live quest, upcoming quests, and location-aware data', r);
    }
    {
      const r = await c('GET', '/api/quests?status=live&lat=32.7157&lng=-117.1611&radiusMiles=30');
      assert(r.status === 200 && r.json.quests.some((quest) => quest.id === String(liveQuest._id)), 'GET /api/quests -> finds nearby live quests', r);
    }
    {
      const r = await c('POST', `/api/quests/${liveQuest._id}/registrations`, { token });
      assert(r.status === 201 && r.json.quest.registrationCount === 1 && r.json.quest.isRegistered, 'POST quest registration -> joined and count updated', r);
    }
    {
      const r = await c('POST', `/api/quests/${liveQuest._id}/registrations`, { token });
      assert(r.status === 409, 'POST duplicate quest registration -> 409', r);
    }
    {
      const r = await c('DELETE', `/api/quests/${liveQuest._id}/registrations`, { token });
      assert(r.status === 200 && r.json.quest.registrationCount === 0 && !r.json.quest.isRegistered, 'DELETE quest registration -> cancelled and count updated', r);
    }
  } else {
    console.log('  skip - Home Dashboard API fixture requires the in-process test database');
  }

  console.log('\n--- OAuth completion-code exchange ---');
  if (mongoose.connection.readyState === 1) {
    const oauthUser = await userModel.createUser({ username: `Oauth${Date.now()}`.slice(0, 20) });
    const oauthCode = await createCompletionCode(oauthUser.id);
    const r = await c('POST', '/api/auth/oauth/exchange', { body: { oauthCode } });
    assert(r.status === 200 && r.json.token && r.json.onboardingRequired === true, 'POST OAuth exchange -> token + onboarding required for new OAuth user', r);
    const dashboard = await c('GET', '/api/home/dashboard', { token: r.json.token });
    assert(dashboard.status === 403, 'incomplete OAuth user cannot open the Home Dashboard', dashboard);
    const usedAgain = await c('POST', '/api/auth/oauth/exchange', { body: { oauthCode } });
    assert(usedAgain.status === 400, 'POST OAuth exchange (used code) -> 400', usedAgain);
  }

  console.log('\n--- one-shot onboarding (matches the front-end: everything submitted together at finishOnb()) ---');
  {
    const email2 = `hero2_${Date.now()}@example.com`;
    await c('POST', '/api/auth/signup', { body: { email: email2, password, confirmPassword: password } });

    const r = await c('POST', '/api/users/me/onboarding/complete', {
      body: {
        email: email2,
        profile: { firstName: 'Jamie', lastName: 'Cruz', username: `Jamie${Date.now()}`.slice(0, 20), age: 29, gender: 'Male', avatar: 'caped-champion' },
        faction: 'marvel',
        interests: ['game', 'scifi'],
        preferences: { locationEnabled: true, radiusMiles: 25, lat: 34.05, lng: -118.24, notificationsEnabled: true },
      },
    });
    assert(
      r.status === 200 &&
        r.json.user.faction === 'marvel' &&
        r.json.user.interests.length === 2 &&
        r.json.user.preferences.radiusMiles === 25 &&
        r.json.user.profile.avatarKey === 'caped-champion' &&
        r.json.user.onboardingComplete === true,
      'POST onboarding/complete (one-shot, full payload, via email) -> everything set + onboardingComplete true in a single call',
      r.json
    );

    const login2 = await c('POST', '/api/auth/login', { body: { email: email2, password } });
    assert(login2.status === 200 && login2.json.token, 'POST /api/auth/login (one-shot user, onboarding done) -> 200 + token', login2);
  }
  {
    const email3 = `hero3_${Date.now()}@example.com`;
    await c('POST', '/api/auth/signup', { body: { email: email3, password, confirmPassword: password } });

    const r = await c('POST', '/api/users/me/onboarding/complete', {
      body: { email: email3, profile: { username: 'ab' }, faction: 'not-a-real-faction' }, // username too short + bad faction key
    });
    assert(
      r.status === 400 && Array.isArray(r.json.errors) && r.json.errors.length >= 2,
      'POST onboarding/complete (invalid combined payload) -> 400 with all errors listed',
      r.json
    );

    const check = await c('GET', `/api/users/me?email=${email3}`);
    assert(
      check.json.user.onboardingComplete === false && check.json.user.faction === null,
      'invalid combined payload applied NOTHING - onboarding stays incomplete, faction untouched',
      check.json
    );

    const login3 = await c('POST', '/api/auth/login', { body: { email: email3, password } });
    assert(login3.status === 403, 'POST /api/auth/login (onboarding still incomplete after failed attempt) -> 403', login3);
  }

  console.log('\n--- notifications (in-app broadcast to everyone opted in) ---');
  if (mongoose.connection.readyState === 1) {
    // `token`'s user has notificationsEnabled=true (step 4 above); the one-shot user does too;
    // this 4th user completes onboarding but never touches notificationsEnabled - a real negative case.
    const email4 = `hero4_${Date.now()}@example.com`;
    await c('POST', '/api/auth/signup', { body: { email: email4, password, confirmPassword: password } });
    await c('POST', '/api/users/me/onboarding/complete', {
      body: {
        email: email4,
        profile: { firstName: 'Taylor', lastName: 'Reed', username: `Taylor${Date.now()}`.slice(0, 20), age: 28, gender: 'Female', avatar: 'adventurer' },
        faction: 'none',
        interests: ['music'],
        preferences: { locationEnabled: false, notificationsEnabled: false },
      },
    });
    const login4 = await c('POST', '/api/auth/login', { body: { email: email4, password } });
    const token4 = login4.json.token;

    const sentCount = await sendNotification.run('A CosQuest just opened near you!');
    assert(sentCount === 2, 'sendNotification.run() -> delivered to exactly the 2 opted-in users', sentCount);

    // Every user already has 1 welcome notification from signup - the
    // broadcast adds a 2nd for opted-in users only (newest first).
    const r1 = await c('GET', '/api/users/me/notifications', { token });
    assert(
      r1.status === 200 &&
        r1.json.notifications.length === 2 &&
        r1.json.notifications[0].message === 'A CosQuest just opened near you!' &&
        r1.json.notifications[0].read === false,
      'GET /api/users/me/notifications (opted-in user) -> welcome + broadcast, broadcast unread',
      r1.json
    );

    const r2 = await c('GET', '/api/users/me/notifications', { token: token4 });
    assert(
      r2.status === 200 &&
        r2.json.notifications.length === 1 &&
        r2.json.notifications[0].message.includes('Welcome to CosQuest'),
      'GET /api/users/me/notifications (opted-out user) -> only the welcome message, no broadcast',
      r2.json
    );

    const markRead = await c('PATCH', '/api/users/me/notifications/read', { token });
    assert(markRead.status === 200, 'PATCH /api/users/me/notifications/read -> 200', markRead);

    const r3 = await c('GET', '/api/users/me/notifications', { token });
    assert(
      r3.json.notifications.length === 2 && r3.json.notifications.every((n) => n.read === true),
      'GET /api/users/me/notifications (after marking read) -> both entries read:true',
      r3.json
    );
  } else {
    console.log('  skip - no direct DB connection in this process (running against a separately-started server)');
  }

  console.log('\n--- logout ---');
  const tokenBeforeLogout = token;
  {
    const r = await c('POST', '/api/auth/logout');
    assert(r.status === 401, 'POST /api/auth/logout with NO token -> 401', r);
  }
  {
    const r = await c('POST', '/api/auth/logout', { token });
    assert(r.status === 200 && r.json.message === 'Logged out successfully.', 'POST /api/auth/logout -> 200', r);
  }
  {
    const r = await c('GET', '/api/users/me', { token });
    assert(r.status === 401, 'GET /api/users/me with the just-logged-out token -> 401', r);
  }
  {
    const r = await c('POST', '/api/auth/login', { body: { email, password } });
    assert(r.status === 200 && r.json.token && r.json.token !== tokenBeforeLogout, 'POST /api/auth/login again after logout -> 200 + fresh token', r);
    token = r.json.token;
  }
  {
    const r = await c('GET', '/api/users/me', { token });
    assert(r.status === 200, 'GET /api/users/me with the fresh post-logout token -> 200', r);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  return { pass, fail };
}

module.exports = { run };

if (require.main === module) {
  run().then(({ fail }) => process.exit(fail > 0 ? 1 : 0));
}
