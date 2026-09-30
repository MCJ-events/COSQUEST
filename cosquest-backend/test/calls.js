const mongoose = require('mongoose');
const User = require('../src/models/User');
const Call = require('../src/models/Call');
const Message = require('../src/models/Message');
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

  // recordCallMessage runs fire-and-forget off broadcastCallUpdate, so the
  // HTTP response can return before its writes land - poll briefly instead
  // of asserting on it immediately.
  async function waitForCallMessage(callId, attempts = 40) {
    for (let i = 0; i < attempts; i++) {
      const message = await Message.findOne({ 'callLog.callId': new mongoose.Types.ObjectId(callId) });
      if (message) return message;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
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

  const endedMessage = await waitForCallMessage(firstCall.id);
  check(
    endedMessage?.kind === 'call' && endedMessage.callLog?.status === 'ended' && endedMessage.callLog?.type === 'audio' &&
      typeof endedMessage.callLog?.durationSeconds === 'number' && String(endedMessage.callLog?.callerId) === caller.id,
    'ending a call logs a call message with a duration in the DM',
    endedMessage
  );
  const endedCallerChats = await request('GET', '/api/chats', caller.token);
  const endedRecipientChats = await request('GET', '/api/chats', recipient.token);
  const endedCallerDm = endedCallerChats.data.chats.find((chat) => chat.id === conversationId);
  const endedRecipientDm = endedRecipientChats.data.chats.find((chat) => chat.id === conversationId);
  check(endedCallerDm?.lastMessage?.preview === '📞 Voice call', 'caller chat list shows a plain preview for an answered call', endedCallerDm);
  check(endedRecipientDm?.lastMessage?.preview === '📞 Voice call', 'recipient chat list shows the same preview for an answered call', endedRecipientDm);

  check(
    (await request('PATCH', `/api/chats/${conversationId}/messages/${endedMessage.id}`, caller.token, { content: 'nope' })).status === 400,
    'a call entry cannot be edited'
  );
  check(
    (await request('POST', `/api/chats/${conversationId}/messages/${endedMessage.id}/forward`, caller.token, { targetUsername: outsider.username })).status === 400,
    'a call entry cannot be forwarded'
  );

  let duplicateBlocked = false;
  try {
    await Message.create({
      conversation: conversationId,
      sender: caller.id,
      kind: 'call',
      content: '',
      callLog: { callId: firstCall.id, type: 'audio', status: 'ended', durationSeconds: 1, callerId: caller.id },
    });
  } catch (error) {
    duplicateBlocked = error?.code === 11000;
  }
  check(duplicateBlocked, 'a second call-log message for the same call is rejected by the unique index');

  const declineStart = await request('POST', callPath, caller.token, { type: 'video' });
  check((await request('POST', `/api/calls/${declineStart.data.call.id}/decline`, caller.token)).status === 400, 'caller cannot use the decline endpoint');
  const declined = await request('POST', `/api/calls/${declineStart.data.call.id}/decline`, recipient.token);
  check(declined.data.call.status === 'declined', 'recipient can decline a ringing call', declined);

  const declinedMessage = await waitForCallMessage(declineStart.data.call.id);
  check(
    declinedMessage?.kind === 'call' && declinedMessage.callLog?.status === 'declined' && declinedMessage.callLog?.type === 'video' &&
      declinedMessage.callLog?.durationSeconds === null,
    'declining a call logs a call message with no duration',
    declinedMessage
  );

  const declinedCallerChats = await request('GET', '/api/chats', caller.token);
  const declinedRecipientChats = await request('GET', '/api/chats', recipient.token);
  const declinedCallerDm = declinedCallerChats.data.chats.find((chat) => chat.id === conversationId);
  const declinedRecipientDm = declinedRecipientChats.data.chats.find((chat) => chat.id === conversationId);
  check(declinedCallerDm?.lastMessage?.preview === '🎥 Video call · Declined', 'caller chat list shows who declined', declinedCallerDm);
  check(declinedRecipientDm?.lastMessage?.preview === '🎥 You declined a video call', 'recipient chat list is worded from their own side', declinedRecipientDm);

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
