const mongoose = require('mongoose');
const User = require('../src/models/User');
const Call = require('../src/models/Call');
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
      console.log(`FAIL - ${name}`, JSON.stringify(value));
    }
  }

  async function request(method, path, token, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  }

  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const users = await Promise.all([1, 2, 3].map((index) => User.create({
    profile: {
      username: `Caller${index}${suffix}`,
      usernameNormalized: `caller${index}${suffix}`,
      firstName: 'Call',
      lastName: `User${index}`,
      avatarKey: 'green-knight',
    },
    onboardingComplete: true,
    faction: 'ascendants',
  })));
  const [caller, recipient, outsider] = users.map((user) => ({
    id: user.id,
    username: user.profile.username,
    token: signToken(user.id, user.tokenVersion),
  }));

  await Call.init();
  const dmResponse = await request('POST', '/api/chats/dm', caller.token, { username: recipient.username });
  const conversationId = dmResponse.data.chat.id;
  const callPath = `/api/chats/${conversationId}/calls`;

  console.log('\n--- LiveKit DM calls ---');
  check((await request('POST', callPath, null, { type: 'audio' })).status === 401, 'starting a call requires authentication');
  check((await request('POST', callPath, caller.token, { type: 'screen' })).status === 400, 'call type must be audio or video');

  const chats = await request('GET', '/api/chats', caller.token);
  const community = chats.data.chats.find((chat) => chat.type === 'community');
  check((await request('POST', `/api/chats/${community.id}/calls`, caller.token, { type: 'audio' })).status === 400, 'calls are limited to direct messages');
  check((await request('POST', callPath, outsider.token, { type: 'audio' })).status === 403, 'non-participant cannot start a call');

  await request('PATCH', '/api/users/me/privacy', recipient.token, { allowDirectMessages: false });
  check((await request('POST', callPath, caller.token, { type: 'audio' })).status === 403, 'call respects recipient direct-message preference');
  await request('PATCH', '/api/users/me/privacy', recipient.token, { allowDirectMessages: true });
  await request('POST', `/api/users/${caller.username}/block`, recipient.token);
  check((await request('POST', callPath, caller.token, { type: 'audio' })).status === 403, 'call cannot cross a user block');
  await request('DELETE', `/api/users/${caller.username}/block`, recipient.token);

  const started = await request('POST', callPath, caller.token, { type: 'audio' });
  const firstCall = started.data.call;
  check(
    started.status === 201 && firstCall.status === 'ringing' && firstCall.type === 'audio' &&
      firstCall.caller.name === 'Call User1' && firstCall.caller.avatarKey === 'green-knight' &&
      typeof started.data.token === 'string' && started.data.token.split('.').length === 3 &&
      started.data.livekitUrl === process.env.LIVEKIT_URL,
    'caller receives ringing call data and a LiveKit token',
    started
  );
  check((await request('POST', callPath, caller.token, { type: 'video' })).status === 409, 'a DM cannot have two active calls');
  const secondDm = await request('POST', '/api/chats/dm', outsider.token, { username: recipient.username });
  check(
    (await request('POST', `/api/chats/${secondDm.data.chat.id}/calls`, outsider.token, { type: 'audio' })).status === 409,
    'a participant cannot be active in calls from two different chats'
  );
  check((await request('GET', `/api/calls/${firstCall.id}`, outsider.token)).status === 403, 'outsider cannot read a call');
  check((await request('GET', '/api/calls/not-an-id', caller.token)).status === 404, 'invalid call id returns not found');

  const callerIncoming = await request('GET', '/api/calls/incoming', caller.token);
  const recipientIncoming = await request('GET', '/api/calls/incoming', recipient.token);
  check(callerIncoming.status === 200 && callerIncoming.data.call === null, 'caller does not receive their own incoming call');
  check(recipientIncoming.data.call?.id === firstCall.id, 'recipient sees the incoming call');
  check((await request('POST', `/api/calls/${firstCall.id}/accept`, caller.token)).status === 400, 'caller cannot answer their own call');

  const accepted = await request('POST', `/api/calls/${firstCall.id}/accept`, recipient.token);
  check(
    accepted.status === 200 && accepted.data.call.status === 'accepted' && accepted.data.call.answeredAt &&
      typeof accepted.data.token === 'string',
    'recipient accepts and receives a LiveKit token',
    accepted
  );
  const acceptedAgain = await request('POST', `/api/calls/${firstCall.id}/accept`, recipient.token);
  check(acceptedAgain.status === 200 && acceptedAgain.data.call.status === 'accepted', 'accept is safe to retry');
  check((await request('POST', `/api/calls/${firstCall.id}/decline`, recipient.token)).status === 409, 'accepted call cannot be declined');

  const ended = await request('POST', `/api/calls/${firstCall.id}/end`, caller.token);
  check(ended.data.call.status === 'ended' && ended.data.call.endedAt, 'participant can end an accepted call', ended);
  check((await request('POST', `/api/calls/${firstCall.id}/end`, recipient.token)).data.call.status === 'ended', 'ending a call is idempotent');

  const declineStart = await request('POST', callPath, caller.token, { type: 'video' });
  check((await request('POST', `/api/calls/${declineStart.data.call.id}/decline`, caller.token)).status === 400, 'caller cannot use the decline endpoint');
  const declined = await request('POST', `/api/calls/${declineStart.data.call.id}/decline`, recipient.token);
  check(declined.data.call.status === 'declined', 'recipient can decline a ringing call', declined);

  const recipientCloseStart = await request('POST', callPath, caller.token, { type: 'audio' });
  const recipientClose = await request('POST', `/api/calls/${recipientCloseStart.data.call.id}/end`, recipient.token);
  check(recipientClose.data.call.status === 'declined', 'recipient ending a ringing call records a decline', recipientClose);

  const cancelStart = await request('POST', callPath, caller.token, { type: 'audio' });
  const cancelled = await request('POST', `/api/calls/${cancelStart.data.call.id}/end`, caller.token);
  check(cancelled.data.call.status === 'cancelled', 'caller ending a ringing call records cancellation', cancelled);

  const missedStart = await request('POST', callPath, caller.token, { type: 'audio' });
  await Call.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(missedStart.data.call.id) },
    { $set: { createdAt: new Date(Date.now() - 46_000) } }
  );
  const missed = await request('GET', `/api/calls/${missedStart.data.call.id}`, caller.token);
  check(missed.data.call.status === 'missed' && missed.data.call.endedAt, 'unanswered call becomes missed after 45 seconds', missed);
  check((await request('GET', '/api/calls/incoming', recipient.token)).data.call === null, 'expired call is not returned as incoming');

  const concurrent = await Promise.all([
    request('POST', callPath, caller.token, { type: 'audio' }),
    request('POST', callPath, caller.token, { type: 'video' }),
  ]);
  const statuses = concurrent.map((result) => result.status).sort();
  check(statuses[0] === 201 && statuses[1] === 409, 'concurrent starts create only one active call', concurrent);
  const winner = concurrent.find((result) => result.status === 201);
  await request('POST', `/api/calls/${winner.data.call.id}/end`, caller.token);

  return { pass, fail };
}

module.exports = { run };
