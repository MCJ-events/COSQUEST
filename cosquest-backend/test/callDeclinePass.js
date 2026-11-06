// Declining from the phone's call screen with CosQuest closed: the decline
// pass each ring carries (callPush.withDeclinePass / verifyDeclinePass) and
// POST /api/call-decline/:callId, which takes it instead of the session.
const jwt = require('jsonwebtoken');
const User = require('../src/models/User');
const callPush = require('../src/utils/callPush');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;
  function check(ok, name, value) {
    if (ok) { pass += 1; console.log(`  ok  - ${name}`); }
    else { fail += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 1000)); }
  }
  async function request(method, path, token, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json().catch(() => null) };
  }
  const savedBase = process.env.PUBLIC_BASE_URL;
  const savedRender = process.env.RENDER_EXTERNAL_URL;

  try {
    console.log('\n--- declining from the call screen with the app closed ---');
    const callId = '64b000000000000000000001';
    const userId = '64b0000000000000000000aa';
    process.env.PUBLIC_BASE_URL = 'https://api.example.test/';
    const event = callPush.withDeclinePass({ serverCallId: callId, metadata: { chatId: 'x' } }, userId);
    const p = event.metadata?.declinePass;
    check(typeof p === 'string' && event.metadata.declineUrl === `https://api.example.test/api/call-decline/${callId}` && event.metadata.chatId === 'x',
      'the ring carries a pass and the decline URL (the rest of metadata kept)', event.metadata);
    check(callPush.verifyDeclinePass(p, callId) === userId, 'the pass names the person', null);
    check(callPush.verifyDeclinePass(p, '64b000000000000000000002') === null, 'a pass only works for its own call', null);
    const forged = jwt.sign({ sub: userId, call: callId, purpose: 'call-decline' }, 'not-the-secret');
    const withJwtSecret = jwt.sign({ sub: userId, call: callId, purpose: 'call-decline' }, process.env.JWT_SECRET);
    check(callPush.verifyDeclinePass(forged, callId) === null && callPush.verifyDeclinePass(withJwtSecret, callId) === null,
      'a forged pass is refused, and so is one signed with the session secret itself', null);
    const expired = jwt.sign({ sub: userId, call: callId, purpose: 'call-decline', exp: Math.floor(Date.now() / 1000) - 1 }, require('crypto').createHmac('sha256', process.env.JWT_SECRET).update('call-decline').digest());
    check(callPush.verifyDeclinePass(expired, callId) === null && jwt.decode(p).exp - jwt.decode(p).iat === 120, 'a pass lasts 2 minutes, then is refused', jwt.decode(p));
    delete process.env.PUBLIC_BASE_URL;
    process.env.RENDER_EXTERNAL_URL = 'https://cosquest.onrender.example';
    check(callPush.withDeclinePass({ serverCallId: callId, metadata: {} }, userId).metadata.declineUrl === `https://cosquest.onrender.example/api/call-decline/${callId}`, 'on Render, the URL is its own address', null);
    delete process.env.RENDER_EXTERNAL_URL;
    const noBase = callPush.withDeclinePass({ serverCallId: callId, metadata: {} }, userId).metadata;
    check(noBase.declinePass && !('declineUrl' in noBase), 'no public address known: the pass without a URL (the app uses its own API address)', noBase);

    // A real call: the pass declines it, as that person, with no session.
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const [caller, callee, stranger] = (await Promise.all(['Decliner', 'Closedapp', 'Stranger'].map((name) => User.create({
      profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, lastName: 'Pass', avatarKey: 'green-knight' },
      onboardingComplete: true, faction: 'ascendants',
    })))).map((user) => ({ id: user.id, username: user.profile.username, token: signToken(user.id, user.tokenVersion) }));
    const chat = (await request('POST', '/api/chats/dm', caller.token, { username: callee.username })).data.chat.id;
    const call = (await request('POST', `/api/chats/${chat}/calls`, caller.token, { type: 'audio' })).data.call.id;
    const calleePass = callPush.withDeclinePass({ serverCallId: call, metadata: {} }, callee.id).metadata.declinePass;

    const bad = await request('POST', `/api/call-decline/${call}`, null, { pass: 'nonsense' });
    const none = await request('POST', `/api/call-decline/${call}`, null, {});
    const otherCall = await request('POST', '/api/call-decline/64b000000000000000000001', null, { pass: calleePass });
    check(bad.status === 401 && none.status === 401 && otherCall.status === 401 && bad.data?.error === 'This decline link has expired.',
      'no pass, a bad pass, or another call\'s pass: 401, nothing changes', { bad, none, otherCall });
    const asSession = await request('GET', '/api/users/me', calleePass);
    check(asSession.status === 401, 'a decline pass is not a session token (it opens nothing else)', asSession.status);
    const lookalike = jwt.sign({ sub: callee.id, tokenVersion: 0, purpose: 'call-decline' }, process.env.JWT_SECRET);
    const lookalikeRes = await request('GET', '/api/users/me', lookalike);
    check(lookalikeRes.status === 401, 'nor is any one-purpose pass, even signed with the session secret', lookalikeRes.status);
    const strangerPass = callPush.withDeclinePass({ serverCallId: call, metadata: {} }, stranger.id).metadata.declinePass;
    const notMember = await request('POST', `/api/call-decline/${call}`, null, { pass: strangerPass });
    check(notMember.status === 403 || notMember.status === 404, 'a pass for someone not in the call declines nothing', notMember);
    const declined = await request('POST', `/api/call-decline/${call}`, null, { pass: calleePass });
    const member = declined.data?.call?.members?.find((m) => m.user.id === callee.id);
    check(declined.status === 200 && member?.status === 'declined' && declined.data.call.status === 'declined',
      'a valid pass declines the call as that person (the caller stops ringing at once)', declined.data?.call?.status);
  } catch (error) {
    check(false, 'call decline pass suite threw', error.stack);
  } finally {
    if (savedBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = savedBase;
    if (savedRender === undefined) delete process.env.RENDER_EXTERNAL_URL;
    else process.env.RENDER_EXTERNAL_URL = savedRender;
  }
  console.log(`\ncall decline pass: ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
