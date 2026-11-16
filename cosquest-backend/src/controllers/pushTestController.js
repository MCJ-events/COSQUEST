// POST /api/users/me/push-test { kind: 'message' | 'call' }
// The app's Settings > Notifications check: a real push to THIS person's
// phones, with each phone's exact answer, so "nothing arrives" becomes a
// reason. Messages: Expo's ticket AND its receipt (where credential errors
// such as InvalidCredentials / MismatchSenderId show up, a few seconds
// later). Calls: how each phone rings (its own call screen, the app's own
// ringing, or the ringtone push) and Google's / Apple's / Expo's answer,
// 10 seconds after the request (lock the phone while it waits). The test
// call's id starts with "test-": the app never tells the server about it
// (and a decline pass for it is refused: callDeclinePassController.js).
// `server` says which call-screen keys this server has (callPush.ringingSetup).
// Each test is also logged, so the answers show in the server log.
const crypto = require('crypto');
const push = require('../utils/push');
const callPush = require('../utils/callPush');

const EXPO_SEND = () => process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';
// Receipts live next to send (so a proxy or test stand-in set in
// EXPO_PUSH_URL gets both).
const EXPO_RECEIPTS = () => EXPO_SEND().replace(/\/send\/?$/, '/getReceipts');
// The most phones one test pushes to: the latest registered.
const MAX_PHONES = 10;
// Tests shorten these.
const timing = { everyMs: 10000, callDelayMs: 10000, receiptDelayMs: 4000 };

const lastTest = new Map(); // userId -> time (one test every 10 s)
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const short = (token) => (token && token.length > 24 ? `${token.slice(0, 16)}…${token.slice(-6)}` : token);

function tooSoon(userId) {
  const now = Date.now();
  if (now - (lastTest.get(userId) || 0) < timing.everyMs) return true;
  for (const [id, at] of lastTest) if (now - at >= timing.everyMs) lastTest.delete(id);
  lastTest.set(userId, now);
  return false;
}

function expoHeaders() {
  return { 'Content-Type': 'application/json', Accept: 'application/json', ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) };
}

const EXPO_HINTS = {
  InvalidCredentials: ' The Expo project has no (or a wrong) FCM V1 key / APNs key: eas credentials.',
  MismatchSenderId: " The app's google-services.json is from another Firebase project than the key on Expo.",
  DeviceNotRegistered: ' This phone\'s token is no longer valid: reopen the app so it registers again.',
  MessageRateExceeded: ' Too many pushes to this phone: wait a little.',
};

// What Google / Apple said about a call-screen push, and what to do about it.
const CALL_HINTS = [
  [/SENDER_ID_MISMATCH/, " FCM_SERVICE_ACCOUNT is from another Firebase project than the app's google-services.json."],
  [/THIRD_PARTY_AUTH_ERROR/, ' The Firebase project has no (or a wrong) APNs key.'],
  [/UNREGISTERED|INVALID_ARGUMENT|404/, ' This phone\'s call token is no longer valid: reopen the app so it registers again.'],
  [/Google token|invalid_grant/, ' Google refused the service account: its key may have been deleted; make a new one.'],
  [/BadDeviceToken/, ' The build and APNS_PRODUCTION disagree (TestFlight / App Store: 1; development builds: unset).'],
  [/InvalidProviderToken|ExpiredProviderToken/, ' APNS_KEY_ID / APNS_TEAM_ID / APNS_PRIVATE_KEY don\'t match.'],
  [/BadTopic|TopicDisallowed|DeviceTokenNotForTopic/, ' APNS_BUNDLE_ID is not this app\'s bundle id.'],
];
const callHint = (error) => (CALL_HINTS.find(([pattern]) => pattern.test(error)) || [null, ''])[1];

// One Expo push, then its receipt: { ok, detail }.
async function expoSendAndReceipt(message) {
  try {
    const sent = await fetch(EXPO_SEND(), { method: 'POST', headers: expoHeaders(), body: JSON.stringify([message]), signal: AbortSignal.timeout(10000) });
    const body = await sent.json().catch(() => ({}));
    if (!sent.ok) return { ok: false, detail: `Expo answered ${sent.status}: ${JSON.stringify(body).slice(0, 200)}` };
    const ticket = body.data?.[0];
    if (!ticket || ticket.status !== 'ok') {
      const error = ticket?.details?.error || '';
      return { ok: false, detail: `Expo refused it: ${error || ticket?.message || 'no ticket'}.${EXPO_HINTS[error] || ''}` };
    }
    // Credential problems only show in the receipt, a few seconds later.
    await wait(timing.receiptDelayMs);
    const r = await fetch(EXPO_RECEIPTS(), { method: 'POST', headers: expoHeaders(), body: JSON.stringify({ ids: [ticket.id] }), signal: AbortSignal.timeout(10000) });
    const receipts = (await r.json().catch(() => ({}))).data || {};
    const receipt = receipts[ticket.id];
    if (!receipt) return { ok: true, detail: 'Expo accepted it (its receipt isn\'t ready yet: if nothing arrives, try again in a minute).' };
    if (receipt.status === 'ok') return { ok: true, detail: 'Delivered to Google / Apple by Expo.' };
    const error = receipt.details?.error || '';
    return { ok: false, detail: `Expo couldn't deliver it: ${error || receipt.message}.${EXPO_HINTS[error] || ''}` };
  } catch (error) {
    return { ok: false, detail: `Couldn't reach Expo: ${error.message}` };
  }
}

// A test call to one phone, the way a real call would ring it (push.ringPhones).
async function ringOne(d, { userId, call, caller }) {
  const phone = { userId, token: d.pushToken, platform: d.platform, voipToken: d.voipToken || null, voipType: d.voipType || null, dataCalls: d.dataCalls === true };
  if (callPush.canRing(phone)) {
    const result = await callPush.testRing(phone, { call, caller });
    const who = phone.voipType === 'FCM' ? 'Google' : 'Apple';
    return { way: "the phone's own call screen", ok: result.ok, detail: result.ok ? `${who} accepted the call push.` : `${who} refused it: ${result.error || 'unknown error'}.${callHint(result.error || '')}` };
  }
  if (push.ringsItself(phone)) {
    const result = await expoSendAndReceipt({ to: d.pushToken, data: { type: 'call_incoming', callId: call.id, chatId: null, callType: 'audio', isGroup: false, caller: { id: caller.id, name: caller.name }, expiresAt: new Date(Date.now() + callPush.RING_SECONDS * 1000).toISOString() }, priority: 'high', ttl: callPush.RING_SECONDS });
    return { way: "the app's own ringing (data push)", ...result };
  }
  const why = !d.voipToken ? 'no call token from this phone yet' : d.voipType === 'FCM' ? 'FCM_SERVICE_ACCOUNT is not set (or unreadable) on the server' : 'the APNs keys are not set on the server';
  const result = await expoSendAndReceipt({ to: d.pushToken, title: caller.name, body: 'Incoming call (test)', data: { type: 'call', callId: call.id }, sound: 'ringtone.wav', channelId: 'calls', priority: 'high', ttl: callPush.RING_SECONDS, interruptionLevel: 'time-sensitive' });
  return { way: `the ringtone notification (${why})`, ...result };
}

async function pushTest(req, res) {
  const kind = req.body?.kind === 'call' ? 'call' : 'message';
  const userId = String(req.userId);
  if (tooSoon(userId)) return res.status(429).json({ error: 'One test every 10 seconds.' });

  const user = req.user;
  const server = callPush.ringingSetup();
  const problems = [];
  if (user.preferences?.notificationsEnabled === false) problems.push('Notifications are switched off in your CosQuest settings.');
  if (process.env.PUSH_ENABLED === '0') problems.push('Pushes are switched off on the server (PUSH_ENABLED=0).');
  // The phones real pushes go to (push.recipients), the latest first.
  const devices = (user.devices || [])
    .filter((d) => d.authed && push.isExpoToken(d.pushToken))
    .sort((a, b) => new Date(b.registeredAt || 0) - new Date(a.registeredAt || 0))
    .slice(0, MAX_PHONES);
  if (!devices.length) {
    return res.json({ kind, phones: [], problems: [...problems, 'No phone is registered for your account: open Settings > Notifications check on the phone first.'], server });
  }

  let results;
  if (kind === 'message') {
    results = await Promise.all(devices.map(async (d) => ({
      way: 'message',
      ...(await expoSendAndReceipt({ to: d.pushToken, title: 'CosQuest test', body: 'If you can read this, message notifications work.', data: { type: 'test' }, sound: 'default', channelId: 'messages', priority: 'high' })),
    })));
  } else {
    // A test call, 10 seconds from now: each phone rings the way real calls would.
    await wait(timing.callDelayMs);
    const call = { id: `test-${crypto.randomUUID()}`, type: 'audio', createdAt: new Date(), conversationId: null, isGroup: false };
    const caller = { id: 'test', name: 'CosQuest test call', username: null };
    results = await Promise.all(devices.map((d) => ringOne(d, { userId, call, caller })));
  }
  const phones = devices.map((d, i) => ({ platform: d.platform, token: short(d.pushToken), ...results[i] }));
  console.log(`[push-test] ${userId} ${kind}: ${phones.map((p) => `${p.platform} ${p.ok ? 'ok' : 'FAILED'} (${p.way}): ${p.detail}`).join(' | ')}`);
  return res.json({ kind, phones, problems, server });
}

/** Tests: forget who tested when. */
function resetForTests() {
  lastTest.clear();
}

module.exports = { pushTest, timing, resetForTests };
