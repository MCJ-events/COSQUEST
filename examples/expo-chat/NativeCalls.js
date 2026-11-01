import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Calls from 'expo-callkit-telecom';

// Calls that ring like a phone call: CallKit on iPhones (the full-screen call
// screen, on the lock screen too), the system call screen on Android.
// expo-callkit-telecom shows the call from the backend's push before the
// app's JavaScript even starts; this file connects it to CosQuest:
//   - the phone's call token goes to the backend with its push token;
//   - Answer: POST /api/calls/:id/accept, join LiveKit, then tell the call
//     screen the call is connected;
//   - Decline (or hang up) on the call screen: POST /api/calls/:id/decline
//     (or /end);
//   - the ring is over elsewhere (answered on another phone, the caller hung
//     up, missed after a minute): the call screen closes. Android also gets
//     this from the backend's push while the app isn't running.
//
// Setup (native: a new build with eas build):
//   npx expo install expo-callkit-telecom
//   app.json "plugins": ["expo-callkit-telecom", {
//     "sounds": ["./assets/sounds/ringtone.wav", "./assets/sounds/ringtone_long.wav"],
//     "defaultRingtoneIos": "ringtone.wav", "defaultRingtoneAndroid": "ringtone_long.wav",
//     "incomingCallTimeout": 65, "supportsVideo": true,
//     "microphonePermission": "$(PRODUCT_NAME) needs the microphone for calls." }]
//   (65: a little over the backend's minute, so the backend says "missed"
//   first and the call isn't recorded as declined.)
//   Android: google-services.json from Firebase ("android": { "googleServicesFile" }).
//   iOS: push notifications, and the voip background mode (the plugin adds it).
// The backend needs its keys (APNS_* and FCM_SERVICE_ACCOUNT, PUSH.md). Until
// they're set, the device registration answers callRinging 'push' and calls
// ring with the ringtone push (CallRinging.js) as before.
//
// Written against expo-callkit-telecom's documented API; check it against the
// installed version.

// 1. Once, at startup (module scope, in the file the app starts from).
export function setUpNativeCalls() {
  Calls.registerVoIPPush();
}

// 2. Sends the phone's call token with its push token, and returns how its
//    calls ring ('native' or 'push', from the backend): pass
//    ringInApp: callRinging !== 'native' to useCallRinging.
//    register(body): the app's POST /api/users/me/devices, resolving to its JSON.
export function useNativeCallToken({ pushToken, register }) {
  const voip = Calls.useVoIPPushToken();
  const [callRinging, setCallRinging] = useState('push');
  const send = useRef(register);
  send.current = register;
  useEffect(() => {
    if (!pushToken) return;
    const voipToken = voip?.token || null;
    send.current({ pushToken, platform: Platform.OS, voipToken, voipType: voipToken ? voip.type : null })
      .then((answer) => setCallRinging(answer?.callRinging === 'native' ? 'native' : 'push'))
      .catch(() => {});
  }, [pushToken, voip?.token, voip?.type]);
  return callRinging;
}

const OVER = ['declined', 'missed', 'cancelled', 'ended'];

// 3. The call screen and CosQuest, together. Mount once, high up, while
//    signed in:
//      const { endNativeCall } = useNativeCalls({ socket, userId: me.id, api, joinCall });
//    api(method, path): the app's fetch with its Bearer token, resolving to the JSON.
//    joinCall(answer): connects the app's LiveKit call screen with the accept
//    answer ({ call, token, livekitUrl, ... }), the same as answering in the
//    app; resolves once connected.
//    endNativeCall(callId): call it when the person hangs up in the app, so
//    the system call screen closes too.
export function useNativeCalls({ socket, userId, api, joinCall }) {
  const latest = useRef({ api, joinCall, userId });
  latest.current = { api, joinCall, userId };
  const sessions = useRef(new Map()); // our call id -> the call screen's session id
  const endedHere = useRef(new Set()); // sessions this app closed (nothing to tell the backend)
  const answeredHere = useRef(new Set()); // our call ids answered on this phone

  useEffect(() => {
    const serverId = (session) => session?.incomingCallEvent?.serverCallId;
    const remember = (event) => {
      const session = event?.session || event;
      if (session?.id && serverId(session)) sessions.current.set(serverId(session), session.id);
    };
    const callIdOf = (sessionId, session) => serverId(session) || [...sessions.current].find(([, id]) => id === sessionId)?.[0];
    const active = Calls.getActiveCallSession?.();
    if (active) remember(active);

    // The call screen closes (the ring is over elsewhere, or the call ended).
    const close = (callId, reason) => {
      const sessionId = sessions.current.get(callId);
      if (!sessionId) return;
      endedHere.current.add(sessionId);
      Calls.reportCallEnded(sessionId, reason).catch(() => {});
    };
    const onUpdated = ({ call }) => {
      if (!call || !sessions.current.has(call.id)) return;
      const mine = call.members?.find((member) => member.user?.id === String(latest.current.userId));
      if (OVER.includes(call.status)) {
        close(call.id, call.status === 'missed' ? 'unanswered' : 'remoteEnded');
      } else if (mine?.status === 'declined') {
        close(call.id, 'declinedElsewhere');
      } else if (mine?.status === 'missed' || mine?.status === 'left' || !mine) {
        close(call.id, 'remoteEnded');
      } else if (mine.status === 'joined' && !answeredHere.current.has(call.id)) {
        close(call.id, 'answeredElsewhere');
      }
    };
    const onRemoved = ({ callId }) => close(callId, 'remoteEnded');

    const subscriptions = [
      Calls.addCallSessionAddedListener?.(remember),
      Calls.addCallSessionUpdatedListener?.(remember),
      Calls.addCallAnsweredListener(async ({ id, requestId }) => {
        const callId = callIdOf(id, Calls.getActiveCallSession?.());
        if (!callId) return Calls.failIncomingCallConnected(id, requestId).catch(() => {});
        answeredHere.current.add(callId);
        try {
          const answer = await latest.current.api('POST', `/api/calls/${callId}/accept`);
          await latest.current.joinCall(answer);
          await Calls.fulfillIncomingCallConnected(requestId);
        } catch {
          await Calls.failIncomingCallConnected(id, requestId).catch(() => {});
        }
        return undefined;
      }),
      Calls.addCallEndedListener(({ id, session }) => {
        const callId = callIdOf(id, session);
        if (callId) {
          sessions.current.delete(callId);
          answeredHere.current.delete(callId);
        }
        if (endedHere.current.delete(id) || !callId) return;
        // Ended on the call screen: declined while ringing, or hung up.
        latest.current.api('POST', `/api/calls/${callId}/${session?.connectedAt ? 'end' : 'decline'}`).catch(() => {});
      }),
    ].filter(Boolean);

    socket?.on('call:updated', onUpdated);
    socket?.on('call:removed', onRemoved);
    // A ringing call screen while the socket may be asleep (an iPhone app
    // woken in the background): check the call every 5 s.
    const poll = setInterval(() => {
      for (const callId of sessions.current.keys()) {
        if (answeredHere.current.has(callId)) continue;
        latest.current.api('GET', `/api/calls/${callId}`).then(onUpdated).catch(() => {});
      }
    }, 5000);

    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
      socket?.off('call:updated', onUpdated);
      socket?.off('call:removed', onRemoved);
      clearInterval(poll);
    };
  }, [socket]);

  return {
    endNativeCall(callId) {
      const sessionId = sessions.current.get(callId);
      if (!sessionId) return;
      endedHere.current.add(sessionId);
      Calls.endCall(sessionId).catch(() => {});
    },
  };
}
