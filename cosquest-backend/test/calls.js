const mongoose = require('mongoose');
const User = require('../src/models/User');
const Call = require('../src/models/Call');
const Message = require('../src/models/Message');
const VoiceRoom = require('../src/models/VoiceRoom');
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
  const users = await Promise.all([1, 2, 3, 4].map((index) => User.create({
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
  const [caller, recipient, outsider, stranger] = users.map((user) => ({
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
  // The caller is already in their own call, so "accept" is a harmless retry
  // that does not make the call count as answered.
  const callerAccept = await request('POST', `/api/calls/${firstCall.id}/accept`, caller.token);
  check(
    callerAccept.status === 200 && callerAccept.data.call.status === 'ringing',
    'caller answering their own call does not mark it answered',
    callerAccept
  );

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
  check((await request('POST', `/api/calls/${declineStart.data.call.id}/decline`, caller.token)).status === 409, 'caller cannot decline a call they are in (they leave it instead)');
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
    // Each person's ring time is tracked on their own `members` entry.
    { $set: { createdAt: new Date(Date.now() - 46_000), 'members.$[ringing].invitedAt': new Date(Date.now() - 46_000) } },
    { arrayFilters: [{ 'ringing.status': 'ringing' }] }
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

  console.log('\n--- group calls ---');
  const groupStart = await request('POST', callPath, caller.token, { type: 'audio' });
  const groupCallId = groupStart.data.call.id;
  check((await request('POST', `/api/calls/${groupCallId}/invite`, caller.token, {})).status === 400, 'adding people needs at least one person');
  check((await request('POST', `/api/calls/${groupCallId}/invite`, outsider.token, { usernames: [recipient.username] })).status === 403, 'a non-participant cannot add people');
  await request('POST', `/api/calls/${groupCallId}/accept`, recipient.token);

  const invited = await request('POST', `/api/calls/${groupCallId}/invite`, caller.token, {
    usernames: [outsider.username, 'nobody-by-this-name'],
  });
  check(
    invited.status === 200 && invited.data.invited.includes(outsider.id) && invited.data.call.isGroup === true &&
      invited.data.skipped.some((entry) => entry.reason === 'not_found'),
    'a person in the call can add someone; unknown names are skipped, not fatal',
    invited
  );
  check((await request('GET', '/api/calls/incoming', outsider.token)).data.call?.id === groupCallId, 'the added person is rung');
  check((await request('GET', '/api/calls/incoming', recipient.token)).data.call === null, 'people already in the call are not rung again');

  const outsiderAccepted = await request('POST', `/api/calls/${groupCallId}/accept`, outsider.token);
  check(
    outsiderAccepted.status === 200 && outsiderAccepted.data.call.members.filter((member) => member.status === 'joined').length === 3,
    'the added person answers and all three are in the call',
    outsiderAccepted
  );

  const recipientLeft = await request('POST', `/api/calls/${groupCallId}/end`, recipient.token);
  check(recipientLeft.data.call.status === 'accepted', 'one person leaving a group call does not end it for the others', recipientLeft);
  const rejoined = await request('POST', `/api/calls/${groupCallId}/join`, recipient.token);
  check(rejoined.status === 200 && typeof rejoined.data.token === 'string', 'a person who left can rejoin while the call is going', rejoined);

  await request('POST', `/api/calls/${groupCallId}/end`, recipient.token);
  await request('POST', `/api/calls/${groupCallId}/end`, outsider.token);
  const groupEnded = await request('POST', `/api/calls/${groupCallId}/end`, caller.token);
  check(groupEnded.data.call.status === 'ended', 'the call ends when the last person leaves', groupEnded);
  const groupMessage = await waitForCallMessage(groupCallId);
  check(
    groupMessage?.callLog?.groupCall === true && groupMessage.callLog.participantCount === 3,
    'the call entry records a group call and how many took part',
    groupMessage
  );

  console.log('\n--- private calls (from a call) ---');
  const awayOf = (call, userId) => call.members.find((member) => member.user.id === userId)?.away;
  const memberStatus = (call, userId) => call.members.find((member) => member.user.id === userId)?.status;
  const mainStart = await request('POST', callPath, caller.token, { type: 'video' });
  const mainId = mainStart.data.call.id;
  const privatePath = `/api/calls/${mainId}/private`;
  await request('POST', `/api/calls/${mainId}/accept`, recipient.token);
  await request('POST', `/api/calls/${mainId}/invite`, caller.token, { userIds: [outsider.id] });
  check(
    (await request('POST', privatePath, caller.token, { userId: outsider.id })).status === 409,
    'a private call needs the other person to be in the call (not just ringing)'
  );
  await request('POST', `/api/calls/${mainId}/accept`, outsider.token);
  check((await request('POST', privatePath, caller.token, {})).status === 400, 'a private call needs a userId');
  check((await request('POST', privatePath, caller.token, { userId: caller.id })).status === 400, 'you cannot call yourself privately');
  check((await request('POST', privatePath, stranger.token, { userId: caller.id })).status === 403, 'someone outside the call cannot start a private call from it');
  check((await request('POST', privatePath, caller.token, { userId: stranger.id })).status === 409, 'you cannot privately call someone who is not in the call');

  const privateStart = await request('POST', privatePath, caller.token, { userId: recipient.id });
  const privateCall = privateStart.data.call;
  check(
    privateStart.status === 201 && privateCall.privateOf === mainId && privateCall.privateOfType === 'call' &&
      privateCall.type === 'audio' && privateCall.status === 'ringing' && privateCall.isGroup === false &&
      typeof privateStart.data.token === 'string' && privateCall.id !== mainId,
    'a private call starts as audio, ringing, in its own call, even though both are busy in the main call',
    privateStart
  );
  const privateIncoming = await request('GET', '/api/calls/incoming', recipient.token);
  check(
    privateIncoming.data.call?.id === privateCall.id && privateIncoming.data.call.privateOf === mainId,
    'the other person is rung, with privateOf set to the main call',
    privateIncoming
  );
  check((await request('GET', '/api/calls/incoming', outsider.token)).data.call === null, 'nobody else in the main call is rung');
  check(
    awayOf((await request('GET', `/api/calls/${mainId}`, outsider.token)).data.call, caller.id) === false,
    'nobody is away while the private call is still ringing'
  );
  check(
    (await request('POST', privatePath, outsider.token, { userId: caller.id })).status === 409,
    'someone already in a private call cannot be rung into a second one'
  );

  const privateAccepted = await request('POST', `/api/calls/${privateCall.id}/accept`, recipient.token);
  check(
    privateAccepted.status === 200 && privateAccepted.data.call.status === 'accepted' && typeof privateAccepted.data.token === 'string',
    'the private call connects when they accept',
    privateAccepted
  );
  const mainDuring = (await request('GET', `/api/calls/${mainId}`, outsider.token)).data.call;
  check(
    mainDuring.status === 'accepted' && awayOf(mainDuring, caller.id) === true && awayOf(mainDuring, recipient.id) === true &&
      awayOf(mainDuring, outsider.id) === false &&
      mainDuring.members.filter((member) => member.status === 'joined').length === 3,
    'the main call shows both as away, and both are still members of it',
    mainDuring
  );
  check(
    (await request('POST', `/api/calls/${privateCall.id}/invite`, caller.token, { userIds: [outsider.id] })).status === 400,
    'nobody can be added to a private call'
  );
  const privateEnded = await request('POST', `/api/calls/${privateCall.id}/end`, caller.token);
  check(privateEnded.data.call.status === 'ended', 'either person can end the private call', privateEnded);
  const mainAfter = (await request('GET', `/api/calls/${mainId}`, outsider.token)).data.call;
  check(
    mainAfter.status === 'accepted' && awayOf(mainAfter, caller.id) === false && awayOf(mainAfter, recipient.id) === false &&
      memberStatus(mainAfter, caller.id) === 'joined' && memberStatus(mainAfter, recipient.id) === 'joined',
    'ending the private call puts both back in the main call (away is false again)',
    mainAfter
  );
  check(!(await waitForCallMessage(privateCall.id, 8)), 'a private call leaves no call entry in the chat');

  const secondPrivate = await request('POST', privatePath, caller.token, { userId: recipient.id });
  await request('POST', `/api/calls/${secondPrivate.data.call.id}/accept`, recipient.token);
  for (const person of [outsider, recipient, caller]) await request('POST', `/api/calls/${mainId}/end`, person.token);
  const outlived = await request('GET', `/api/calls/${secondPrivate.data.call.id}`, caller.token);
  check(
    (await request('GET', `/api/calls/${mainId}`, caller.token)).data.call.status === 'ended' && outlived.data.call.status === 'accepted',
    'a private call keeps going on its own when the main call ends',
    outlived
  );
  await request('POST', `/api/calls/${secondPrivate.data.call.id}/end`, recipient.token);

  console.log('\n--- community voice chats ---');
  const voicePath = `/api/chats/${community.id}/voice`;
  check((await request('GET', voicePath, null)).status === 401, 'voice chats require authentication');
  check((await request('GET', `/api/chats/${conversationId}/voice`, caller.token)).status === 400, 'voice chats are not available in direct messages');
  check((await request('GET', voicePath, caller.token)).data.voiceRoom === null, 'no voice chat is live at first');

  const voiceJoin = await request('POST', `${voicePath}/join`, caller.token);
  const voiceRoomId = voiceJoin.data.voiceRoom?.id;
  check(
    voiceJoin.status === 201 && voiceJoin.data.voiceRoom.memberCount === 1 && typeof voiceJoin.data.token === 'string',
    'the first person to join starts the voice chat and gets a LiveKit token',
    voiceJoin
  );
  const voiceJoin2 = await request('POST', `${voicePath}/join`, recipient.token);
  check(voiceJoin2.status === 200 && voiceJoin2.data.voiceRoom.id === voiceRoomId && voiceJoin2.data.voiceRoom.memberCount === 2, 'a second person joins the same live voice chat', voiceJoin2);
  check((await request('POST', `/api/voice/${voiceRoomId}/ping`, recipient.token)).data.voiceRoom.memberCount === 2, 'check-in keeps a member in the voice chat');
  check((await request('POST', `/api/voice/${voiceRoomId}/ping`, outsider.token)).status === 404, 'check-in from someone who is not in it is rejected');
  check((await request('POST', `/api/voice/not-an-id/leave`, caller.token)).status === 404, 'invalid voice chat id returns not found');

  console.log('\n--- private calls (from a voice chat) ---');
  const voicePrivatePath = `/api/voice/${voiceRoomId}/private`;
  check((await request('POST', voicePrivatePath, caller.token, { userId: outsider.id })).status === 409, 'you cannot privately call someone who is not in the voice chat');
  check((await request('POST', voicePrivatePath, outsider.token, { userId: caller.id })).status === 403, 'someone outside the voice chat cannot start a private call from it');
  const voicePrivate = await request('POST', voicePrivatePath, caller.token, { userId: recipient.id });
  check(
    voicePrivate.status === 201 && voicePrivate.data.call.privateOf === voiceRoomId && voicePrivate.data.call.privateOfType === 'voice' &&
      voicePrivate.data.call.conversationId === community.id && voicePrivate.data.call.type === 'audio',
    'a private call can start from a voice chat',
    voicePrivate
  );
  await request('POST', `/api/calls/${voicePrivate.data.call.id}/accept`, recipient.token);
  const voiceDuring = (await request('GET', voicePath, outsider.token)).data.voiceRoom;
  check(
    voiceDuring.memberCount === 2 && awayOf(voiceDuring, caller.id) === true && awayOf(voiceDuring, recipient.id) === true,
    'the voice chat shows both as away and keeps them as members',
    voiceDuring
  );

  // Both apps go quiet for longer than the 90-second check-in window.
  const longAgo = new Date(Date.now() - 120_000);
  await VoiceRoom.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(voiceRoomId) },
    { $set: { 'members.$[].lastSeenAt': longAgo }, $inc: { __v: 1 } }
  );
  check(
    (await request('GET', voicePath, outsider.token)).data.voiceRoom?.memberCount === 2,
    'time in a private call counts as being present in the voice chat'
  );

  await request('POST', `/api/calls/${voicePrivate.data.call.id}/end`, caller.token);
  // The voice chat is updated in the background once the private call ends.
  let voiceAfter = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const room = await VoiceRoom.findById(voiceRoomId).lean();
    if (room.members.every((member) => member.lastSeenAt > longAgo)) {
      voiceAfter = (await request('GET', voicePath, outsider.token)).data.voiceRoom;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  check(
    voiceAfter?.memberCount === 2 && awayOf(voiceAfter, caller.id) === false && awayOf(voiceAfter, recipient.id) === false,
    'ending the private call returns both to the voice chat (away is false, not dropped as quiet)',
    voiceAfter
  );

  await request('POST', `/api/voice/${voiceRoomId}/leave`, recipient.token);
  const lastLeave = await request('POST', `/api/voice/${voiceRoomId}/leave`, caller.token);
  check(lastLeave.data.voiceRoom === null, 'the voice chat closes when the last person leaves', lastLeave);
  check((await request('GET', voicePath, caller.token)).data.voiceRoom === null, 'a closed voice chat is no longer live');

  console.log('\n--- group voice chats ---');
  const group = await request('POST', '/api/groups', caller.token, { name: 'Voice Owls', kind: 'private', members: [recipient.id] });
  const groupVoicePath = `/api/chats/${group.data.group.id}/voice`;
  check((await request('GET', groupVoicePath, caller.token)).data.voiceRoom === null, 'a group has no live voice chat at first');
  check((await request('POST', `${groupVoicePath}/join`, outsider.token)).status === 403, 'people outside the group cannot join its voice chat');
  const groupVoice = await request('POST', `${groupVoicePath}/join`, caller.token);
  const groupRoomId = groupVoice.data.voiceRoom?.id;
  check(
    groupVoice.status === 201 && groupVoice.data.voiceRoom.conversationType === 'group' && typeof groupVoice.data.token === 'string',
    'a group member can start a voice chat in the group',
    groupVoice
  );
  const groupVoice2 = await request('POST', `${groupVoicePath}/join`, recipient.token);
  check(groupVoice2.status === 200 && groupVoice2.data.voiceRoom.memberCount === 2, 'another member joins the group voice chat', groupVoice2);
  check((await request('POST', `/api/voice/${groupRoomId}/ping`, recipient.token)).data.voiceRoom?.memberCount === 2, 'group voice chat check-ins work');
  await request('POST', `/api/voice/${groupRoomId}/leave`, recipient.token);
  check(
    (await request('POST', `/api/voice/${groupRoomId}/leave`, caller.token)).data.voiceRoom === null,
    'the group voice chat closes when the last person leaves'
  );

  return { pass, fail };
}

module.exports = { run };
