import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useAudioPlayer } from 'expo-audio';

// Incoming calls ring for a minute, with the app open or not.
//
// Phones set up for the phone's own call screen (NativeCalls.js) ring like a
// phone call, from the system; pass ringInApp: false for them (the device
// registration's callRinging is 'native'). Every other phone:
//
// App closed, in the background or locked: the backend's call push rings.
//   - iPhone: the push names `ringtone.wav` (29 s; iOS plays at most 30 s),
//     so the app bundles it (app.json below), and the backend sends it again
//     at 30 s while the call is still ringing. Without the file, iOS plays its
//     short default sound.
//   - Android: the `calls` channel's sound rings, so the app creates that
//     channel with `ringtone_long.wav` (60 s) (setUpCallChannel). Android
//     fixes a channel's sound when the channel is first created: a phone that
//     already has `calls` from an older build keeps the old sound until the
//     app is reinstalled.
// App open: the call push stays hidden (showPushesWhileOpen in
//   InAppNotifications.js) and the app rings itself from call:incoming until
//   the call is answered, declined, cancelled, missed or over
//   (useCallRinging). Sent to the background while ringing, it shows a
//   ringing notification instead.
//
// app.json (a native change: needs a new build, eas build, not eas update):
//   "plugins": [["expo-notifications", { "sounds": ["./assets/sounds/ringtone.wav", "./assets/sounds/ringtone_long.wav"] }]],
//   "ios": { "entitlements": { "com.apple.developer.usernotifications.time-sensitive": true } }
// assets/sounds/: the two next to this file, or your own with the same names
// (ringtone.wav under 30 s, ringtone_long.wav a minute).

const RING_MS = 60 * 1000; // the backend marks an unanswered call missed after a minute
const ENDED = ['declined', 'missed', 'cancelled', 'ended'];

// 1. Once at startup, where the app creates its other channels
//    (PushRegistration), in place of the old `calls` settings.
export async function setUpCallChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('calls', {
    name: 'Calls',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'ringtone_long.wav',
    vibrationPattern: [0, 1000, 1000, 1000, 1000, 1000],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    audioAttributes: {
      usage: Notifications.AndroidAudioUsage.NOTIFICATION_RINGTONE,
      contentType: Notifications.AndroidAudioContentType.SONIFICATION,
    },
  });
}

// 2. Rings while a call is ringing for this person, with the app open. Mount
//    once, high up:
//      const { ringingCall, startRinging, stopRinging } = useCallRinging({
//        socket, userId: me.id, ringtone: require('./assets/sounds/ringtone.wav') });
//    Show the ringing screen while ringingCall is set. Call stopRinging() on
//    answer or decline (call:updated stops it too), and startRinging(call)
//    with the call from GET /api/calls/incoming when the app opens on a call
//    that is still ringing (e.g. from a tapped call push). fetchIncoming
//    (optional): () => that GET's `call` (or null), to check on coming back
//    to the app that the call is still ringing (an iPhone app in the
//    background misses call:updated). ringInApp: false on a phone whose calls
//    ring on its own call screen (the system rings; the app mustn't as well).
export function useCallRinging({ socket, userId, ringtone, fetchIncoming, ringInApp = true }) {
  const player = useAudioPlayer(ringtone);
  const on = useRef(ringInApp);
  on.current = ringInApp;
  const check = useRef(fetchIncoming);
  check.current = fetchIncoming;
  const [ringingCall, setRingingCall] = useState(null);
  const current = useRef(null);
  const timer = useRef(null);

  const quiet = useCallback(() => {
    Vibration.cancel();
    try { player.pause(); } catch { /* released */ }
  }, [player]);

  const loud = useCallback(() => {
    try {
      player.loop = true;
      player.seekTo(0).catch(() => {});
      player.play();
    } catch { /* released */ }
    Vibration.vibrate([0, 1000, 1000], true);
  }, [player]);

  const stopRinging = useCallback(() => {
    clearTimeout(timer.current);
    const call = current.current;
    current.current = null;
    setRingingCall(null);
    quiet();
    if (call) dismissCallNotifications(call.id);
  }, [quiet]);

  const startRinging = useCallback((call) => {
    if (!on.current || !call?.id || current.current?.id === call.id) return;
    clearTimeout(timer.current);
    current.current = call;
    setRingingCall(call);
    // In the background the call push rings; the app rings only on screen.
    if (AppState.currentState === 'active') loud();
    // Stop by itself when the ring is over, even if no update arrives.
    const mine = call.members?.find((member) => member.user?.id === String(userId));
    const since = Date.parse(mine?.invitedAt || call.createdAt) || Date.now();
    timer.current = setTimeout(stopRinging, Math.min(RING_MS, Math.max(3000, RING_MS - (Date.now() - since))));
  }, [userId, loud, stopRinging]);

  useEffect(() => {
    if (!socket) return undefined;
    const onIncoming = ({ call }) => startRinging(call);
    const onUpdated = ({ call }) => {
      if (!call || call.id !== current.current?.id) return;
      const mine = call.members?.find((member) => member.user?.id === String(userId));
      if (mine?.status !== 'ringing' || ENDED.includes(call.status)) stopRinging();
    };
    const onRemoved = ({ callId }) => {
      if (callId === current.current?.id) stopRinging();
    };
    socket.on('call:incoming', onIncoming);
    socket.on('call:updated', onUpdated);
    socket.on('call:removed', onRemoved);
    return () => {
      socket.off('call:incoming', onIncoming);
      socket.off('call:updated', onUpdated);
      socket.off('call:removed', onRemoved);
    };
  }, [socket, userId, startRinging, stopRinging]);

  // Sent to the background while ringing: a ringing notification instead
  // (the call push was hidden while the app was open). Back on screen: the
  // app rings again and the notification goes.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const call = current.current;
      if (!call) return;
      if (state === 'active') {
        dismissCallNotifications(call.id);
        loud();
        Promise.resolve(check.current?.())
          .then((still) => {
            if (check.current && still?.id !== call.id && current.current?.id === call.id) stopRinging();
          })
          .catch(() => {});
      } else if (state === 'background') {
        quiet();
        showRingingNotification(call);
      }
    });
    return () => subscription.remove();
  }, [loud, quiet, stopRinging]);

  useEffect(() => () => {
    clearTimeout(timer.current);
    Vibration.cancel();
  }, []);

  return { ringingCall, startRinging, stopRinging };
}

function showRingingNotification(call) {
  Notifications.scheduleNotificationAsync({
    content: {
      title: call.caller?.name || call.caller?.username || 'CosQuest',
      body: call.type === 'video' ? 'Incoming video call' : 'Incoming call',
      sound: 'ringtone.wav',
      interruptionLevel: 'timeSensitive',
      data: { type: 'call', callId: call.id, chatId: call.conversationId },
    },
    trigger: Platform.OS === 'android' ? { channelId: 'calls' } : null,
  }).catch(() => {});
}

// The call's notifications (the backend's push, or the one above) once it
// stops ringing, so an "Incoming call" doesn't linger.
async function dismissCallNotifications(callId) {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(shown
      .filter((n) => n.request.content.data?.type === 'call' && n.request.content.data?.callId === callId)
      .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)));
  } catch { /* nothing to dismiss */ }
}
