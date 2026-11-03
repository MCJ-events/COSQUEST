// Push notifications (src/utils/push.js): who gets one for a new message, a
// mention, a ringing call and a game event, and who never does. Expo is
// replaced by a capture, so nothing leaves the machine.
const User = require('../src/models/User');
const ConversationMember = require('../src/models/ConversationMember');
const push = require('../src/utils/push');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;

  function check(ok, name, value) {
    if (ok) {
      pass += 1;
      console.log(`  ok  - ${name}`);
    } else {
      fail += 1;
      console.log(`FAIL - ${name}`, JSON.stringify(value)?.slice(0, 2000));
    }
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function request(method, path, token, body, headers = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  }

  let n = 0;
  async function makeUser({ notifications = true } = {}) {
    n += 1;
    const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
    const user = await User.create({
      profile: {
        username: `Push${n}x${suffix}`,
        usernameNormalized: `push${n}x${suffix}`,
        firstName: 'Push',
        lastName: `Tester${n}`,
        avatarKey: 'green-knight',
      },
      email: `push${n}_${suffix}@example.com`,
      onboardingComplete: true,
      faction: 'ascendants',
      preferences: { notificationsEnabled: notifications },
    });
    return {
      id: String(user._id),
      username: user.profile.username,
      email: user.email,
      token: signToken(String(user._id), user.tokenVersion),
      pushToken: `ExponentPushToken[test-${n}-${suffix}]`,
    };
  }

  async function register(user, pushToken = user.pushToken) {
    return request('POST', '/api/users/me/devices', user.token, { pushToken, platform: 'ios' });
  }

  // Waits for the fire-and-forget push to land (or not) in the capture.
  async function settle(sent, predicate, ms = 1500) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (sent.some(predicate)) return true;
      await sleep(50);
    }
    return false;
  }

  const sent = push.captureForTests();
  const savedSecret = process.env.GAME_PUSH_SECRET;
  try {
    console.log('\n--- push notifications ---');

    const a = await makeUser();
    const b = await makeUser();
    await register(a);
    await register(b);

    const dm = (await request('POST', '/api/chats/dm', a.token, { username: b.username })).data.chat.id;

    // A DM: the other person, not the sender, with the chat to open.
    await request('POST', `/api/chats/${dm}/messages`, a.token, { content: 'Meet at the shrine at six' });
    const got = await settle(sent, (m) => m.to === b.pushToken);
    const toB = sent.find((m) => m.to === b.pushToken);
    check(got && toB.data.chatId === dm && toB.data.type === 'message' && toB.channelId === 'messages',
      'new DM pushes to the other person with chatId and the messages channel', toB);
    check(toB?.priority === 'high', 'every push goes out at high priority (a chat message too)', toB);
    check(toB?.title === a.username && toB?.body === 'Meet at the shrine at six', 'DM push: sender as title, message as body', toB);
    check(toB?.categoryId === 'message' && /^[a-f0-9]{24}$/.test(toB.data.messageId || ''), 'a message push has the Reply / Mark as read buttons (categoryId message) and the message id', toB);
    check(!sent.some((m) => m.to === a.pushToken), 'the sender gets no push for their own message', sent);
    // What the buttons do, with the push's chatId and messageId and B's session.
    const reply = await request('POST', `/api/chats/${toB.data.chatId}/messages`, b.token, { content: 'On my way', replyTo: toB.data.messageId });
    const read = await request('PATCH', `/api/chats/${toB.data.chatId}/read`, b.token);
    check(reply.status === 201 && read.status === 200, 'Reply and Mark as read work from the push alone (chatId, messageId)', { reply: reply.status, read: read.status });
    const noSession = await request('POST', `/api/chats/${toB.data.chatId}/messages`, null, { content: 'no session' });
    check(noSession.status === 401, 'a reply without the session is refused', noSession);

    // Muted chat: nothing.
    sent.length = 0;
    await ConversationMember.updateOne(
      { conversation: dm, user: b.id },
      { $set: { mutedUntil: new Date(Date.now() + 3600e3) }, $setOnInsert: { lastReadAt: new Date(0) } },
      { upsert: true }
    );
    await request('POST', `/api/chats/${dm}/messages`, a.token, { content: 'muted?' });
    check(!(await settle(sent, (m) => m.to === b.pushToken, 600)), 'a muted chat sends no push', sent);
    await ConversationMember.updateOne({ conversation: dm, user: b.id }, { $set: { mutedUntil: null } });

    // Notifications switched off: nothing.
    sent.length = 0;
    await User.updateOne({ _id: b.id }, { $set: { 'preferences.notificationsEnabled': false } });
    await request('POST', `/api/chats/${dm}/messages`, a.token, { content: 'off?' });
    check(!(await settle(sent, (m) => m.to === b.pushToken, 600)), 'notificationsEnabled off: no push', sent);
    await User.updateOne({ _id: b.id }, { $set: { 'preferences.notificationsEnabled': true } });

    // Registering by email only (no session) is refused and stores nothing.
    const c = await makeUser();
    const byEmail = await request('POST', '/api/users/me/devices', null, { email: c.email, pushToken: c.pushToken, platform: 'android' });
    const cNow = await User.findById(c.id).lean();
    check(byEmail.status === 401 && !cNow.devices.some((d) => d.pushToken === c.pushToken),
      'email-only device registration -> 401, nothing stored', { status: byEmail.status, devices: cNow.devices });
    // A device row left over from the old email-only path (authed: false) still gets no push.
    await User.updateOne({ _id: c.id }, { $push: { devices: { pushToken: c.pushToken, platform: 'android', registeredAt: new Date(), authed: false } } });
    sent.length = 0;
    const dmC = (await request('POST', '/api/chats/dm', a.token, { username: c.username })).data.chat.id;
    await request('POST', `/api/chats/${dmC}/messages`, a.token, { content: 'hello c' });
    check(!(await settle(sent, (m) => m.to === c.pushToken, 600)), 'a legacy unauthenticated device row gets no push', sent);

    // One phone, one account: a signed-in registration takes the token over.
    const moved = await register(c, b.pushToken);
    const bNow = await User.findById(b.id).lean();
    check(moved.status === 200 && !bNow.devices.some((d) => d.pushToken === b.pushToken),
      "signing in on a phone moves its token off the previous account", bNow.devices);
    await register(b);

    // DELETE (sign-out).
    const removed = await request('DELETE', '/api/users/me/devices', c.token, { pushToken: b.pushToken });
    check(removed.status === 200 && !removed.data.user.devices.some((d) => d.pushToken === b.pushToken),
      'DELETE /me/devices removes the token', removed.data);
    const removedNoSession = await request('DELETE', '/api/users/me/devices', null, { email: c.email, pushToken: c.pushToken });
    check(removedNoSession.status === 401, 'DELETE /me/devices needs a session', removedNoSession);
    // The token in the address: DELETE /me/devices/:pushToken (the app's sign-out call).
    await register(c, `ExponentPushToken[path-${c.id}]`);
    const byPath = await request('DELETE', `/api/users/me/devices/${encodeURIComponent(`ExponentPushToken[path-${c.id}]`)}`, c.token);
    check(byPath.status === 200 && !byPath.data.user.devices.some((d) => d.pushToken === `ExponentPushToken[path-${c.id}]`),
      'DELETE /me/devices/:pushToken removes that token', byPath.data);

    // A mention: the mention push, not a second message push.
    sent.length = 0;
    await request('POST', `/api/chats/${dm}/messages`, a.token, { content: `hey @${b.username}`, mentions: [b.id] });
    await settle(sent, (m) => m.to === b.pushToken && m.data.type === 'mention');
    const forB = sent.filter((m) => m.to === b.pushToken);
    check(forB.length === 1 && forB[0].data.type === 'mention' && forB[0].data.chatId === dm,
      'a mention sends one push (the mention), with the chat', forB);
    check(forB[0]?.categoryId === 'message' && /^[a-f0-9]{24}$/.test(forB[0].data.messageId || ''), 'a mention push has the message buttons and the message id too', forB[0]);

    // A ringing call.
    sent.length = 0;
    const started = await request('POST', `/api/chats/${dm}/calls`, a.token, { type: 'audio' });
    await settle(sent, (m) => m.to === b.pushToken && m.data.type === 'call');
    const ring = sent.find((m) => m.to === b.pushToken && m.data.type === 'call');
    check(started.status === 201 && ring && ring.channelId === 'calls' && ring.ttl === 60 && ring.body === 'Incoming call',
      'a call rings the other phone with a short-lived push', { status: started.status, ring });
    check(ring?.sound === 'ringtone.wav' && ring.interruptionLevel === 'time-sensitive' && toB?.sound === 'default' && !toB.interruptionLevel,
      'a call push plays the ringtone and is time-sensitive; a message keeps the normal sound', { ring, toB });
    check(ring && !ring.categoryId, 'a call push has no message buttons', ring);
    if (started.data?.call?.id) await request('POST', `/api/calls/${started.data.call.id}/end`, a.token);

    // Still "online" (phone just locked: its socket is open for a while yet):
    // a call must ring anyway, as a push.
    const presence = require('../src/realtime/presence');
    await presence.markOnline(b.id);
    sent.length = 0;
    const whileOnline = await request('POST', `/api/chats/${dm}/calls`, a.token, { type: 'video' });
    await settle(sent, (m) => m.to === b.pushToken && m.data.type === 'call');
    const ringOnline = sent.find((m) => m.to === b.pushToken && m.data.type === 'call');
    check(whileOnline.status === 201 && ringOnline && ringOnline.body === 'Incoming video call',
      'a call still pushes to a phone whose socket is open (locked or in the background)', { status: whileOnline.status, ringOnline });
    if (whileOnline.data?.call?.id) await request('POST', `/api/calls/${whileOnline.data.call.id}/end`, a.token);
    await presence.markOffline(b.id);

    // Expo says a token is dead: it is removed.
    sent.length = 0;
    push.resetForTests();
    const capture = push.captureForTests(async (batch) => batch.map(() => ({ status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } })));
    await push.sendToUsers([b.id], { body: 'anyone there?' });
    const bAfter = await User.findById(b.id).lean();
    check(capture.length === 1 && !bAfter.devices.some((d) => d.pushToken === b.pushToken),
      'DeviceNotRegistered removes the token', bAfter.devices);
    push.resetForTests();
    const sent2 = push.captureForTests();
    await register(b);

    // The game server's route.
    delete process.env.GAME_PUSH_SECRET;
    const off = await request('POST', '/api/internal/push', null, { userIds: [b.id], body: 'x' }, { Authorization: 'Bearer anything' });
    check(off.status === 404, 'internal push does not exist without GAME_PUSH_SECRET', off);
    process.env.GAME_PUSH_SECRET = 'test-game-push-secret';
    const bad = await request('POST', '/api/internal/push', null, { userIds: [b.id], body: 'x' }, { Authorization: 'Bearer wrong' });
    check(bad.status === 401, 'internal push refuses a wrong secret', bad);
    const badUrl = await request('POST', '/api/internal/push', null,
      { userIds: [b.id], body: 'x', url: 'https://evil.example' }, { Authorization: 'Bearer test-game-push-secret' });
    check(badUrl.status === 400, 'internal push only carries cosquest://play links', badUrl);
    const ok = await request('POST', '/api/internal/push', null, {
      userIds: [b.id, 'not-an-id'], title: 'Boss Hour', body: 'The Glitch King is near you', url: 'cosquest://play?raid=R1_2026101614', category: 'questUpdates',
    }, { Authorization: 'Bearer test-game-push-secret' });
    const game = sent2.find((m) => m.to === b.pushToken);
    check(ok.status === 202 && ok.data.accepted === 1 && game?.data.url === 'cosquest://play?raid=R1_2026101614' && game.channelId === 'game',
      'the game server pushes a raid with its play link', { ok, game });
    await User.updateOne({ _id: b.id }, { $set: { 'notificationCategories.questUpdates': false } });
    const optedOut = await request('POST', '/api/internal/push', null, {
      userIds: [b.id], body: 'again', category: 'questUpdates',
    }, { Authorization: 'Bearer test-game-push-secret' });
    check(optedOut.status === 202 && optedOut.data.accepted === 0, 'a switched-off category gets no game push', optedOut);
  } catch (error) {
    check(false, 'push suite threw', error.stack);
  } finally {
    push.resetForTests();
    if (savedSecret === undefined) delete process.env.GAME_PUSH_SECRET;
    else process.env.GAME_PUSH_SECRET = savedSecret;
  }

  return { pass, fail };
}

module.exports = { run };
