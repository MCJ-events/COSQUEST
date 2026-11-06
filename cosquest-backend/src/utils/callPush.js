/**
 * Calls that ring with the phone's own call screen, like a phone call:
 * CallKit on iPhones, the system call screen on Android. The app does it
 * with expo-callkit-telecom; this server sends that library's pushes
 * straight to Apple and Google (Expo's push service can't carry them):
 *   - iPhone: an APNs VoIP push (PushKit), body { incomingCall: <event> }.
 *     iOS shows the call before the app's JavaScript even starts.
 *   - Android: an FCM data message, data { messageType: 'incomingCall',
 *     incomingCall: '<event as JSON>' }; and { messageType: 'callEnded',
 *     callEnded: '<{ eventId, serverCallId, reason } as JSON>' } to stop it
 *     ringing (an iPhone stops from the app, which hears call:updated).
 * The phone registers its token with POST /api/users/me/devices
 * { voipToken, voipType }. Each side stays off until its keys are set; until
 * then, and for phones without a call token, or if a send fails, calls ring
 * with the ringtone push (push.js).
 *
 * Env:
 *   APNS_KEY_ID, APNS_TEAM_ID  the APNs auth key (Apple Developer > Keys) and the team
 *   APNS_PRIVATE_KEY           the .p8 file's contents (newlines may be written \n)
 *   APNS_BUNDLE_ID             the app's bundle id (the push topic is <bundle id>.voip)
 *   APNS_PRODUCTION            1 for TestFlight / App Store builds; otherwise the
 *                              sandbox (development builds)
 *   FCM_SERVICE_ACCOUNT        the Firebase service account JSON, or a path to the file
 *                              (on Render, a secret file such as /etc/secrets/fcm.json)
 *   CALL_DECLINE_SECRET        optional: signs decline passes (default: a key
 *                              derived from JWT_SECRET, never JWT_SECRET itself)
 *   PUBLIC_BASE_URL            this server's public address, for the decline URL
 *                              (default: RENDER_EXTERNAL_URL, which Render sets)
 *   APNS_URL, FCM_URL, FCM_TOKEN_URL  overrides (tests)
 */
const crypto = require('crypto');
const fs = require('fs');
const http2 = require('http2');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// How long a call rings: after this, someone who hasn't answered has missed
// it (callController.js), and every phone stops ringing.
const RING_SECONDS = 60;
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function apnsConfig() {
  const { APNS_KEY_ID: keyId, APNS_TEAM_ID: teamId, APNS_PRIVATE_KEY: key, APNS_BUNDLE_ID: bundleId } = process.env;
  if (!keyId || !teamId || !key || !bundleId) return null;
  const host = process.env.APNS_PRODUCTION === '1' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
  return { keyId, teamId, key: key.replace(/\\n/g, '\n'), topic: `${bundleId}.voip`, url: process.env.APNS_URL || host };
}

// Read once per value of FCM_SERVICE_ACCOUNT.
let serviceAccount = { source: undefined, account: null };
function fcmConfig() {
  const source = process.env.FCM_SERVICE_ACCOUNT;
  if (!source) return null;
  if (serviceAccount.source !== source) {
    let account = null;
    try {
      const parsed = JSON.parse(source.trim().startsWith('{') ? source : fs.readFileSync(source, 'utf8'));
      if (parsed.client_email && parsed.private_key && parsed.project_id) account = parsed;
      else console.warn('[callPush] FCM_SERVICE_ACCOUNT has no client_email, private_key or project_id');
    } catch (err) {
      console.warn('[callPush] could not read FCM_SERVICE_ACCOUNT:', err.message);
    }
    serviceAccount = { source, account };
  }
  return serviceAccount.account;
}

/** Can this phone ring with its own call screen right now? */
function canRing(phone) {
  if (!phone?.voipToken) return false;
  if (phone.voipType === 'APNS_VOIP') return Boolean(apnsConfig());
  if (phone.voipType === 'FCM') return Boolean(fcmConfig());
  return false;
}

// ---------- Apple (APNs over HTTP/2) ----------

let apnsSession = null; // { url, session }: one connection, reused

function apnsClient(url) {
  const open = apnsSession?.url === url && !apnsSession.session.closed && !apnsSession.session.destroyed;
  if (open) return apnsSession.session;
  const session = http2.connect(url);
  session.on('error', (err) => console.warn('[callPush] APNs connection error:', err.message));
  session.on('goaway', () => session.close());
  session.setTimeout(30 * 60 * 1000, () => session.close()); // idle
  session.unref();
  apnsSession = { url, session };
  return session;
}

// Apple wants the same provider token reused (at most one new one per 20
// minutes) and refuses one older than an hour: a new one every 40 minutes.
let apnsJwt = { id: null, token: null, at: 0 };
function apnsToken(config) {
  const id = `${config.keyId}:${config.teamId}`;
  if (apnsJwt.id !== id || Date.now() - apnsJwt.at > 40 * 60 * 1000) {
    const token = jwt.sign({ iss: config.teamId }, config.key, { algorithm: 'ES256', keyid: config.keyId });
    apnsJwt = { id, token, at: Date.now() };
  }
  return apnsJwt.token;
}

// Resolves to { ok, gone } (gone: the token is dead), never rejects.
function sendApns(config, deviceToken, payload) {
  return new Promise((resolve) => {
    let request;
    try {
      request = apnsClient(config.url).request({
        ':method': 'POST',
        ':path': `/3/device/${encodeURIComponent(deviceToken)}`,
        authorization: `bearer ${apnsToken(config)}`,
        'apns-topic': config.topic,
        'apns-push-type': 'voip',
        'apns-priority': '10',
        // A ring that can't be delivered in time is not delivered at all.
        'apns-expiration': String(Math.floor(Date.now() / 1000) + RING_SECONDS),
        'content-type': 'application/json',
      });
    } catch (err) {
      console.warn('[callPush] APNs send failed:', err.message);
      resolve({ ok: false });
      return;
    }
    let status = 0;
    let text = '';
    request.setEncoding('utf8');
    request.on('response', (headers) => { status = Number(headers[':status']); });
    request.on('data', (chunk) => { text += chunk; });
    request.on('end', () => {
      if (status === 200) return resolve({ ok: true });
      let reason = '';
      try { reason = JSON.parse(text).reason || ''; } catch { /* no body */ }
      // 410 Unregistered: the app is gone from the phone. BadDeviceToken: not
      // a token for this environment (a development build's token while
      // APNS_PRODUCTION=1, or the other way round).
      const gone = status === 410 || reason === 'Unregistered' || reason === 'BadDeviceToken';
      console.warn(`[callPush] APNs ${status} ${reason}${reason === 'BadDeviceToken' ? ' (check APNS_PRODUCTION)' : ''}`);
      return resolve({ ok: false, gone });
    });
    request.on('error', (err) => {
      console.warn('[callPush] APNs request failed:', err.message);
      resolve({ ok: false });
    });
    request.setTimeout(10000, () => request.close(http2.constants.NGHTTP2_CANCEL));
    request.end(JSON.stringify(payload));
  });
}

// ---------- Google (FCM HTTP v1) ----------

let fcmAccess = { email: null, token: null, expiresAt: 0 };
async function fcmAccessToken(account) {
  if (fcmAccess.email === account.client_email && Date.now() < fcmAccess.expiresAt - 5 * 60 * 1000) return fcmAccess.token;
  const assertion = jwt.sign({ scope: 'https://www.googleapis.com/auth/firebase.messaging' }, account.private_key, {
    algorithm: 'RS256', issuer: account.client_email, audience: GOOGLE_TOKEN_URL, expiresIn: 3600,
  });
  const response = await fetch(process.env.FCM_TOKEN_URL || GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(`Google token ${response.status}: ${JSON.stringify(body).slice(0, 200)}`);
  fcmAccess = { email: account.client_email, token: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
  return fcmAccess.token;
}

// Resolves to { ok, gone }, never rejects. Data values must be strings.
async function sendFcm(account, deviceToken, data) {
  try {
    const response = await fetch(`${process.env.FCM_URL || 'https://fcm.googleapis.com'}/v1/projects/${account.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await fcmAccessToken(account)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token: deviceToken, data, android: { priority: 'HIGH', ttl: `${RING_SECONDS}s` } } }),
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) return { ok: true };
    if (response.status === 401) fcmAccess = { email: null, token: null, expiresAt: 0 };
    const body = await response.json().catch(() => ({}));
    const code = (body.error?.details || []).find((detail) => detail.errorCode)?.errorCode || body.error?.status || '';
    // UNREGISTERED: the app was removed from the phone or the token replaced.
    const gone = response.status === 404 || code === 'UNREGISTERED';
    console.warn(`[callPush] FCM ${response.status} ${code}`);
    return { ok: false, gone };
  } catch (err) {
    console.warn('[callPush] FCM send failed:', err.message);
    return { ok: false };
  }
}

// ---------- ringing ----------

// What expo-callkit-telecom shows (IncomingCallEvent). eventId: one per push
// (the phone drops a repeat). serverCallId: our call id, back in the app.
function incomingCallEvent(call, caller) {
  return {
    eventId: crypto.randomUUID(),
    serverCallId: String(call.id || call._id),
    hasVideo: call.type === 'video',
    startedAt: new Date(call.createdAt || Date.now()).toISOString(),
    caller: {
      id: String(caller?.id || ''),
      displayName: caller?.name || caller?.username || 'CosQuest',
      ...(caller?.avatarPhotoUrl ? { avatarUrl: caller.avatarPhotoUrl } : {}),
    },
    metadata: {
      chatId: call.conversationId ? String(call.conversationId) : null,
      isGroup: Boolean(call.isGroup),
      privateOf: call.privateOf ? String(call.privateOf) : null,
      username: caller?.username || null,
    },
  };
}

// Declining with CosQuest fully closed (Android): the library hands that to
// the app's native receiver, which can't use the app's login. So each ring
// carries a pass for this call and this person (2 minutes) and the URL to
// post it to (callDeclinePassController.js), in the event's metadata.
// Signed with its own key, so a pass can never be taken for a session token.
const DECLINE_PURPOSE = 'call-decline';

function declineKey() {
  if (process.env.CALL_DECLINE_SECRET) return process.env.CALL_DECLINE_SECRET;
  if (!process.env.JWT_SECRET) return null;
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(DECLINE_PURPOSE).digest();
}

function withDeclinePass(event, userId) {
  const key = declineKey();
  const base = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  if (!userId || !key) return event;
  const declinePass = jwt.sign({ sub: String(userId), call: String(event.serverCallId), purpose: DECLINE_PURPOSE }, key, { algorithm: 'HS256', expiresIn: RING_SECONDS * 2 });
  return {
    ...event,
    metadata: {
      ...event.metadata,
      declinePass,
      // No public address set: the app posts to its own API address instead.
      ...(base ? { declineUrl: `${base}/api/call-decline/${event.serverCallId}` } : {}),
    },
  };
}

/** The user id a decline pass is for, or null (another call, expired, forged). */
function verifyDeclinePass(pass, callId) {
  const key = declineKey();
  if (!key || typeof pass !== 'string' || !pass) return null;
  try {
    const claims = jwt.verify(pass, key, { algorithms: ['HS256'] });
    if (claims.purpose !== DECLINE_PURPOSE || String(claims.call) !== String(callId) || !claims.sub) return null;
    return String(claims.sub);
  } catch {
    return null;
  }
}

async function forgetTokens(tokens) {
  if (!tokens.length) return;
  await User.updateMany(
    { 'devices.voipToken': { $in: tokens } },
    { $set: { 'devices.$[phone].voipToken': null, 'devices.$[phone].voipType': null } },
    { arrayFilters: [{ 'phone.voipToken': { $in: tokens } }] }
  );
}

/**
 * Rings these phones ({ token, voipToken, voipType } from push.js, each one
 * canRing) with their own call screen. Resolves to the Expo push tokens of
 * the phones it reached; the caller sends the ringtone push to the rest.
 */
async function ring(phones, { call, caller }) {
  const reached = new Set();
  const gone = [];
  const apns = apnsConfig();
  const fcm = fcmConfig();
  await Promise.all(phones.map(async (phone) => {
    const event = withDeclinePass(incomingCallEvent(call, caller), phone.userId);
    let result = { ok: false };
    if (phone.voipType === 'APNS_VOIP' && apns) {
      result = await sendApns(apns, phone.voipToken, { incomingCall: event });
    } else if (phone.voipType === 'FCM' && fcm) {
      result = await sendFcm(fcm, phone.voipToken, { messageType: 'incomingCall', incomingCall: JSON.stringify(event) });
    }
    if (result.ok) reached.add(phone.token);
    if (result.gone) gone.push(phone.voipToken);
  }));
  await forgetTokens(gone);
  return reached;
}

/**
 * Stops the call screen ringing on these Android phones (FCM). reason:
 * 'declinedElsewhere' | 'unanswered' | 'remoteEnded' (expo-callkit-telecom's
 * CallEndedReason). A phone whose call screen already closed ignores it.
 */
async function ringEnded(phones, { callId, reason }) {
  const fcm = fcmConfig();
  if (!fcm) return;
  const gone = [];
  await Promise.all(phones.filter((phone) => phone.voipType === 'FCM' && phone.voipToken).map(async (phone) => {
    const callEnded = JSON.stringify({ eventId: crypto.randomUUID(), serverCallId: String(callId), reason });
    const result = await sendFcm(fcm, phone.voipToken, { messageType: 'callEnded', callEnded });
    if (result.gone) gone.push(phone.voipToken);
  }));
  await forgetTokens(gone);
}

/** Tests: drop cached keys, tokens and the APNs connection. */
function resetForTests() {
  apnsSession?.session.close();
  apnsSession = null;
  apnsJwt = { id: null, token: null, at: 0 };
  fcmAccess = { email: null, token: null, expiresAt: 0 };
  serviceAccount = { source: undefined, account: null };
}

module.exports = { canRing, ring, ringEnded, incomingCallEvent, withDeclinePass, verifyDeclinePass, RING_SECONDS, resetForTests };
