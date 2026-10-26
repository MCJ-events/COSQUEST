// Moderation in calls (by whoever started it), room admins in faction voice
// chats, removed people staying out, the stage (speakers and listeners), and
// "faction in danger" alerts.
const { io } = require('socket.io-client');
const { TrackSource } = require('livekit-server-sdk');
const User = require('../src/models/User');
const Conversation = require('../src/models/Conversation');
const Member = require('../src/models/ConversationMember');
const Block = require('../src/models/Block');
const FactionAlert = require('../src/models/FactionAlert');
const callRoom = require('../src/utils/callRoom');
const push = require('../src/utils/push');
const { signToken } = require('../src/utils/token');

async function run(baseUrl) {
  let pass = 0;
  let fail = 0;
  function check(ok, name, value) {
    if (ok) { pass += 1; console.log(`  ok  - ${name}`); }
    else { fail += 1; console.log(`FAIL - ${name}`, JSON.stringify(value)); }
  }
  async function request(method, path, token, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function waitFor(list, predicate, ms = 2000) {
    for (let waited = 0; waited < ms; waited += 25) {
      const found = list.find(predicate);
      if (found) return found;
      await sleep(25);
    }
    return null;
  }
  const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url'));
  const recorded = callRoom.captureForTests();
  const actions = (action, identity) => recorded.filter((a) => a.action === action && (!identity || a.identity === identity));

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const factionKey = `ms${suffix}`;
  const names = ['Lead', 'Ally', 'Mid', 'Far', 'Admin', 'Blocked', 'Other'];
  const made = await Promise.all(names.map((name, i) => User.create({
    profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, lastName: 'Mod', avatarKey: 'green-knight' },
    onboardingComplete: true,
    // "Other" is in another faction.
    faction: name === 'Other' ? `${factionKey}x` : factionKey,
    preferences: { notificationsEnabled: true },
    devices: [{ pushToken: `ExponentPushToken[${name}${suffix}]`, platform: 'android', authed: true }],
  })));
  const [lead, ally, mid, far, roomAdmin, blockedUser, other] = made.map((user) => ({
    id: user.id, username: user.profile.username, token: signToken(user.id, user.tokenVersion), pushToken: user.devices[0].pushToken,
  }));
  await Block.create({ blocker: lead.id, blocked: blockedUser.id });

  console.log('\n--- calls: moderation by whoever started it ---');
  const dm = (await request('POST', '/api/chats/dm', lead.token, { username: ally.username })).data.chat.id;
  const started = await request('POST', `/api/chats/${dm}/calls`, lead.token, { type: 'audio' });
  const callId = started.data.call.id;
  check(started.data.call.moderatorId === lead.id, 'the call says who moderates it (whoever started it)', started.data.call.moderatorId);
  await request('POST', `/api/calls/${callId}/accept`, ally.token);
  await request('POST', `/api/calls/${callId}/invite`, ally.token, { userIds: [mid.id] });
  await request('POST', `/api/calls/${callId}/accept`, mid.token);

  const notLead = await request('POST', `/api/calls/${callId}/members/${mid.id}/mute`, ally.token);
  check(notLead.status === 403, 'someone else in the call cannot mute people', notLead.data);
  const muted = await request('POST', `/api/calls/${callId}/members/${mid.id}/mute`, lead.token);
  check(muted.status === 200 && muted.data.call.members.find((m) => m.user.id === mid.id)?.mutedByAdmin === true, 'the starter mutes someone: members[].mutedByAdmin', muted.data);
  check(actions('muteMicrophone', mid.id).length === 1 && actions('setSources', mid.id).at(-1)?.sources.includes(TrackSource.MICROPHONE) === false, 'LiveKit mutes their microphone and stops them turning it on', actions('setSources', mid.id));
  const midRejoin = await request('POST', `/api/calls/${callId}/join`, mid.token);
  check(midRejoin.status === 200 && !claims(midRejoin.data.token).video.canPublishSources.includes('microphone'), 'a muted person\'s new token has no microphone either', claims(midRejoin.data.token).video);
  const unmuted = await request('POST', `/api/calls/${callId}/members/${mid.id}/unmute`, lead.token);
  check(unmuted.status === 200 && unmuted.data.call.members.find((m) => m.user.id === mid.id)?.mutedByAdmin === false && actions('setSources', mid.id).at(-1)?.sources.includes(TrackSource.MICROPHONE), 'unmute: they may talk again', unmuted.data);
  check((await request('POST', `/api/calls/${callId}/members/${lead.id}/mute`, lead.token)).status === 400, 'you cannot mute yourself');

  const removed = await request('POST', `/api/calls/${callId}/members/${mid.id}/remove`, lead.token);
  check(removed.status === 200 && removed.data.call.members.find((m) => m.user.id === mid.id)?.status === 'left', 'the starter removes someone: they are out of the call', removed.data);
  check(actions('removeFromRoom', mid.id).length === 1, 'and out of the LiveKit room', actions('removeFromRoom', mid.id));
  const back = await request('POST', `/api/calls/${callId}/join`, mid.token);
  check(back.status === 403 && back.data.reason === 'removed' && /removed/.test(back.data.error), 'a removed person cannot rejoin (403, reason "removed")', back.data);
  const reAdd = await request('POST', `/api/calls/${callId}/invite`, ally.token, { userIds: [mid.id] });
  check(reAdd.status === 409 && reAdd.data.skipped?.some((s) => s.userId === mid.id && s.reason === 'removed'), 'nobody can add them back by accident (skipped: removed)', reAdd.data);
  await request('POST', `/api/calls/${callId}/members/${mid.id}/allow`, lead.token);
  const reAdded = await request('POST', `/api/calls/${callId}/invite`, ally.token, { userIds: [mid.id] });
  check(reAdded.status === 200 && reAdded.data.invited?.includes(mid.id), 'after allow, they can be added again', reAdded.data);
  await request('POST', `/api/calls/${callId}/decline`, mid.token);

  console.log('\n--- faction voice chat: room admins and the stage ---');
  const room = await Conversation.create({ type: 'faction', factionKey });
  await Member.create({ conversation: room._id, user: roomAdmin.id, role: 'admin' });
  const voicePath = `/api/chats/${room.id}/voice`;
  const first = await request('POST', `${voicePath}/join`, lead.token);
  const roomId = first.data.voiceRoom.id;
  check(first.data.canModerate === false && first.data.canManageStage === true, 'the starter runs the stage but does not moderate', first.data);
  const adminJoin = await request('POST', `${voicePath}/join`, roomAdmin.token);
  check(adminJoin.data.canModerate === true && adminJoin.data.canEnd === true && adminJoin.data.canManageStage === true, 'a faction room admin may moderate, end and run the stage', adminJoin.data);
  await request('POST', `${voicePath}/join`, ally.token);
  await request('POST', `${voicePath}/join`, mid.token);
  const byMember = await request('POST', `/api/voice/${roomId}/members/${mid.id}/mute`, ally.token);
  check(byMember.status === 403 && /Only admins/.test(byMember.data.error), 'rank or membership alone cannot mute', byMember.data);
  const adminMute = await request('POST', `/api/voice/${roomId}/members/${mid.id}/mute`, roomAdmin.token);
  check(adminMute.status === 200 && adminMute.data.voiceRoom.members.find((m) => m.user.id === mid.id)?.mutedByAdmin === true, 'the room admin mutes someone in the faction voice chat', adminMute.data);
  await request('POST', `/api/voice/${roomId}/members/${mid.id}/unmute`, roomAdmin.token);

  check((await request('POST', `/api/voice/${roomId}/stage`, ally.token, { on: true })).status === 403, 'a member cannot turn the stage on');
  const stageOn = await request('POST', `/api/voice/${roomId}/stage`, roomAdmin.token, { on: true });
  const roleOf = (view, id) => view.members.find((m) => m.user.id === id)?.role;
  check(stageOn.status === 200 && stageOn.data.voiceRoom.stage === true && roleOf(stageOn.data.voiceRoom, roomAdmin.id) === 'speaker' && roleOf(stageOn.data.voiceRoom, lead.id) === 'speaker' && roleOf(stageOn.data.voiceRoom, ally.id) === 'listener' && stageOn.data.voiceRoom.speakerCount === 2,
    'stage on: the admin and the starter speak, everyone else listens', stageOn.data.voiceRoom);
  check(actions('setSources', ally.id).at(-1)?.sources.length === 0, 'listeners can no longer publish in LiveKit', actions('setSources', ally.id).at(-1));
  const listenerJoin = await request('POST', `${voicePath}/join`, far.token);
  const farVideo = claims(listenerJoin.data.token).video;
  check(farVideo.canPublish === false && farVideo.canSubscribe === true, 'someone joining a stage gets a listen-only token (canPublish false)', farVideo);
  check((await request('POST', `/api/voice/${roomId}/screen-share/start`, ally.token)).status === 403, 'listeners cannot share their screen');
  const hand = await request('POST', `/api/voice/${roomId}/hand`, ally.token, { raised: true });
  const afterHand = await request('GET', voicePath, ally.token);
  check(hand.status === 200 && afterHand.data.voiceRoom.members.find((m) => m.user.id === ally.id)?.handRaised === true, 'a listener raises a hand', afterHand.data.voiceRoom);
  const promote = await request('POST', `/api/voice/${roomId}/members/${ally.id}/role`, roomAdmin.token, { role: 'speaker' });
  const allyRow = promote.data.voiceRoom?.members.find((m) => m.user.id === ally.id);
  check(promote.status === 200 && allyRow?.role === 'speaker' && allyRow.handRaised === false && actions('setSources', ally.id).at(-1)?.sources.includes(TrackSource.MICROPHONE), 'promoted to speaker: the hand comes down and they can talk', allyRow);
  const demote = await request('POST', `/api/voice/${roomId}/members/${ally.id}/role`, lead.token, { role: 'listener' });
  check(demote.status === 200 && roleOf(demote.data.voiceRoom, ally.id) === 'listener', 'the starter moves them back to the audience', demote.data.voiceRoom);
  check((await request('POST', `/api/voice/${roomId}/members/${ally.id}/role`, lead.token, { role: 'boss' })).status === 400, 'role must be speaker or listener');
  const stageOff = await request('POST', `/api/voice/${roomId}/stage`, lead.token, { on: false });
  check(stageOff.data.voiceRoom.stage === false && stageOff.data.voiceRoom.members.every((m) => m.role === 'speaker'), 'stage off: everyone talks again', stageOff.data.voiceRoom);
  check((await request('POST', `/api/voice/${roomId}/members/${ally.id}/role`, lead.token, { role: 'speaker' })).status === 409, 'choosing speakers needs the stage on');

  const kicked = await request('POST', `/api/voice/${roomId}/members/${far.id}/remove`, roomAdmin.token);
  check(kicked.status === 200, 'the room admin removes someone', kicked.data);
  const kickedBack = await request('POST', `${voicePath}/join`, far.token);
  check(kickedBack.status === 403 && kickedBack.data.reason === 'removed', 'a removed person cannot rejoin the voice chat', kickedBack.data);

  console.log('\n--- "faction in danger" alerts ---');
  const sent = push.captureForTests();
  const heard = [];
  const banners = [];
  // Ally has the app open; Far doesn't.
  const socket = io(baseUrl, { auth: { token: ally.token }, transports: ['websocket'], reconnection: false });
  socket.on('alert:faction', (alert) => heard.push(alert));
  socket.on('banner', (banner) => banners.push(banner));
  await new Promise((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
  await sleep(200);
  try {
    check((await request('POST', `/api/calls/${callId}/alert`, far.token, {})).status === 403, 'only people in the call can send an alert from it');
    const alerted = await request('POST', `/api/calls/${callId}/alert`, lead.token, { message: 'Ambush at the bridge' });
    const alert = alerted.data.alert;
    check(alerted.status === 201 && alert?.source === 'call' && alert.callId === callId && alert.message === 'Ambush at the bridge' && alert.from?.id === lead.id, 'an alert from a call', alerted.data);
    const live = await waitFor(heard, (a) => a.alertId === alert?.alertId);
    check(live && live.callId === callId && live.from.username === lead.username, 'faction members with the app open get alert:faction', live);
    const toFar = await waitFor(sent, (m) => m.to === far.pushToken);
    check(toFar && toFar.channelId === 'alerts' && toFar.priority === 'high' && toFar.data.type === 'faction_alert' && toFar.data.alertId === alert.alertId && /Ambush at the bridge/.test(toFar.body), 'people with the app closed get a high-priority push on the alerts channel', toFar);
    await sleep(150);
    check(!sent.some((m) => m.to === ally.pushToken) && !banners.some((b) => b.data?.type === 'faction_alert'), 'the app open: only the alert event, no push or generic banner', { sent: sent.filter((m) => m.to === ally.pushToken), banners });
    check(!sent.some((m) => [lead.pushToken, blockedUser.pushToken, other.pushToken].includes(m.to)), 'not the sender, nobody blocked, nobody from another faction', sent.map((m) => m.to));
    const callNow = await request('GET', `/api/calls/${callId}`, ally.token);
    check(callNow.data.call.alert?.userId === lead.id && callNow.data.call.alert.alertId === alert.alertId, 'the call shows the flare on the sender (call.alert)', callNow.data.call.alert);
    const again = await request('POST', `/api/calls/${callId}/alert`, lead.token, {});
    check(again.status === 429 && again.data.reason === 'cooldown' && again.data.retryAfter > 0, 'one alert per person every 5 minutes', again.data);

    const seen = await request('GET', `/api/alerts/${alert.alertId}`, far.token);
    check(seen.status === 200 && seen.data.canRespond === true && seen.data.alert.callId === callId, 'GET the alert (what the push opens)', seen.data);
    check((await request('GET', `/api/alerts/${alert.alertId}`, other.token)).status === 403, 'another faction cannot see it');
    // Far was removed from the voice chat, not the call: they can respond.
    const responded = await request('POST', `/api/alerts/${alert.alertId}/respond`, far.token);
    check(responded.status === 200 && responded.data.source === 'call' && responded.data.call.members.find((m) => m.user.id === far.id)?.status === 'joined' && responded.data.token, 'Respond puts them straight into the call with a token', responded.data);
    check((await request('POST', `/api/alerts/${alert.alertId}/respond`, blockedUser.token)).status === 403, 'someone blocked by the sender cannot respond');
    check((await request('POST', `/api/alerts/${alert.alertId}/respond`, lead.token)).status === 400, 'the sender does not respond to their own alert');
    const stored = await FactionAlert.findById(alert.alertId).lean();
    check(stored.responders.map(String).includes(far.id) && stored.recipientCount === 4, 'responders and recipients are recorded', stored);

    // From a voice chat (Ally is in it; Mid can respond).
    await request('POST', `/api/calls/${callId}/end`, far.token);
    const fromVoice = await request('POST', `/api/voice/${roomId}/alert`, ally.token, {});
    check(fromVoice.status === 201 && fromVoice.data.alert.voiceRoomId === roomId && fromVoice.data.alert.message === null, 'an alert from a voice chat', fromVoice.data);
    const roomNow = await request('GET', voicePath, mid.token);
    check(roomNow.data.voiceRoom.alert?.userId === ally.id, 'the voice chat shows the flare (voiceRoom.alert)', roomNow.data.voiceRoom.alert);
    await request('POST', `/api/voice/${roomId}/leave`, mid.token);
    const midResponds = await request('POST', `/api/alerts/${fromVoice.data.alert.alertId}/respond`, mid.token);
    check(midResponds.status === 200 && midResponds.data.source === 'voice' && midResponds.data.voiceRoom?.id === roomId && midResponds.data.token, 'Respond joins the voice chat', midResponds.data);
    await FactionAlert.updateOne({ _id: fromVoice.data.alert.alertId }, { $set: { respondUntil: new Date(Date.now() - 1000) } });
    const late = await request('POST', `/api/alerts/${fromVoice.data.alert.alertId}/respond`, far.token);
    check(late.status === 410 && late.data.reason === 'expired', 'an expired alert answers 410', late.data);
  } finally {
    socket.disconnect();
    push.resetForTests();
    for (const u of [lead, roomAdmin, ally, mid]) await request('POST', `/api/voice/${roomId}/leave`, u.token);
    await request('POST', `/api/calls/${callId}/end`, lead.token);
    await request('POST', `/api/calls/${callId}/end`, ally.token);
  }

  console.log(`\ncall moderation, stage & alerts: ${pass} passed, ${fail} failed`);
  return { pass, fail };
}

module.exports = { run };
