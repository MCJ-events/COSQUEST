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

const EXPO_PUSH_URL = () => process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';
const CHUNK = 100;
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]]{1,200}\]$/;
const CATEGORIES = ['eventReminders', 'questUpdates', 'factionNews', 'friendActivity', 'rankChanges'];

/** Android notification channels, created by the app (components/PushRegistration.tsx). */
const CHANNELS = ['default', 'messages', 'calls', 'game', 'alerts'];

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

/** The phones that should hear about this, as [{ userId, token }]. */
async function recipients(ids, { category }) {
  if (!ids.length) return [];
  const filter = { _id: { $in: ids }, 'preferences.notificationsEnabled': true, 'devices.0': { $exists: true } };
  if (category && CATEGORIES.includes(category)) filter[`notificationCategories.${category}`] = { $ne: false };
  const users = await User.find(filter, 'devices').lean();
  const out = [];
  for (const user of users) {
    const userId = String(user._id);
    for (const device of user.devices || []) {
      if (device.authed && isExpoToken(device.pushToken)) out.push({ userId, token: device.pushToken });
    }
  }
  return out;
}

// People with the app on screen right now (src/realtime/socket.js
// foregroundAmong): not merely connected, since a locked phone keeps its
// socket for a while and a push skipped then is a notification lost. If it
// can't be answered, nobody counts as on screen: a push too many beats one
// missed.
async function onScreenAmong(ids) {
  try {
    return await require('../realtime/socket').foregroundAmong(ids);
  } catch (err) {
    console.warn('[push] could not check who has the app open:', err.message);
    return new Set();
  }
}

// The in-app version of a push, for people with the app open: socket event
// `banner` { id, title, body, data, channel, actor, at }. Same rules as the
// push about the kind of notification (a category switched off in settings
// means no banner either); it does not need push permission or a device.
async function bannerTo(ids, note) {
  let to = ids;
  if (note.category && CATEGORIES.includes(note.category)) {
    const off = await User.find({ _id: { $in: ids }, [`notificationCategories.${note.category}`]: false }, '_id').lean();
    const muted = new Set(off.map((user) => String(user._id)));
    to = ids.filter((id) => !muted.has(id));
  }
  if (!to.length) return;
  const { emitToUsers } = require('../realtime/socket');
  emitToUsers(to, 'banner', {
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
 *           collapseId?: string,
 *           actor?: object }} note  (actor: { id, username, name, avatarKey,
 *           avatarPhotoUrl } - for the in-app banner's picture only)
 */
async function sendToUsers(userIds, note) {
  try {
    if (!note || !note.body) return 0;
    let ids = [...new Set((userIds || []).map(String))].filter(Boolean);
    if (note.skipOnline && ids.length) {
      const online = await onScreenAmong(ids);
      if (online.size) {
        // noBanner: the caller sent online users its own socket event.
        if (!note.noBanner) await bannerTo([...online], note);
        ids = ids.filter((id) => !online.has(id));
      }
    }
    if (!enabled()) return 0;
    const phones = await recipients(ids, note);
    if (!phones.length) return 0;
    const channelId = CHANNELS.includes(note.channel) ? note.channel : 'default';
    const messages = phones.map(({ token }) => ({
      to: token,
      ...(note.title ? { title: clip(note.title, 80) } : {}),
      body: clip(note.body, 180),
      data: note.data || {},
      sound: 'default',
      channelId,
      // Every notification goes out at high priority, so phones in battery
      // saving (Android doze) still show it at once.
      priority: 'high',
      ...(note.ttl ? { ttl: note.ttl } : {}),
      ...(note.collapseId ? { collapseId: note.collapseId } : {}),
    }));
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
  } catch (err) {
    console.error('[push] send failed:', err.message);
    return 0;
  }
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
    skipOnline: true,
    collapseId: `chat-${conversation._id}`,
    actor: actorPreview(sender),
  });
}

// People and their posts (follows, likes, comments, reposts, new posts by
// people you follow): the Friend activity switch in notification settings.
const SOCIAL_TYPES = ['follow', 'like', 'comment', 'repost', 'post'];

/** In-app notifications (mention, group, follows and post activity) mirrored as a push. */
function notifyFromNotification(userIds, { type, message, conversation, post, comment, actor }) {
  if (!['mention', 'group', ...SOCIAL_TYPES].includes(type)) return;
  notify(userIds, {
    body: message,
    data: {
      type,
      ...(conversation ? { chatId: String(conversation) } : {}),
      ...(post ? { postId: String(post) } : {}),
      ...(comment ? { commentId: String(comment) } : {}),
    },
    channel: type === 'mention' ? 'messages' : 'default',
    category: SOCIAL_TYPES.includes(type) ? 'friendActivity' : undefined,
    skipOnline: true,
    ...(post ? { collapseId: `${type}-${post}` } : {}),
    actor: actorPreview(actor),
  });
}

/**
 * A call ringing. Short-lived: a call nobody answers in 45 s is over.
 *
 * Always a push, even to people who look online. "Online" means a socket is
 * open, and a phone that was just locked or put in the background keeps its
 * socket for a while (Socket.IO notices a dead one only after ~45 s, the
 * whole ring; Android often keeps a live one longer). Skipping them left
 * calls silent: the app in the background can't ring from the socket's
 * call:incoming. With the app open, the app shows its own call screen from
 * call:incoming and leaves this push unshown (data.type 'call').
 */
function notifyIncomingCall(userIds, { call, caller }) {
  const video = call?.type === 'video';
  notify(userIds, {
    title: displayName(caller),
    body: video ? 'Incoming video call' : 'Incoming call',
    data: { type: 'call', callId: String(call?.id || call?._id || ''), ...(call?.conversationId ? { chatId: String(call.conversationId) } : {}) },
    channel: 'calls',
    skipOnline: false,
    ttl: 45,
    priority: 'high',
    actor: actorPreview(caller),
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

module.exports = {
  sendToUsers,
  notify,
  notifyNewMessage,
  notifyFromNotification,
  notifyIncomingCall,
  isExpoToken,
  actorPreview,
  CATEGORIES,
  captureForTests,
  resetForTests,
};
