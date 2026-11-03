// Calls on Android phones whose app rings itself (dataCalls): the data-only
// call_incoming push, then call_ended / call_missed when that person's ring
// is over, and the "Missed call" notification for every other phone.
// Expo is replaced by a capture; no Apple or Google keys are set.
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Call = require('../src/models/Call');
const push = require('../src/utils/push');
const callPush = require('../src/utils/callPush');
const { signToken } = require('../src/utils/token');

const ENV = ['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_PRIVATE_KEY', 'APNS_BUNDLE_ID', 'FCM_SERVICE_ACCOUNT'];

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

  const saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
  for (const name of ENV) delete process.env[name];
  callPush.resetForTests();

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const made = await Promise.all(['Ringer', 'Selfring', 'Plaindroid', 'Iphonedata'].map((name) => User.create({
    profile: { username: `${name}${suffix}`, usernameNormalized: `${name.toLowerCase()}${suffix}`, firstName: name, lastName: 'Notify', avatarKey: 'green-knight' },
    onboardingComplete: true, faction: 'ascendants', preferences: { notificationsEnabled: true },
  })));
  const [caller, droid, plain, iphone] = made.map((user) => ({
    id: user.id, username: user.profile.username, token: signToken(user.id, user.tokenVersion),
    pushToken: `ExponentPushToken[${user.profile.username}]`,
  }));
  // The person who rings themselves has two phones: answering on one stops the other.
  const droidPhones = [droid.pushToken, `ExponentPushToken[second-${droid.username}]`];
  const sent = push.captureForTests();
  const dataTo = (token, type, callId) => sent.filter((m) => m.to === token && m.data?.type === type && m.data.callId === callId);

  async function dmWith(user) {
    return (await request('POST', '/api/chats/dm', caller.token, { username: user.username })).data.chat.id;
  }
  async function startCall(chatId, type = 'audio') {
    return (await request('POST', `/api/chats/${chatId}/calls`, caller.token, { type })).data?.call?.id;
  }

  try {
    console.log('\n--- calls on phones that ring themselves (data pushes) ---');

    const reg = await request('POST', '/api/users/me/devices', droid.token, { pushToken: droidPhones[0], platform: 'android', dataCalls: true });
    await request('POST', '/api/users/me/devices', droid.token, { pushToken: droidPhones[1], platform: 'android', dataCalls: true });
    check(reg.status === 200 && reg.data.callRinging === 'data' && reg.data.user.devices.find((d) => d.pushToken === droidPhones[0])?.dataCalls === true,
      'dataCalls on an Android phone: its calls ring from a data push (callRinging data)', reg.data);
    const again = await request('POST', '/api/users/me/devices', droid.token, { pushToken: droidPhones[0], platform: 'android' });
    check(again.data?.callRinging === 'data', 'registering again without dataCalls leaves it as it was', again.data?.callRinging);
    const ios = await request('POST', '/api/users/me/devices', iphone.token, { pushToken: iphone.pushToken, platform: 'ios', dataCalls: true });
    check(ios.data?.callRinging === 'push', 'an iPhone keeps the ringtone push (iOS holds back data-only pushes)', ios.data?.callRinging);
    const notBool = await request('POST', '/api/users/me/devices', droid.token, { pushToken: droidPhones[0], platform: 'android', dataCalls: 'yes' });
    check(notBool.status === 400 && notBool.data?.error === 'dataCalls must be true or false.', 'dataCalls must be true or false', notBool);
    await request('POST', '/api/users/me/devices', plain.token, { pushToken: plain.pushToken, platform: 'android' });

    // Ringing: call_incoming, data only, and no ringtone push to those phones.
    const droidChat = await dmWith(droid);
    const hungUp = await startCall(droidChat, 'video');
    const incoming = await waitFor(sent, (m) => m.to === droidPhones[0] && m.data?.type === 'call_incoming' && m.data.callId === hungUp);
    const d = incoming?.data || {};
    const expiresIn = (new Date(d.expiresAt) - Date.now()) / 1000;
    check(incoming && !('title' in incoming) && !('body' in incoming) && !('sound' in incoming) && !('channelId' in incoming) && incoming.priority === 'high' && incoming.ttl === 60,
      'call_incoming is data only (the app shows its own notification), high priority, for the minute', incoming);
    check(d.chatId === droidChat && d.callType === 'video' && d.isGroup === false && d.caller?.id === caller.id && d.caller.username === caller.username && expiresIn > 55 && expiresIn <= 60,
      'with what the notification needs: the caller, video or voice, the chat, when it stops ringing', d);
    check(dataTo(droidPhones[1], 'call_incoming', hungUp).length === 1, 'every phone of theirs rings', sent.filter((m) => m.to === droidPhones[1]));
    await sleep(200);
    check(!sent.some((m) => droidPhones.includes(m.to) && m.data?.type === 'call'), 'no ringtone push to a phone that rings itself', sent.filter((m) => droidPhones.includes(m.to)));

    // The caller hangs up: call_missed (the app shows "Missed call"), no second notification.
    await request('POST', `/api/calls/${hungUp}/end`, caller.token);
    const missedData = await waitFor(sent, (m) => m.to === droidPhones[0] && m.data?.type === 'call_missed' && m.data.callId === hungUp);
    check(missedData && !('title' in missedData) && missedData.data.caller?.id === caller.id && missedData.data.callType === 'video' && missedData.data.chatId === droidChat,
      'the caller hangs up: call_missed with the caller, so the phone stops ringing and shows "Missed call"', missedData);
    await sleep(300);
    check(dataTo(droidPhones[0], 'call_missed', hungUp).length === 1 && dataTo(droidPhones[1], 'call_missed', hungUp).length === 1 && !sent.some((m) => droidPhones.includes(m.to) && m.data?.type === 'missed_call'),
      'once per phone, and no "Missed call" notification from the server as well', sent.filter((m) => droidPhones.includes(m.to)).map((m) => m.data?.type));

    // Declined on one phone: the others stop, no missed call.
    const declined = await startCall(droidChat);
    await waitFor(sent, (m) => m.data?.type === 'call_incoming' && m.data.callId === declined);
    await request('POST', `/api/calls/${declined}/decline`, droid.token);
    const declinedEnd = await waitFor(sent, (m) => m.to === droidPhones[1] && m.data?.type === 'call_ended' && m.data.callId === declined);
    await sleep(200);
    check(declinedEnd?.data.reason === 'declined' && declinedEnd.ttl === 60 && !dataTo(droidPhones[1], 'call_missed', declined).length,
      'declined: call_ended (reason declined) stops the other phones; not a missed call', declinedEnd);

    // Answered on one phone: the other stops; nothing more when the call ends.
    const answered = await startCall(droidChat);
    await waitFor(sent, (m) => m.data?.type === 'call_incoming' && m.data.callId === answered);
    const accept = await request('POST', `/api/calls/${answered}/accept`, droid.token);
    const answeredEnd = await waitFor(sent, (m) => m.to === droidPhones[1] && m.data?.type === 'call_ended' && m.data.callId === answered);
    check(accept.status === 200 && answeredEnd?.data.reason === 'answered', 'answered: call_ended (reason answered) stops their other phones (it never hangs up)', answeredEnd);
    await request('POST', `/api/calls/${answered}/end`, caller.token);
    await sleep(300);
    check(dataTo(droidPhones[1], 'call_ended', answered).length === 1 && !dataTo(droidPhones[1], 'call_missed', answered).length,
      'the call ending later sends nothing more', sent.filter((m) => m.data?.callId === answered).map((m) => m.data.type));

    // Nobody answers within the minute: call_missed.
    const unanswered = await startCall(droidChat);
    await waitFor(sent, (m) => m.data?.type === 'call_incoming' && m.data.callId === unanswered);
    await Call.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(unanswered) },
      { $set: { createdAt: new Date(Date.now() - 61_000), 'members.$[ringing].invitedAt': new Date(Date.now() - 61_000) } },
      { arrayFilters: [{ 'ringing.status': 'ringing' }] }
    );
    await request('GET', `/api/calls/${unanswered}`, caller.token);
    check(await waitFor(sent, (m) => m.to === droidPhones[0] && m.data?.type === 'call_missed' && m.data.callId === unanswered),
      'nobody answers within the minute: call_missed', sent.filter((m) => m.data?.callId === unanswered).map((m) => m.data.type));

    console.log('\n--- "Missed call" for every other phone ---');
    const plainChat = await dmWith(plain);
    const plainCall = await startCall(plainChat);
    const ringtone = await waitFor(sent, (m) => m.to === plain.pushToken && m.data?.type === 'call' && m.data.callId === plainCall);
    check(ringtone?.sound === 'ringtone.wav' && !dataTo(plain.pushToken, 'call_incoming', plainCall).length, 'an Android phone without dataCalls rings with the ringtone push', ringtone);
    await request('POST', `/api/calls/${plainCall}/end`, caller.token);
    const missedNote = await waitFor(sent, (m) => m.to === plain.pushToken && m.data?.type === 'missed_call' && m.data.callId === plainCall);
    check(missedNote?.title === caller.username && missedNote.body === 'Missed voice call' && missedNote.data.chatId === plainChat && missedNote.channelId === 'default' && missedNote.collapseId === `call-${plainCall}`,
      'missed: a "Missed voice call" notification from the caller, opening the chat, in the ringtone\'s place on iPhones', missedNote);
    await sleep(300);
    check(sent.filter((m) => m.to === plain.pushToken && m.data?.type === 'missed_call').length === 1 && !sent.some((m) => m.to === plain.pushToken && m.data?.type === 'call_ended'),
      'only once, and no data pushes to a phone that doesn\'t ring itself', sent.filter((m) => m.to === plain.pushToken).map((m) => m.data?.type));

    const iphoneChat = await dmWith(iphone);
    const iphoneCall = await startCall(iphoneChat, 'video');
    const iphoneRing = await waitFor(sent, (m) => m.to === iphone.pushToken && m.data?.type === 'call' && m.data.callId === iphoneCall);
    check(iphoneRing && !dataTo(iphone.pushToken, 'call_incoming', iphoneCall).length, 'an iPhone with dataCalls still gets the ringtone push', iphoneRing);
    await request('POST', `/api/calls/${iphoneCall}/decline`, iphone.token);
    await sleep(300);
    check(!sent.some((m) => m.to === iphone.pushToken && m.data?.type === 'missed_call' && m.data.callId === iphoneCall), 'declined is not a missed call', sent.filter((m) => m.to === iphone.pushToken).map((m) => m.data?.type));
  } catch (error) {
    check(false, 'call notifications suite threw', error.stack);
  } finally {
    push.resetForTests();
    for (const name of ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    callPush.resetForTests();
  }
  return { pass, fail };
}

module.exports = { run };
