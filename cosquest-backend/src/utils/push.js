/**
 * Push notifications to phones, through Expo's push service.
 *
 * The app registers an Expo push token per phone (POST /api/users/me/devices,
 * stored in `user.devices`). This module turns "tell these users X" into one
 * HTTPS call per 100 phones to https://exp.host/--/api/v2/push/send. Expo
 * delivers through APNs (iOS) and FCM (Android) with the credentials stored
 * on the app's Expo project, so this server holds no Apple or Google key.
 *
 * Who gets a push:
 *   - only users with `preferences.notificationsEnabled` on;
 *   - `category` (a key of `notificationCategories`, e.g. friendActivity) must
 *     not be switched off;
 *   - `skipOnline`: not users with the app ON SCREEN right now (connected and
 *     not reported in the background: socket.js, `app:state`). They get the
 *     same title, text and data over the socket instead, as a `banner` event
 *     the app shows as an in-app banner (like Instagram's), so nothing is
 *     silent while the app is open. Used for messages, mentions, post
 *     activity and scheduled calls. Calls always push (notifyIncomingCall);
 *     game events go to everyone as a push, because the game is not this
 *     socket.
 *
 * Never throws into a request: every entry point is fire-and-forget and logs
 * its own failures. Tokens Expo reports as DeviceNotRegistered are removed.
 *
 * Env:
 *   PUSH_ENABLED        "0" turns sending off (tokens are still stored).
 *                       Off by default under NODE_ENV=test.
 *   EXPO_ACCESS_TOKEN   optional: required only if the Expo project turns on
 *                       "enhanced push security".
 *   EXPO_PUSH_URL       optional override (tests, a proxy).
 */
const crypto = require('crypto');
const User = require('../models/User');
const { ringOutcome } = require('./ringOutcome');

const EXPO_PUSH_URL = () => process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';
const CHUNK = 100;
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]]{1,200}\]$/;
const CATEGORIES = ['eventReminders', 'questUpdates', 'factionNews', 'friendActivity', 'rankChanges'];

/** Android notification channels, created by the app (components/PushRegistration.tsx). */
const CHANNELS = ['default', 'messages', 'calls', 'game', 'alerts'];

// The ringtone a call push plays on iPhones: a file the app bundles with the
// expo-notifications config plugin (`sounds`), 29 s (iOS plays at most 30 s,
// so the push goes again every CALL_REPEAT_MS while still ringing, for the
// whole minute). Without the file, iOS plays its default sound. On Android
// the `calls` channel's own sound rings (the app gives the channel a
// one-minute ringtone when it creates it).
const CALL_SOUND = 'ringtone.wav';
const CALL_REPEAT_MS = () => Number(process.env.CALL_PUSH_REPEAT_MS) || 30 * 1000;

// The transport is swappable so tests can see what would be sent.
let transport = defaultTransport;
let sentLog = null;

async function defaultTransport(messages) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  const response = await fetch(EXPO_PUSH_URL(), {
    method: 'POST',
    headers,
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Expo push ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return Array.isArray(body.data) ? body.data : [];
}

function enabled() {
  if (sentLog) return true;
  if (process.env.PUSH_ENABLED === '0') return false;
  if (process.env.NODE_ENV === 'test' && process.env.PUSH_ENABLED !== '1') return false;
  return true;
}

function isExpoToken(token) {
  return typeof token === 'string' && EXPO_TOKEN.test(token);
}

function clip(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** The phones that should hear about this, as [{ userId, token, platform, voipToken, voipType, dataCalls }]. */
async function recipients(ids, { category }) {
  if (!ids.length) return [];
  const filter = { _id: { $in: ids }, 'preferences.notificationsEnabled': true, 'devices.0': { $exists: true } };
  if (category && CATEGORIES.includes(category)) filter[`notificationCategories.${category}`] = { $ne: false };
  const users = await User.find(filter, 'devices').lean();
  const out = [];
  for (const user of users) {
    const userId = String(user._id);
    for (const device of user.devices || []) {
      if (device.authed && isExpoToken(device.pushToken)) {
        out.push({ userId, token: device.pushToken, platform: device.platform, voipToken: device.voipToken || null, voipType: device.voipType || null, dataCalls: device.dataCalls === true });
      }
    }
  }
  return out;
}

// People with the app on screen right now (src/realtime/socket.js
// foregroundAmong): not merely connected, since a locked phone keeps its
// socket for a while and a push skipped then is a notification lost. If it
// can't be answered, nobody counts as on screen: a push too many beats one
// missed.
// Map of userId -> on-screen socket ids.
async function onScreenAmong(ids) {
  try {
    return await require('../realtime/socket').foregroundAmong(ids);
  } catch (err) {
    console.warn('[push] could not check who has the app open:', err.message);
    return new Map();
  }
}

// The in-app version of a push, for people with the app open: socket event
// `banner` { id, title, body, data, channel, actor, at }, to their on-screen
// sockets only (a second phone of theirs that is locked would otherwise show
// it, late, when opened). Same rules as the push about the kind of
// notification (a category switched off in settings means no banner either);
// it does not need push permission or a device.
async function bannerTo(onScreen, note) {
  let ids = [...onScreen.keys()];
  if (note.category && CATEGORIES.includes(note.category)) {
    const off = await User.find({ _id: { $in: ids }, [`notificationCategories.${note.category}`]: false }, '_id').lean();
    const muted = new Set(off.map((user) => String(user._id)));
    ids = ids.filter((id) => !muted.has(id));
  }
  const sockets = ids.flatMap((id) => onScreen.get(id));
  if (!sockets.length) return;
  const { emitToRooms } = require('../realtime/socket');
  emitToRooms(sockets, 'banner', {
    id: crypto.randomUUID(),
    title: note.title ? clip(note.title, 80) : null,
    body: clip(note.body, 180),
    data: note.data || {},
    channel: CHANNELS.includes(note.channel) ? note.channel : 'default',
    actor: note.actor || null,
    at: new Date().toISOString(),
  });
}

async function removeTokens(tokens) {
  if (!tokens.length) return;
  await User.updateMany({ 'devices.pushToken': { $in: tokens } }, { $pull: { devices: { pushToken: { $in: tokens } } } });
}

/**
 * Send one notification to some users. Resolves to how many phones Expo
 * accepted it for; never rejects.
 *
 * @param {string[]} userIds
 * @param {{ title?: string, body: string, data?: object, channel?: string,
 *           category?: string, skipOnline?: boolean, noBanner?: boolean, ttl?: number,
 *           collapseId?: string, sound?: string, interruptionLevel?: string,
 *           categoryId?: string, filter?: function, actor?: object }} note
 *           (sound: an app-bundled file for iPhones, default 'default';
 *           filter(phone): only the phones it keeps)  (categoryId: the
 *           buttons on the notification, a set the app registers with
 *           setNotificationCategoryAsync, e.g. 'message'; not `category`,
 *           which is the person's notification-settings switch)  (actor:
 *           { id, username, name, avatarKey, avatarPhotoUrl } - for the
 *           in-app banner's picture only)
 */
async function sendToUsers(userIds, note) {
  try {
    if (!note || !note.body) return 0;
    let ids = [...new Set((userIds || []).map(String))].filter(Boolean);
    if (note.skipOnline && ids.length) {
      const onScreen = await onScreenAmong(ids);
      if (onScreen.size) {
        // noBanner: the caller sent online users its own socket event.
        if (!note.noBanner) await bannerTo(onScreen, note);
        ids = ids.filter((id) => !onScreen.has(id));
      }
    }
    if (!enabled()) return 0;
    let phones = await recipients(ids, note);
    if (note.filter) phones = phones.filter(note.filter);
    if (!phones.length) return 0;
    const channelId = CHANNELS.includes(note.channel) ? note.channel : 'default';
    const messages = phones.map(({ token }) => ({
      to: token,
      ...(note.title ? { title: clip(note.title, 80) } : {}),
      body: clip(note.body, 180),
      data: note.data || {},
      sound: note.sound || 'default',
      ...(note.interruptionLevel ? { interruptionLevel: note.interruptionLevel } : {}),
      channelId,
      // Every notification goes out at high priority, so phones in battery
      // saving (Android doze) still show it at once.
      priority: 'high',
      ...(note.ttl ? { ttl: note.ttl } : {}),
      ...(note.collapseId ? { collapseId: note.collapseId } : {}),
      ...(note.categoryId ? { categoryId: note.categoryId } : {}),
    }));
    return await deliver(messages);
  } catch (err) {
    console.error('[push] send failed:', err.message);
    return 0;
  }
}

/**
 * A data-only push to these phones (from recipients): no title, text or
 * sound, so the phone shows nothing by itself and hands it to the app,
 * even when the app isn't running (Android). Resolves to how many phones
 * Expo accepted it for; never rejects.
 */
async function sendData(phones, data, { ttl } = {}) {
  try {
    if (!phones.length || !enabled()) return 0;
    return await deliver(phones.map(({ token }) => ({ to: token, data, priority: 'high', ...(ttl ? { ttl } : {}) })));
  } catch (err) {
    console.error('[push] data push failed:', err.message);
    return 0;
  }
}

// To Expo, 100 at a time: how many it accepted. Tokens it says are gone are
// taken off.
async function deliver(messages) {
  if (sentLog) sentLog.push(...messages);
  let accepted = 0;
  const dead = [];
  for (let i = 0; i < messages.length; i += CHUNK) {
    const batch = messages.slice(i, i + CHUNK);
    const tickets = await transport(batch);
    tickets.forEach((ticket, n) => {
      if (ticket && ticket.status === 'ok') accepted += 1;
      else if (ticket?.details?.error === 'DeviceNotRegistered') dead.push(batch[n].to);
      else if (ticket && ticket.status === 'error') console.warn('[push] ticket error:', ticket.message);
    });
  }
  await removeTokens(dead);
  return accepted;
}

/** Fire and forget: for request handlers that must not wait on Expo. */
function notify(userIds, note) {
  sendToUsers(userIds, note).catch(() => {});
}

// ---------- the moments that send a push ----------

// The person behind a notification, for the in-app banner's picture.
function actorPreview(user) {
  if (!user) return null;
  const p = user.profile || {};
  return {
    id: String(user._id || user.id || ''),
    username: p.username || user.username || null,
    name: p.displayName || [p.firstName, p.lastName].filter(Boolean).join(' ') || p.username || user.name || null,
    avatarKey: p.avatarKey || user.avatarKey || null,
    avatarPhotoUrl: p.avatarPhotoUrl || user.avatarPhotoUrl || null,
  };
}

function displayName(user) {
  const p = user?.profile || {};
  // A user document, or a preview ({ username, name }) as calls carry.
  return p.username || p.displayName || p.firstName || user?.username || user?.name || 'Someone';
}

function messagePreview(message) {
  if (message.content) return message.content;
  const kind = message.kind || message.media?.kind;
  return {
    image: 'Sent a photo',
    video: 'Sent a video',
    audio: 'Sent a voice note',
    document: 'Sent a file',
    poll: 'Sent a poll',
  }[kind] || 'Sent a message';
}

// Message and mention pushes carry the Reply and Mark as read buttons: the
// app registers them as the notification category 'message'
// (setNotificationCategoryAsync), and they call POST
// /api/chats/:chatId/messages and PATCH /api/chats/:chatId/read with the
// app's own session. A build that hasn't registered it shows the plain
// notification.
const MESSAGE_ACTIONS = 'message';

/**
 * A new chat message: the other person in a DM, or the members of a
 * user-made group who have not muted it. Community and faction rooms are too
 * big for a push per message; @mentions there still push (notifyMention).
 */
function notifyNewMessage({ conversation, message, sender, recipientIds, groupName }) {
  const name = displayName(sender);
  const isGroup = conversation.type === 'group';
  notify(recipientIds, {
    title: isGroup ? groupName || 'Group' : name,
    body: isGroup ? `${name}: ${messagePreview(message)}` : messagePreview(message),
    data: { type: 'message', chatId: String(conversation._id), messageId: String(message._id) },
    channel: 'messages',
    categoryId: MESSAGE_ACTIONS,
    skipOnline: true,
    collapseId: `chat-${conversation._id}`,
    actor: actorPreview(sender),
  });
}

// People and their posts (follows, likes, comments, reposts, new posts by
// people you follow): the Friend activity switch in notification settings.
const SOCIAL_TYPES = ['follow', 'like', 'comment', 'repost', 'post'];

/** In-app notifications (mention, group, follows and post activity) mirrored as a push. */
function notifyFromNotification(userIds, { type, message, conversation, chatMessage, post, comment, actor }) {
  if (!['mention', 'group', ...SOCIAL_TYPES].includes(type)) return;
  const inChat = type === 'mention' && conversation;
  notify(userIds, {
    body: message,
    data: {
      type,
      ...(conversation ? { chatId: String(conversation) } : {}),
      ...(inChat && chatMessage ? { messageId: String(chatMessage) } : {}),
      ...(post ? { postId: String(post) } : {}),
      ...(comment ? { commentId: String(comment) } : {}),
    },
    channel: type === 'mention' ? 'messages' : 'default',
    ...(inChat ? { categoryId: MESSAGE_ACTIONS } : {}),
    category: SOCIAL_TYPES.includes(type) ? 'friendActivity' : undefined,
    skipOnline: true,
    ...(post ? { collapseId: `${type}-${post}` } : {}),
    actor: actorPreview(actor),
  });
}

/**
 * A call ringing, for a minute (callPush.RING_SECONDS): a call nobody
 * answers by then is missed.
 *
 * Each phone rings one way:
 *   - a call token (expo-callkit-telecom): its own call screen, like a phone
 *     call (callPush.js);
 *   - otherwise, an Android phone registered with dataCalls: a data-only
 *     push, call_incoming, from which the app shows its own ringing
 *     notification with Answer and Decline (ringsItself);
 *   - every other phone, and any the first way couldn't reach: the ringtone
 *     push, again every CALL_REPEAT_MS on iPhones while still ringing.
 * When someone's ring is over, callRingEnded tells their phones.
 *
 * Always a push, even to people who look online. "Online" means a socket is
 * open, and a phone that was just locked or put in the background keeps its
 * socket for a while (Socket.IO notices a dead one only after ~45 s, most of
 * the ring; Android often keeps a live one longer). Skipping them left
 * calls silent: the app in the background can't ring from the socket's
 * call:incoming. With the app open, the app shows its own call screen from
 * call:incoming and leaves this push unshown (data.type 'call').
 */
function notifyIncomingCall(userIds, { call, caller }) {
  ringPhones(userIds, { call, caller }).catch((err) => console.error('[push] call ring failed:', err.message));
}

// Who was rung, per call (Redis, so whichever server instance sees the ring
// end can tell their phones), until their ring is over.
const rungKey = (callId) => `call:rung:${callId}`;
const OVER = ['declined', 'missed', 'cancelled', 'ended'];
const PROFILE_FIELDS = 'profile.username profile.displayName profile.firstName profile.lastName profile.avatarKey profile.avatarPhotoUrl';

// Android phones whose app shows its own ringing notification from a
// data-only push (registered with dataCalls). iPhones can't ring that way:
// iOS holds back data-only pushes; they need CallKit (callPush.js).
function ringsItself(phone) {
  return phone?.platform === 'android' && phone.dataCalls === true;
}

// The call, for the app's own notification. `call` is the call's JSON
// (ringing) or the call document (callRingEnded); `caller` whoever rang
// this person (a user, or the preview calls carry).
function callDetails(call, caller) {
  const chatId = call.conversationId || call.conversation?._id || call.conversation;
  return {
    callId: String(call.id || call._id),
    chatId: chatId ? String(chatId) : null,
    callType: call.type === 'video' ? 'video' : 'audio',
    isGroup: Boolean(call.isGroup),
    caller: actorPreview(caller),
  };
}

async function rememberRung(callId, userIds) {
  try {
    const key = rungKey(callId);
    await require('../config/redis').getRedisClient().multi().sadd(key, ...new Set(userIds)).expire(key, require('./callPush').RING_SECONDS * 2).exec();
  } catch (err) {
    // The ring still goes out; only its end can't be told.
    console.warn('[push] could not note who was rung:', err.message);
  }
}

async function ringPhones(userIds, { call, caller }) {
  const ids = [...new Set((userIds || []).map(String))].filter(Boolean);
  const callId = String(call?.id || call?._id || '');
  if (!ids.length || !callId || !enabled()) return;
  const callPush = require('./callPush');
  const phones = await recipients(ids, {});
  if (!phones.length) return;
  // Before ringing: a caller who hangs up at once is then still told.
  await rememberRung(callId, phones.map((phone) => phone.userId));

  const own = await callPush.ring(phones.filter((phone) => callPush.canRing(phone)), { call, caller });
  const notOwn = (phone) => !own.has(phone.token);
  const selfRinging = phones.filter((phone) => notOwn(phone) && ringsItself(phone));
  if (selfRinging.length) {
    await sendData(selfRinging, {
      type: 'call_incoming',
      ...callDetails(call, caller),
      // The app stops ringing by itself then, even if call_missed is late.
      expiresAt: new Date(Date.now() + callPush.RING_SECONDS * 1000).toISOString(),
    }, { ttl: callPush.RING_SECONDS });
  }

  const pushed = phones.filter((phone) => notOwn(phone) && !ringsItself(phone));
  if (!pushed.length) return;
  const video = call?.type === 'video';
  const note = {
    title: displayName(caller),
    body: video ? 'Incoming video call' : 'Incoming call',
    data: { type: 'call', callId, ...(call?.conversationId ? { chatId: String(call.conversationId) } : {}) },
    channel: 'calls',
    skipOnline: false,
    ttl: callPush.RING_SECONDS,
    // Rings (the ringtone, not the short notification sound), and on iPhones
    // breaks through Focus like a phone call (the app needs the
    // time-sensitive notifications entitlement; without it, a normal alert).
    sound: CALL_SOUND,
    interruptionLevel: 'time-sensitive',
    collapseId: `call-${callId}`,
    actor: actorPreview(caller),
  };
  await sendToUsers(ids, { ...note, filter: (phone) => notOwn(phone) && !ringsItself(phone) });
  const iphones = new Set(pushed.filter((phone) => phone.platform === 'ios').map((phone) => phone.token));
  if (iphones.size) scheduleRingAgain(callId, note, iphones, CALL_REPEAT_MS());
}

// iPhones play a push's sound for at most 30 s: while they're still ringing,
// the ringtone push again, until the minute is up.
function scheduleRingAgain(callId, note, iphones, after) {
  const ringMs = require('./callPush').RING_SECONDS * 1000;
  if (after > ringMs - 5000) return;
  const timer = setTimeout(() => {
    ringAgain(callId, note, iphones, after, ringMs).catch((err) => console.error('[push] call ring failed:', err.message));
  }, after);
  timer.unref?.();
}

async function ringAgain(callId, note, iphones, after, ringMs) {
  if (!enabled()) return;
  const call = await require('../models/Call').findById(callId, 'status members.user members.status').lean();
  if (!call || OVER.includes(call.status)) return;
  const ringing = (call.members || []).filter((member) => member.status === 'ringing').map((member) => String(member.user));
  if (!ringing.length) return;
  const ttl = Math.max(1, Math.floor((ringMs - after) / 1000));
  await sendToUsers(ringing, { ...note, ttl, filter: (phone) => iphones.has(phone.token) });
  scheduleRingAgain(callId, note, iphones, after + CALL_REPEAT_MS());
}

/**
 * A call changed (callController's call:updated): once a person's ring is
 * over (answered or declined, maybe on another phone; missed; or the call
 * cancelled or over), each of their phones is told once (ringOutcome.js):
 *   - on its own call screen (Android): "call ended", except after they
 *     answered, since that would hang up the phone in the call (another
 *     phone of theirs rings on until the minute is up). iPhones stop from
 *     the app, which hears call:updated;
 *   - ringing itself: call_ended { reason } (stop ringing; never a hang-up),
 *     or call_missed with the caller, and the app shows "Missed call";
 *   - every other phone, when missed: a "Missed call" notification.
 */
async function callRingEnded(call) {
  const callId = String(call?.id || call?._id || '');
  if (!callId) return;
  const redis = require('../config/redis').getRedisClient();
  const rung = await redis.smembers(rungKey(callId));
  if (!rung.length) return;
  const over = OVER.includes(call.status);
  const memberOf = new Map((call.members || []).map((member) => [String(member.user?._id || member.user?.id || member.user), member]));
  for (const userId of rung) {
    const member = memberOf.get(userId);
    if (!over && member?.status === 'ringing') continue;
    if (!(await redis.srem(rungKey(callId), userId))) continue; // another instance told them
    const outcome = ringOutcome(member?.status, call.status);
    const phones = await recipients([userId], {});
    if (outcome.native) await require('./callPush').ringEnded(phones, { callId, reason: outcome.native });
    // Whoever rang them: the person who added them to the call, or the caller.
    const caller = outcome.missed ? await User.findById(member?.invitedBy || call.caller?._id || call.caller, PROFILE_FIELDS).lean() : null;
    const selfRinging = phones.filter(ringsItself);
    if (selfRinging.length && outcome.missed) await sendData(selfRinging, { type: 'call_missed', ...callDetails(call, caller) });
    else if (selfRinging.length) await sendData(selfRinging, { type: 'call_ended', callId, reason: outcome.reason }, { ttl: require('./callPush').RING_SECONDS });
    if (outcome.missed) await notifyMissedCall(userId, call, caller);
  }
}

// WhatsApp's "Missed voice call": to their phones that don't ring
// themselves (those show their own, from call_missed). On iPhones it takes
// the ringtone notification's place (same collapseId). App on screen: the
// in-app banner.
function notifyMissedCall(userId, call, caller) {
  const details = callDetails(call, caller);
  return sendToUsers([userId], {
    title: displayName(caller),
    body: details.callType === 'video' ? 'Missed video call' : 'Missed voice call',
    data: { type: 'missed_call', callId: details.callId, ...(details.chatId ? { chatId: details.chatId } : {}) },
    channel: 'default',
    skipOnline: true,
    collapseId: `call-${details.callId}`,
    actor: details.caller,
    filter: (phone) => !ringsItself(phone),
  });
}

// ---------- tests ----------

/** Tests: capture instead of sending. Returns the array messages land in. */
function captureForTests(fakeTransport) {
  sentLog = [];
  transport = fakeTransport || (async (batch) => batch.map(() => ({ status: 'ok', id: 'test' })));
  return sentLog;
}

function resetForTests() {
  sentLog = null;
  transport = defaultTransport;
}

/** Tests (merged-app checks): swap the transport; null puts the real one back. */
function setTransport(fn) {
  transport = fn || defaultTransport;
}

module.exports = {
  sendToUsers,
  sendData,
  notify,
  notifyNewMessage,
  notifyFromNotification,
  notifyIncomingCall,
  callRingEnded,
  ringsItself,
  isExpoToken,
  enabled,
  setTransport,
  actorPreview,
  CATEGORIES,
  captureForTests,
  resetForTests,
};
