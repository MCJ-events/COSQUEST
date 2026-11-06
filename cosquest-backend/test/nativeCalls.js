// Calls ringing with the phone's own call screen (src/utils/callPush.js):
// the call token on POST /api/users/me/devices, the APNs VoIP push and the
// FCM data message (sent for real, to stand-ins for Apple and Google on
// localhost), "call ended" to Android when the ring is over, the ringtone
// push for everyone else (again on iPhones while still ringing), and dead
// tokens. Expo is replaced by a capture.
const crypto = require('crypto');
const http = require('http');
const http2 = require('http2');
const jwt = require('jsonwebtoken');
const User = require('../src/models/User');
const push = require('../src/utils/push');
const callPush = require('../src/utils/callPush');
const { signToken } = require('../src/utils/token');

const ENV = ['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_PRIVATE_KEY', 'APNS_BUNDLE_ID', 'APNS_PRODUCTION', 'APNS_URL', 'FCM_SERVICE_ACCOUNT', 'FCM_URL', 'FCM_TOKEN_URL', 'CALL_PUSH_REPEAT_MS'];

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;
  function check(ok, name, value) {
    if (ok) { pass += 1; console.log(`  ok  - ${name}`); }
    else { fail += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 2000)); }
  }
  async function request(method, path, token, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json().catch(() => null) };
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function waitFor(list, predicate, ms = 3000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const found = list.find(predicate);
      if (found) return found;
      await sleep(25);
    }
    return null;
  }

  // Apple's stand-in (HTTP/2): records each push; a token starting "dead" is gone.
  const apple = [];
  const appleServer = http2.createServer();
  appleServer.on('stream', (stream, headers) => {
    let body = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => { body += chunk; });
    stream.on('end', () => {
      const token = decodeURIComponent(headers[':path'].split('/').pop());
      apple.push({ headers, token, body: JSON.parse(body) });
      if (token.startsWith('dead')) {
        stream.respond({ ':status': 410, 'content-type': 'application/json' });
        stream.end(JSON.stringify({ reason: 'Unregistered' }));
      } else {
        stream.respond({ ':status': 200 });
        stream.end();
      }
    });
  });
  // Google's stand-in: the OAuth token, and FCM sends.
  const google = { tokens: [], sends: [] };
  const googleServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/token') {
        google.tokens.push(Object.fromEntries(new URLSearchParams(body)));
        return res.end(JSON.stringify({ access_token: 'test-access-token', expires_in: 3600 }));
      }
      const message = JSON.parse(body).message;
      google.sends.push({ url: req.url, authorization: req.headers.authorization, message });
      if (message.token.startsWith('dead')) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }));
      }
      return res.end(JSON.stringify({ name: 'projects/test-project/messages/1' }));
    });
  });
  await new Promise((resolve) => appleServer.listen(0, resolve));
  await new Promise((resolve) => googleServer.listen(0, resolve));

  const apnsKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const googleKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
  function keysOn() {
    Object.assign(process.env, {
      APNS_KEY_ID: 'KEY1234567',
      APNS_TEAM_ID: 'TEAM123456',
      // Written with \n, as in a one-line env var.
      APNS_PRIVATE_KEY: apnsKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n'),
      APNS_BUNDLE_ID: 'com.cosquest.app',
      APNS_URL: `http://localhost:${appleServer.address().port}`,
      FCM_SERVICE_ACCOUNT: JSON.stringify({
        project_id: 'test-project',
        client_email: 'push@test-project.iam.gserviceaccount.com',
        private_key: googleKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      }),
      FCM_URL: `http://localhost:${googleServer.address().port}`,
      FCM_TOKEN_URL: `http://localhost:${googleServer.address().port}/token`,
    });
  }
  function keysOff() {
    for (const name of ENV) delete process.env[name];
    callPush.resetForTests();
  }

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const made = await Promise.all(['Caller', 'Iphone', 'Droid', 'Plainios', 'Other'].map((name) => User.create({
    profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, lastName: 'Ring', avatarKey: 'green-knight' },
    onboardingComplete: true, faction: 'ascendants', preferences: { notificationsEnabled: true },
  })));
  const [caller, iphone, droid, plainIos, other] = made.map((user) => ({
    id: user.id, username: user.profile.username, token: signToken(user.id, user.tokenVersion),
    pushToken: `ExponentPushToken[${user.profile.username}]`,
  }));
  const voip = { iphone: `a1b2c3${suffix}`, droid: `fcm-${suffix}` };
  const sent = push.captureForTests();
  const toPhone = (user) => sent.filter((m) => m.to === user.pushToken && m.data?.type === 'call');

  async function dmWith(user) {
    return (await request('POST', '/api/chats/dm', caller.token, { username: user.username })).data.chat.id;
  }
  async function startCall(chatId, type = 'audio') {
    const started = await request('POST', `/api/chats/${chatId}/calls`, caller.token, { type });
    return started.data?.call?.id;
  }

  try {
    console.log('\n--- calls on the phone\'s own call screen ---');
    keysOff();

    // Registering the call token.
    const before = await request('POST', '/api/users/me/devices', iphone.token, { pushToken: iphone.pushToken, platform: 'ios', voipToken: voip.iphone, voipType: 'APNS_VOIP' });
    const stored = before.data?.user?.devices?.find((d) => d.pushToken === iphone.pushToken);
    check(before.status === 200 && stored?.voipToken === voip.iphone && stored.voipType === 'APNS_VOIP' && before.data.callRinging === 'push',
      'the call token is stored with the phone; without Apple\'s key its calls ring with the push', before.data);
    const noType = await request('POST', '/api/users/me/devices', iphone.token, { pushToken: iphone.pushToken, platform: 'ios', voipToken: voip.iphone });
    const badType = await request('POST', '/api/users/me/devices', iphone.token, { pushToken: iphone.pushToken, platform: 'ios', voipToken: voip.iphone, voipType: 'GCM' });
    check(noType.status === 400 && badType.status === 400, 'voipToken needs voipType APNS_VOIP or FCM', { noType, badType });

    keysOn();
    const native = await request('POST', '/api/users/me/devices', iphone.token, { pushToken: iphone.pushToken, platform: 'ios', voipToken: voip.iphone, voipType: 'APNS_VOIP' });
    const droidReg = await request('POST', '/api/users/me/devices', droid.token, { pushToken: droid.pushToken, platform: 'android', voipToken: voip.droid, voipType: 'FCM' });
    await request('POST', '/api/users/me/devices', plainIos.token, { pushToken: plainIos.pushToken, platform: 'ios' });
    check(native.data?.callRinging === 'native' && droidReg.data?.callRinging === 'native', 'with the keys set, those phones ring with their own call screen', { native: native.data?.callRinging, droid: droidReg.data?.callRinging });

    // One phone, one account: the token moves to whoever signs in on it.
    await request('POST', '/api/users/me/devices', other.token, { pushToken: other.pushToken, platform: 'ios', voipToken: voip.iphone, voipType: 'APNS_VOIP' });
    const iphoneNow = (await User.findById(iphone.id).lean()).devices.find((d) => d.pushToken === iphone.pushToken);
    check(iphoneNow.voipToken === null && iphoneNow.pushToken === iphone.pushToken, 'a call token signed in on another account leaves the previous one', iphoneNow);
    const cleared = await request('POST', '/api/users/me/devices', other.token, { pushToken: other.pushToken, platform: 'ios', voipToken: null });
    check(cleared.data?.user?.devices?.find((d) => d.pushToken === other.pushToken)?.voipToken === null && cleared.data.callRinging === 'push', 'voipToken null takes it off', cleared.data);
    await request('POST', '/api/users/me/devices', iphone.token, { pushToken: iphone.pushToken, platform: 'ios', voipToken: voip.iphone, voipType: 'APNS_VOIP' });

    // iPhone: an APNs VoIP push with the call, no ringtone push.
    const iphoneChat = await dmWith(iphone);
    const videoCall = await startCall(iphoneChat, 'video');
    const voipPush = await waitFor(apple, (p) => p.body?.incomingCall?.serverCallId === videoCall);
    const h = voipPush?.headers || {};
    let verified = null;
    try {
      verified = jwt.verify(String(h.authorization).replace(/^bearer /, ''), apnsKeys.publicKey.export({ type: 'spki', format: 'pem' }), { algorithms: ['ES256'], complete: true });
    } catch (err) { verified = { error: err.message }; }
    const expiresIn = Number(h['apns-expiration']) - Math.floor(Date.now() / 1000);
    check(voipPush && voipPush.token === voip.iphone && h['apns-topic'] === 'com.cosquest.app.voip' && h['apns-push-type'] === 'voip' && h['apns-priority'] === '10' && expiresIn > 50 && expiresIn <= 60,
      'iPhone: a VoIP push to Apple (topic <bundle id>.voip, priority 10, expires with the minute)', { headers: h, expiresIn });
    check(verified?.header?.kid === 'KEY1234567' && verified.payload?.iss === 'TEAM123456', 'the Apple provider token is signed with the .p8 key (kid, team)', verified);
    const event = voipPush?.body?.incomingCall || {};
    check(event.hasVideo === true && event.caller?.displayName && event.caller.id === caller.id && /^[0-9a-f-]{36}$/.test(event.eventId) && event.metadata?.chatId === iphoneChat && event.startedAt,
      'the call as the call screen shows it: caller, video, chat, a fresh eventId', event);
    await sleep(200);
    check(!toPhone(iphone).length, 'a phone rung on its own call screen gets no ringtone push as well', toPhone(iphone));
    await request('POST', `/api/calls/${videoCall}/end`, caller.token);

    // Android: an FCM data message; "call ended" when the caller hangs up.
    const droidChat = await dmWith(droid);
    const cancelled = await startCall(droidChat);
    const ring = await waitFor(google.sends, (s) => s.message?.data?.messageType === 'incomingCall' && JSON.parse(s.message.data.incomingCall).serverCallId === cancelled);
    const assertion = google.tokens[0]?.assertion;
    let grant = null;
    try {
      grant = jwt.verify(assertion, googleKeys.publicKey.export({ type: 'spki', format: 'pem' }), { algorithms: ['RS256'], audience: 'https://oauth2.googleapis.com/token' });
    } catch (err) { grant = { error: err.message }; }
    check(ring && ring.url === '/v1/projects/test-project/messages:send' && ring.authorization === 'Bearer test-access-token' && ring.message.token === voip.droid && ring.message.android?.priority === 'HIGH' && ring.message.android.ttl === '60s',
      'Android: an FCM data message to Google, high priority, for the minute', ring);
    check(grant?.iss === 'push@test-project.iam.gserviceaccount.com' && grant.scope === 'https://www.googleapis.com/auth/firebase.messaging',
      'the Google token is asked for with the service account', grant);
    const ringPass = ring ? JSON.parse(ring.message.data.incomingCall).metadata?.declinePass : null;
    check(callPush.verifyDeclinePass(ringPass, cancelled) === droid.id, 'the ring carries a decline pass for this call and this person (declining with the app closed)', ringPass);
    await sleep(200);
    check(!toPhone(droid).length, 'no ringtone push to that Android phone either', toPhone(droid));
    await request('POST', `/api/calls/${cancelled}/end`, caller.token);
    const ended = await waitFor(google.sends, (s) => s.message?.data?.messageType === 'callEnded');
    const endedBody = ended ? JSON.parse(ended.message.data.callEnded) : null;
    check(endedBody?.serverCallId === cancelled && endedBody.reason === 'remoteEnded' && endedBody.eventId && ended.message.token === voip.droid,
      'the caller hangs up: "call ended" stops the Android call screen', endedBody);

    // Declined (on this or another phone): "call ended", declinedElsewhere.
    google.sends.length = 0;
    const declined = await startCall(droidChat);
    await waitFor(google.sends, (s) => s.message?.data?.messageType === 'incomingCall');
    await request('POST', `/api/calls/${declined}/decline`, droid.token);
    const declinedEnd = await waitFor(google.sends, (s) => s.message?.data?.messageType === 'callEnded');
    check(declinedEnd && JSON.parse(declinedEnd.message.data.callEnded).reason === 'declinedElsewhere', 'declined: the other phones stop (declinedElsewhere)', declinedEnd?.message?.data);

    // Answered: no "call ended" (it would hang up the phone that answered).
    google.sends.length = 0;
    const answered = await startCall(droidChat);
    await waitFor(google.sends, (s) => s.message?.data?.messageType === 'incomingCall');
    const accept = await request('POST', `/api/calls/${answered}/accept`, droid.token);
    await sleep(400);
    check(accept.status === 200 && !google.sends.some((s) => s.message?.data?.messageType === 'callEnded'), 'answered: no "call ended" to the phone in the call', google.sends.map((s) => s.message.data));
    await request('POST', `/api/calls/${answered}/end`, caller.token);
    await sleep(200);
    check(!google.sends.some((s) => s.message?.data?.messageType === 'callEnded'), 'nor when that call ends later (its call screen hangs up from the app)', google.sends.map((s) => s.message.data));

    // An iPhone without a call token: the ringtone push, again while still ringing.
    process.env.CALL_PUSH_REPEAT_MS = '300';
    const plainChat = await dmWith(plainIos);
    const plainCall = await startCall(plainChat);
    await waitFor(sent, (m) => m.to === plainIos.pushToken && m.data?.callId === plainCall);
    const again = await waitFor(sent, (m) => m.to === plainIos.pushToken && m.data?.callId === plainCall && m.ttl < 60, 2000);
    const first = toPhone(plainIos)[0];
    check(first?.sound === 'ringtone.wav' && first.ttl === 60 && first.collapseId === `call-${plainCall}`, 'no call token: the ringtone push, for the minute', first);
    check(again && again.sound === 'ringtone.wav' && again.collapseId === first?.collapseId, 'iPhone still ringing: the ringtone push again (iOS plays at most 30 s)', again);
    await request('POST', `/api/calls/${plainCall}/end`, caller.token);
    await sleep(400);
    const afterEnd = toPhone(plainIos).length;
    await sleep(700);
    check(toPhone(plainIos).length === afterEnd, 'and stops once the call stops ringing', toPhone(plainIos).length - afterEnd);
    delete process.env.CALL_PUSH_REPEAT_MS;

    // Dead tokens: taken off, and that call still rings with the push.
    await User.updateOne({ _id: iphone.id, 'devices.pushToken': iphone.pushToken }, { $set: { 'devices.$.voipToken': `dead-${suffix}` } });
    await User.updateOne({ _id: droid.id, 'devices.pushToken': droid.pushToken }, { $set: { 'devices.$.voipToken': `dead-fcm-${suffix}` } });
    sent.length = 0;
    const deadIos = await startCall(iphoneChat);
    const fallback = await waitFor(sent, (m) => m.to === iphone.pushToken && m.data?.callId === deadIos);
    const iphoneAfter = (await User.findById(iphone.id).lean()).devices.find((d) => d.pushToken === iphone.pushToken);
    check(fallback && iphoneAfter.voipToken === null && iphoneAfter.voipType === null, 'Apple says the token is gone: it is taken off, and the call rings with the push', { fallback: Boolean(fallback), device: iphoneAfter });
    await request('POST', `/api/calls/${deadIos}/end`, caller.token);
    const deadDroid = await startCall(droidChat);
    const droidFallback = await waitFor(sent, (m) => m.to === droid.pushToken && m.data?.callId === deadDroid);
    const droidAfter = (await User.findById(droid.id).lean()).devices.find((d) => d.pushToken === droid.pushToken);
    check(droidFallback && droidAfter.voipToken === null, 'Google says the token is gone: the same', { fallback: Boolean(droidFallback), device: droidAfter });
    await request('POST', `/api/calls/${deadDroid}/end`, caller.token);

    // Keys taken away: back to the ringtone push.
    await request('POST', '/api/users/me/devices', iphone.token, { pushToken: iphone.pushToken, platform: 'ios', voipToken: voip.iphone, voipType: 'APNS_VOIP' });
    keysOff();
    sent.length = 0;
    const appleBefore = apple.length;
    const noKeys = await startCall(iphoneChat);
    const plain = await waitFor(sent, (m) => m.to === iphone.pushToken && m.data?.callId === noKeys);
    check(plain && apple.length === appleBefore, 'without Apple\'s key: the ringtone push, nothing to Apple', { plain: Boolean(plain) });
    await request('POST', `/api/calls/${noKeys}/end`, caller.token);
  } catch (error) {
    check(false, 'native calls suite threw', error.stack);
  } finally {
    push.resetForTests();
    for (const name of ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    callPush.resetForTests();
    appleServer.close();
    googleServer.close();
  }
  return { pass, fail };
}

module.exports = { run };
