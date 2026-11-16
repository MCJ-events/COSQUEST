// The notifications check: POST /api/users/me/push-test (pushTestController.js).
// Expo (send and receipts) and Google (token and FCM) are stand-ins on
// localhost, so each phone's answer is checked as the app would see it.
const crypto = require('crypto');
const http = require('http');
const User = require('../src/models/User');
const callPush = require('../src/utils/callPush');
const pushTest = require('../src/controllers/pushTestController');
const { signToken } = require('../src/utils/token');

const ENV = ['EXPO_PUSH_URL', 'FCM_SERVICE_ACCOUNT', 'FCM_URL', 'FCM_TOKEN_URL'];

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
    return { status: response.status, data: await response.json().catch(() => null) };
  }

  // Expo's stand-in. A token with "refused" gets an error ticket; one with
  // "creds" an ok ticket whose receipt says InvalidCredentials.
  const expo = { sent: [], receiptAsks: 0 };
  const receipts = {};
  // Google's stand-in. A call token with "mismatch" is refused as another project's.
  const google = { sends: [] };
  const read = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => resolve(b)); });
  const server = http.createServer(async (req, res) => {
    const body = await read(req);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/push/send') {
      const messages = JSON.parse(body);
      expo.sent.push(...messages);
      return res.end(JSON.stringify({ data: messages.map((m) => {
        if (m.to.includes('refused')) return { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } };
        const id = crypto.randomUUID();
        receipts[id] = m.to.includes('creds') ? { status: 'error', message: 'bad key', details: { error: 'InvalidCredentials' } } : { status: 'ok' };
        return { status: 'ok', id };
      }) }));
    }
    if (req.url === '/push/getReceipts') {
      expo.receiptAsks += 1;
      const { ids } = JSON.parse(body);
      return res.end(JSON.stringify({ data: Object.fromEntries(ids.filter((id) => receipts[id]).map((id) => [id, receipts[id]])) }));
    }
    if (req.url === '/token') return res.end(JSON.stringify({ access_token: 'test-access-token', expires_in: 3600 }));
    const message = JSON.parse(body).message;
    google.sends.push({ url: req.url, message });
    if (message.token.includes('mismatch')) {
      res.statusCode = 403;
      return res.end(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', details: [{ errorCode: 'SENDER_ID_MISMATCH' }] } }));
    }
    return res.end(JSON.stringify({ name: 'projects/test-project/messages/1' }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const local = `http://localhost:${server.address().port}`;
  const saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
  const savedTiming = { ...pushTest.timing };
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  Object.assign(process.env, {
    EXPO_PUSH_URL: `${local}/push/send`,
    FCM_URL: local,
    FCM_TOKEN_URL: `${local}/token`,
    FCM_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'test-project', client_email: 'push@test-project.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }),
  });
  Object.assign(pushTest.timing, { callDelayMs: 20, receiptDelayMs: 20 });
  callPush.resetForTests();
  pushTest.resetForTests();

  try {
    const suffix = `${Date.now() % 1e7}${Math.floor(Math.random() * 100)}`;
    const token = (name) => `ExponentPushToken[${name}-${suffix}]`;
    async function makeUser(name, devices) {
      const user = await User.create({
        profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, avatarKey: 'green-knight' },
        email: `${name.toLowerCase()}_${suffix}@example.com`, onboardingComplete: true, faction: 'ascendants', devices,
      });
      return { user, token: signToken(user.id, user.tokenVersion) };
    }
    const t = (minutesAgo) => new Date(Date.now() - minutesAgo * 60e3);
    const nobody = await makeUser('PtNone', []);
    const tester = await makeUser('PtTester', [
      { pushToken: token('ok-own'), platform: 'android', authed: true, voipToken: `fcm-ok-${suffix}`, voipType: 'FCM', registeredAt: t(1) },
      { pushToken: token('creds-own'), platform: 'android', authed: true, voipToken: `fcm-mismatch-${suffix}`, voipType: 'FCM', registeredAt: t(2) },
      { pushToken: token('ok-data'), platform: 'android', authed: true, dataCalls: true, registeredAt: t(3) },
      { pushToken: token('creds-ios'), platform: 'ios', authed: true, registeredAt: t(4) },
      { pushToken: token('refused-old'), platform: 'ios', authed: true, registeredAt: t(5) },
      { pushToken: token('ok-email-only'), platform: 'ios', authed: false, registeredAt: t(0) },
    ]);
    const many = await makeUser('PtMany', Array.from({ length: 12 }, (_, i) => ({ pushToken: token(`ok-many${i}`), platform: 'android', authed: true, registeredAt: t(i) })));

    console.log('\n--- who can ask ---');
    check((await request('POST', '/api/users/me/push-test', null, { kind: 'message' })).status === 401, 'signed out: refused', null);
    const wrongKind = await request('POST', '/api/users/me/push-test', tester.token, { kind: 'sms' });
    check(wrongKind.status === 400, 'kind must be "message" or "call"', wrongKind.data);

    console.log('\n--- no phone ---');
    const none = await request('POST', '/api/users/me/push-test', nobody.token, {});
    check(none.status === 200 && none.data.kind === 'message' && none.data.phones.length === 0 && /No phone is registered/.test(none.data.problems.join(' ')),
      'no phone: says so (no kind: a message test)', none.data);
    check(none.data.server?.fcmProject === 'test-project' && none.data.server?.apns === null, "the server's Firebase project, and no APNs keys", none.data.server);

    console.log('\n--- a message ---');
    pushTest.resetForTests();
    const message = await request('POST', '/api/users/me/push-test', tester.token, { kind: 'message' });
    const phones = message.data.phones || [];
    check(message.status === 200 && phones.length === 5, 'every signed-in phone, not one registered with only an email', message.data);
    check(phones[0]?.platform === 'android' && phones[0].ok === true && /Delivered/.test(phones[0].detail), 'the latest phone first, delivered (from the receipt)', phones[0]);
    check(phones[1]?.ok === false && /InvalidCredentials/.test(phones[1].detail) && /eas credentials/.test(phones[1].detail), "the receipt's InvalidCredentials, with the hint", phones[1]);
    check(phones[4]?.ok === false && /DeviceNotRegistered/.test(phones[4].detail) && /reopen the app/.test(phones[4].detail), 'a refused ticket, with the hint', phones[4]);
    check(phones.every((p) => p.token.length < 30 && p.token.includes('…')), 'tokens are shortened', phones.map((p) => p.token));
    check(expo.sent.filter((m) => m.data?.type === 'test').length === 5 && expo.sent.every((m) => m.title === 'CosQuest test' && m.channelId === 'messages'), 'a real push to each phone', expo.sent.length);

    const again = await request('POST', '/api/users/me/push-test', tester.token, { kind: 'call' });
    check(again.status === 429, 'one test every 10 seconds', again.data);

    console.log('\n--- a call ---');
    pushTest.resetForTests();
    expo.sent.length = 0;
    const call = await request('POST', '/api/users/me/push-test', tester.token, { kind: 'call' });
    const rang = call.data.phones || [];
    check(call.status === 200 && rang.length === 5, 'each phone rung', call.data);
    check(rang[0]?.way === "the phone's own call screen" && rang[0].ok === true && /Google accepted/.test(rang[0].detail), 'a call token: its own call screen, Google accepted it', rang[0]);
    check(rang[1]?.ok === false && /FCM 403 SENDER_ID_MISMATCH/.test(rang[1].detail) && /another Firebase project/.test(rang[1].detail), "Google's refusal (SENDER_ID_MISMATCH), with the hint", rang[1]);
    check(rang[2]?.way === "the app's own ringing (data push)" && rang[2].ok === true, 'dataCalls: the data push', rang[2]);
    check(/ringtone notification \(no call token/.test(rang[3]?.way) && rang[3].ok === false && /InvalidCredentials/.test(rang[3].detail), 'no call token: the ringtone push, with its receipt', rang[3]);
    const fcm = google.sends.find((s) => s.message.token === `fcm-ok-${suffix}`);
    const event = fcm && JSON.parse(fcm.message.data.incomingCall);
    check(fcm?.url === '/v1/projects/test-project/messages:send' && fcm.message.data.messageType === 'incomingCall' && /^test-/.test(event.serverCallId) && event.metadata.firebaseProject === 'test-project',
      'the FCM call push: a test- call id, and the server\'s Firebase project', event);
    const data = expo.sent.find((m) => m.data?.type === 'call_incoming');
    const ringtone = expo.sent.find((m) => m.data?.type === 'call');
    check(data && /^test-/.test(data.data.callId) && !data.title && ringtone?.sound === 'ringtone.wav' && ringtone.channelId === 'calls' && ringtone.data.callId === data.data.callId,
      'the data push and the ringtone push carry the same test call', { data, ringtone });
    const decline = await request('POST', `/api/call-decline/${event?.serverCallId}`, null, { pass: event?.metadata?.declinePass });
    check(decline.status === 404, "the test call's decline pass declines nothing", decline.data);

    console.log('\n--- limits and setup ---');
    pushTest.resetForTests();
    const capped = await request('POST', '/api/users/me/push-test', many.token, { kind: 'message' });
    check(capped.status === 200 && capped.data.phones.length === 10, 'at most 10 phones (the latest)', capped.data.phones?.length);
    pushTest.resetForTests();
    delete process.env.FCM_SERVICE_ACCOUNT;
    const noKeys = await request('POST', '/api/users/me/push-test', tester.token, { kind: 'call' });
    check(noKeys.data.server?.fcmProject === null && /FCM_SERVICE_ACCOUNT is not set/.test(noKeys.data.phones?.[0]?.way || ''),
      'no service account: the ringtone push, and says why', noKeys.data);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    Object.assign(pushTest.timing, savedTiming);
    callPush.resetForTests();
    pushTest.resetForTests();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(`\npush test: ${ok} passed, ${bad} failed`);
  return { pass: ok, fail: bad };
}

module.exports = { run };
