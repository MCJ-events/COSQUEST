// Call controls: transcription notice and camera default on joining, Sparks
// notes access, screen sharing (one at a time), ending a voice chat for
// everyone, moderation by group admins, and LiveKit webhooks (reconnect grace).
const crypto = require('crypto');
const mongoose = require('mongoose');
const { AccessToken, TrackSource } = require('livekit-server-sdk');
const User = require('../src/models/User');
const Conversation = require('../src/models/Conversation');
const Member = require('../src/models/ConversationMember');
const Message = require('../src/models/Message');
const VoiceRoom = require('../src/models/VoiceRoom');
const Call = require('../src/models/Call');
const callRoom = require('../src/utils/callRoom');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;
  function check(ok, name, value) {
    if (ok) { pass += 1; console.log(`  ok  - ${name}`); }
    else { fail += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)); }
  }
  async function request(method, path, token, body, headers = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && typeof body !== 'string' ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  }
  const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url'));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const recorded = callRoom.captureForTests();
  const sparks = require('../src/sparks');
  const sparksOn = sparks.isModule() && sparks.isReady();
  console.log(`  (Sparks module ${sparksOn ? 'on' : 'off'} in this run)`);
  const actions = (action, identity) => recorded.filter((a) => a.action === action && (!identity || a.identity === identity));

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const users = await Promise.all([0, 1, 2, 3, 4].map((i) => User.create({
    profile: { username: `Ctl${i}${suffix}`, usernameNormalized: `ctl${i}${suffix}`, firstName: 'Ctl', lastName: String(i), avatarKey: 'green-knight' },
    onboardingComplete: true, faction: 'ascendants',
  })));
  const [owner, admin, member, other, outsider] = users.map((user) => ({ id: user.id, token: signToken(user.id, user.tokenVersion) }));
  const group = await Conversation.create({ type: 'group', group: { name: 'Controls', kind: 'private', createdBy: owner.id } });
  await Member.insertMany([[owner, 'owner'], [admin, 'admin'], [member, 'member'], [other, 'member']].map(([u, role]) => ({ conversation: group._id, user: u.id, role })));
  const voicePath = `/api/chats/${group.id}/voice`;

  console.log('\n--- joining: camera off, transcription notice, what you may do ---');
  const first = await request('POST', `${voicePath}/join`, member.token);
  const roomId = first.data.voiceRoom?.id;
  check(first.status === 201 && first.data.media?.cameraStartsOn === false, 'a voice chat starts with the camera off', first.data.media);
  check(first.data.transcription?.on === sparksOn && (!sparksOn || first.data.transcription.consent === null), 'join says whether transcription (the Sparks notice) applies, and that they have not decided yet', first.data.transcription);
  if (sparksOn) {
    await sparks.store.addConsent({ userId: member.id, callId: null, noticeVersion: 1, decision: 'accepted', scope: 'always', decidedAt: new Date().toISOString() });
    const decided = await request('POST', `${voicePath}/join`, member.token);
    check(decided.data.transcription?.consent === 'accepted' && decided.data.transcription.scope === 'always', 'after deciding, join carries their decision (the app can skip the notice)', decided.data.transcription);
  }
  check(first.data.canModerate === false && first.data.canEnd === true, 'the starter may end it but not moderate', first.data);
  check(JSON.stringify(claims(first.data.token).video.canPublishSources) === JSON.stringify(['microphone', 'camera']), 'tokens allow microphone and camera, not screen sharing', claims(first.data.token).video);
  const ownerJoin = await request('POST', `${voicePath}/join`, owner.token);
  check(ownerJoin.data.canModerate === true && ownerJoin.data.canEnd === true, 'the group owner may moderate and end it', ownerJoin.data);
  await request('POST', `${voicePath}/join`, admin.token);
  await request('POST', `${voicePath}/join`, other.token);
  const got = await request('GET', voicePath, other.token);
  check(got.data.voiceRoom?.memberCount === 4 && got.data.canModerate === false && got.data.media?.cameraStartsOn === false, 'GET shows the same before joining', got.data);

  console.log('\n--- screen sharing in a voice chat ---');
  const share = await request('POST', `/api/voice/${roomId}/screen-share/start`, member.token);
  check(share.status === 200 && share.data.screenShare?.userId === member.id, 'a member starts sharing their screen', share.data);
  check(actions('setSources', member.id).some((a) => a.sources.includes(TrackSource.SCREEN_SHARE)), 'LiveKit lets only the sharer publish a screen', actions('setSources', member.id));
  const second = await request('POST', `/api/voice/${roomId}/screen-share/start`, other.token);
  check(second.status === 409 && second.data.reason === 'someone_sharing' && second.data.screenShare?.userId === member.id && /is already sharing/.test(second.data.error), 'a second person gets 409 while someone is sharing', second.data);
  check((await request('POST', `/api/voice/${roomId}/screen-share/start`, member.token)).status === 200, 'starting again is safe');
  check((await request('GET', voicePath, other.token)).data.voiceRoom.screenShare?.userId === member.id, 'everyone sees who is sharing');
  check((await request('POST', `/api/voice/${roomId}/screen-share/stop`, other.token)).status === 403, 'a member cannot stop someone else\'s share');
  const rejoinWhileSharing = await request('POST', `${voicePath}/join`, member.token);
  check(claims(rejoinWhileSharing.data.token).video.canPublishSources.includes('screen_share'), 'the sharer\'s token (on reconnect) allows the screen', claims(rejoinWhileSharing.data.token).video);
  await request('POST', `/api/voice/${roomId}/leave`, member.token);
  check((await request('GET', voicePath, other.token)).data.voiceRoom.screenShare === null, 'the share ends when the sharer leaves');
  check((await request('POST', `/api/voice/${roomId}/screen-share/start`, other.token)).status === 200, 'then someone else can share');
  const adminStop = await request('POST', `/api/voice/${roomId}/screen-share/stop`, admin.token);
  check(adminStop.status === 200 && (await request('GET', voicePath, other.token)).data.voiceRoom.screenShare === null, 'a group admin can stop a member\'s share', adminStop.data);
  await request('POST', `${voicePath}/join`, member.token);

  console.log('\n--- moderation by group admins ---');
  check((await request('POST', `/api/voice/${roomId}/members/${other.id}/mute`, member.token)).status === 403, 'a member cannot mute anyone');
  check((await request('POST', `/api/voice/${roomId}/members/${owner.id}/mute`, admin.token)).status === 403, 'an admin cannot mute the owner');
  const muted = await request('POST', `/api/voice/${roomId}/members/${member.id}/mute`, admin.token);
  const mutedRow = muted.data.voiceRoom?.members?.find((m) => m.user.id === member.id);
  check(muted.status === 200 && mutedRow?.mutedByAdmin === true, 'an admin mutes a member; everyone sees it', muted.data);
  check(actions('muteMicrophone', member.id).length === 1 && actions('setSources', member.id).some((a) => !a.sources.includes(TrackSource.MICROPHONE)), 'LiveKit mutes their microphone and stops them unmuting', recorded);
  const mutedJoin = await request('POST', `${voicePath}/join`, member.token);
  check(!claims(mutedJoin.data.token).video.canPublishSources.includes('microphone'), 'rejoining while muted still has no microphone', claims(mutedJoin.data.token).video);
  await request('POST', `/api/voice/${roomId}/members/${member.id}/unmute`, admin.token);
  const unmutedJoin = await request('POST', `${voicePath}/join`, member.token);
  check(claims(unmutedJoin.data.token).video.canPublishSources.includes('microphone') && !unmutedJoin.data.voiceRoom.members.find((m) => m.user.id === member.id).mutedByAdmin, 'unmuted: the microphone is allowed again', unmutedJoin.data.voiceRoom);
  check((await request('POST', `/api/voice/${roomId}/members/${admin.id}/remove`, admin.token)).status === 400, 'nobody can remove themselves this way');
  const removed = await request('POST', `/api/voice/${roomId}/members/${member.id}/remove`, admin.token);
  check(removed.status === 200 && !removed.data.voiceRoom.members.some((m) => m.user.id === member.id) && actions('removeFromRoom', member.id).length === 1, 'an admin removes a member from the voice chat (and from LiveKit)', removed.data);
  const blocked = await request('POST', `${voicePath}/join`, member.token);
  check(blocked.status === 403 && blocked.data.reason === 'removed' && /removed you/.test(blocked.data.error), 'a removed person cannot join again, with a clear reason', blocked.data);
  await request('POST', `/api/voice/${roomId}/members/${member.id}/allow`, admin.token);
  check((await request('POST', `${voicePath}/join`, member.token)).status === 200, 'an admin can let them back in');

  console.log('\n--- LiveKit webhooks ---');
  const roomName = `voice_${roomId}`;
  const sign = async (event) => {
    const body = JSON.stringify(event);
    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
    at.sha256 = crypto.createHash('sha256').update(body).digest('base64');
    return { body, auth: await at.toJwt() };
  };
  const hook = async (event, auth) => {
    const signed = await sign(event);
    return request('POST', '/api/livekit/webhook', null, signed.body, { 'Content-Type': 'application/webhook+json', Authorization: auth === undefined ? signed.auth : auth });
  };
  const leftEvent = { event: 'participant_left', room: { name: roomName }, participant: { identity: other.id }, id: 'EV_1', createdAt: String(Math.floor(Date.now() / 1000)) };
  check((await hook(leftEvent, 'Bearer nope')).status === 401, 'an unsigned webhook is refused');
  check((await hook(leftEvent)).status === 200, 'a signed participant_left is accepted');
  const joinedAgain = await hook({ ...leftEvent, event: 'participant_joined', id: 'EV_2' });
  const otherRow = (await VoiceRoom.findById(roomId).lean()).members.find((m) => String(m.user) === other.id);
  check(joinedAgain.status === 200 && Date.now() - new Date(otherRow.lastSeenAt) < 5000, 'reconnecting within the grace period keeps them in', otherRow);
  // Gone for good: dropped out longer ago than the 20-second grace.
  await require('../src/controllers/voiceRoomController').participantLeft(roomId, other.id, new Date(Date.now() - 30000));
  const afterGrace = await request('GET', voicePath, owner.token);
  check(!afterGrace.data.voiceRoom.members.some((m) => m.user.id === other.id), 'not back after the grace period: taken out, so the count is right', afterGrace.data.voiceRoom.memberCount);
  check((await hook({ event: 'room_finished', room: { name: 'scheduled-123' }, id: 'EV_3' })).status === 200, 'other events are acknowledged and ignored');

  console.log('\n--- ending a voice chat for everyone ---');
  check((await request('POST', `/api/voice/${roomId}/end`, admin.token.replace(/.$/, 'x'))).status === 401, 'ending needs a login');
  await request('POST', `${voicePath}/join`, other.token);
  check((await request('POST', `/api/voice/${roomId}/end`, other.token)).status === 403, 'a member who did not start it cannot end it');
  const ended = await request('POST', `/api/voice/${roomId}/end`, admin.token);
  check(ended.status === 200 && ended.data.ended === true && (await request('GET', voicePath, owner.token)).data.voiceRoom === null, 'a group admin ends it for everyone', ended.data);
  check(actions('closeRoom').some((a) => a.roomName === roomName), 'LiveKit closes the room (everyone is disconnected)');
  let entry = null;
  for (let i = 0; i < 40 && !entry; i++) { entry = await Message.findOne({ 'callLog.callId': roomId }); if (!entry) await wait(25); }
  const endedRoom = await VoiceRoom.findById(roomId).lean();
  check(entry?.callLog?.voiceChat === true && String(endedRoom.endedBy) === admin.id && endedRoom.members.length === 0, 'it leaves its "voice chat ended" entry and records who ended it', { entry: entry?.callLog, endedBy: endedRoom.endedBy });
  const fresh = await request('POST', `${voicePath}/join`, member.token);
  check(fresh.status === 201 && fresh.data.voiceRoom.id !== roomId, 'the next voice chat starts clean', fresh.data.voiceRoom?.id);
  await request('POST', `/api/voice/${fresh.data.voiceRoom.id}/end`, member.token);

  console.log('\n--- calls: camera default, screen sharing, dropped phones ---');
  const dm = await request('POST', '/api/chats/dm', owner.token, { username: `Ctl1${suffix}` });
  const callPath = `/api/chats/${dm.data.chat.id}/calls`;
  const audio = await request('POST', callPath, owner.token, { type: 'audio' });
  check(audio.data.media?.cameraStartsOn === false && audio.data.transcription?.on === sparksOn, 'an audio call starts with the camera off and says whether it is transcribed', { media: audio.data.media, transcription: audio.data.transcription });
  const incoming = await request('GET', '/api/calls/incoming', admin.token);
  check(incoming.data.transcription?.on === sparksOn, 'the ringing call says whether it is transcribed (before answering)', incoming.data.transcription);
  const callId = audio.data.call.id;
  const answered = await request('POST', `/api/calls/${callId}/accept`, admin.token);
  check(answered.data.media?.cameraStartsOn === false, 'answering an audio call: camera off', answered.data.media);
  const callShare = await request('POST', `/api/calls/${callId}/screen-share/start`, admin.token);
  check(callShare.status === 200 && callShare.data.call.screenShare?.userId === admin.id, 'screen sharing in a call', callShare.data.call);
  const callSecond = await request('POST', `/api/calls/${callId}/screen-share/start`, owner.token);
  check(callSecond.status === 409 && callSecond.data.reason === 'someone_sharing' && /Ctl 1 is already sharing/.test(callSecond.data.error), 'one person at a time in calls too', callSecond.data);
  check((await request('POST', `/api/calls/${callId}/screen-share/stop`, owner.token)).status === 403, 'only the sharer stops their share');
  check((await request('POST', `/api/calls/${callId}/screen-share/stop`, admin.token)).data.call.screenShare === null, 'the sharer stops sharing');
  // A phone that dropped out and never came back: the call ends instead of staying "busy".
  const calls = require('../src/controllers/callController');
  await calls.participantLeft(callId, admin.id, new Date(Date.now() - 30000));
  check((await Call.findById(callId)).members.find((m) => String(m.user) === admin.id).disconnectedAt !== null, 'the drop-out is noted');
  await calls._internal.refreshCall(callId);
  const afterDrop = await request('GET', `/api/calls/${callId}`, owner.token);
  check(afterDrop.data.call.status === 'ended', 'still gone after the grace period: they left, and a one-to-one call ends', afterDrop.data.call.status);
  const video = await request('POST', callPath, owner.token, { type: 'video' });
  check(video.data.media?.cameraStartsOn === true, 'a video call starts with the camera on', video.data.media);
  await request('POST', `/api/calls/${video.data.call.id}/end`, owner.token);

  console.log('\n--- Sparks notes access ---');
  if (!sparksOn) {
    check((await request('GET', `/api/calls/${callId}/notes`, owner.token)).status === 503, 'notes need the Sparks module (503 on the stand-in engine)');
  } else {
    const notesId = new mongoose.Types.ObjectId().toString();
    await sparks.store.insertCall({ callId: notesId, chatId: group.id, startedAt: Date.now(), endedAt: null, startedBy: member.id, status: 'active', attendees: [member.id], everAttended: [member.id] });
    const mine = await request('GET', `/api/calls/${notesId}/notes`, member.token);
    check(mine.status === 200 && mine.data.canOpen === true && mine.data.reason === 'attended' && mine.data.outline === 'pending' && mine.data.kept === 'until_deleted', 'someone who was on it can open its notes (kept until deleted)', mine.data);
    const adminNotes = await request('GET', `/api/calls/${notesId}/notes`, admin.token);
    check(adminNotes.data.canOpen === true && adminNotes.data.reason === 'chat_admin', 'a chat admin can open them too', adminNotes.data);
    const notMine = await request('GET', `/api/calls/${notesId}/notes`, other.token);
    check(notMine.status === 200 && notMine.data.canOpen === false && notMine.data.reason === 'not_on_call', 'a member who was not on it cannot', notMine.data);
    check((await request('GET', `/api/calls/${new mongoose.Types.ObjectId()}/notes`, member.token)).status === 404, 'unknown call: 404');
  }

  return { pass, fail };
}

module.exports = { run };
