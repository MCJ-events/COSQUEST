# Push notifications

Phones get a push for a new DM or group message, an @mention, a follow, a group admin notice, a ringing call, and game events the CostQuest game server forwards (raids, gifts, friends).

## How it works

- **The app** gets an Expo push token (`expo-notifications`, `getExpoPushTokenAsync`) once the user is signed in and has allowed notifications. It sends the token to `POST /api/users/me/devices` with its Bearer session.
- **This server** stores the token on the user (`user.devices`) and sends through Expo's push service (`src/utils/push.js`). Expo delivers through APNs and FCM with the credentials stored on the app's Expo project, so this server holds no Apple or Google key.
- **The game server** calls `POST /api/internal/push` with a shared secret and chat user ids. The game knows a player's chat account through one login (`sso_players.subject`). Tokens and notification switches stay here.

## Who gets a push

| Moment | Who | Skipped when |
|---|---|---|
| New message | the other person in a DM; members of a user-made group | muted chat, blocked either way, @mentioned (the mention push covers it), `@everyone` (sent as mentions), community and faction rooms |
| @mention, follow, group notice | the people the in-app notification goes to | follow: `notificationCategories.friendActivity` off |
| Call ringing | the people rung | rings for a minute: the phone's own call screen, or the ringtone push (see Ringing below) |
| Game event | the user ids the game sends | the `category` switch is off |

Always skipped: `preferences.notificationsEnabled` off, and any device row left over from before registration required a session (`authed: false`). Messages, mentions, post activity and scheduled calls skip users with the app **on screen** (they get the in-app `banner` socket event instead); calls and game events always push.

## App on screen (`app:state`)

A connected socket doesn't mean the app is on screen: a phone that was just locked or switched away keeps its socket for a while (Socket.IO notices a dead one only after ~45 s; Android often keeps a live one much longer). Skipping the push then loses the notification, because a banner can't show in the background. So the app tells the server:

- `socket.emit('app:state', { active: false })` when `AppState` changes to `background` or `inactive`, and `{ active: true }` when it comes back to `active`;
- `active` in the handshake, as a function so every reconnect reads it afresh (a plain `auth` object is reused as it was): `io(url, { auth: (cb) => cb({ token, active: AppState.currentState === 'active' }) })`.

A socket that never says counts as on screen while connected (how older app builds behave). The server asks every instance's live sockets (`foregroundAmong` in `src/realtime/socket.js`), so nothing is stored that could go stale.

Calls always push, even with the app open: the app shows its own call screen from `call:incoming`, so its notification handler should leave pushes with `data.type === 'call'` unshown while the app is active.

## Ringing

A call rings for **a minute**; anyone who hasn't answered by then has missed it (`RING_SECONDS` in `src/utils/callPush.js`). Each phone rings one of two ways.

### Like a phone call (the phone's own call screen)

Phones that registered a call token (`voipToken`, from expo-callkit-telecom in the app) ring with CallKit on iPhones and the system call screen on Android: full screen, on the lock screen too, for the whole minute, even with the app closed. This server sends the pushes itself, straight to Apple and Google (`src/utils/callPush.js`; Expo's push service can't carry them):

- **iPhone:** an APNs VoIP push (`apns-push-type: voip`, topic `<bundle id>.voip`, priority 10, expiring with the minute), body `{ incomingCall: { eventId, serverCallId, hasVideo, startedAt, caller: { id, displayName, avatarUrl? }, metadata: { chatId, isGroup, privateOf, username } } }`. `serverCallId` is the call's id.
- **Android:** an FCM data message (high priority, 60 s), data `{ messageType: 'incomingCall', incomingCall: '<the same event as JSON>' }`. When that person's ring is over (declined on another phone, missed, the caller hung up or the call ended) it gets `{ messageType: 'callEnded', callEnded: '{ eventId, serverCallId, reason }' }` so the call screen closes; not after they answer (it would hang up the phone in the call). iPhones close it from the app, which hears `call:updated`.
- A phone rung this way gets no ringtone push as well. If Apple or Google refuses, the call rings that phone with the ringtone push instead; a token they say is gone (APNs 410 / `BadDeviceToken`, FCM `UNREGISTERED`) is taken off.

| Variable | |
|---|---|
| `APNS_KEY_ID`, `APNS_TEAM_ID` | The APNs auth key (Apple Developer > Certificates, IDs & Profiles > Keys, with Apple Push Notifications service) and the team id. |
| `APNS_PRIVATE_KEY` | The `.p8` file's contents (newlines may be written `\n`). |
| `APNS_BUNDLE_ID` | The iOS app's bundle id. |
| `APNS_PRODUCTION` | `1` for TestFlight and App Store builds; otherwise the sandbox (development builds). A token from the other environment comes back `BadDeviceToken`. |
| `FCM_SERVICE_ACCOUNT` | The Firebase service account (Project settings > Service accounts > Generate new private key): the JSON itself, or the path to the file (on Render, a secret file such as `/etc/secrets/fcm.json`). |

Each side stays off until its variables are set. Until then the device registration answers `callRinging: 'push'` and calls ring the second way. Never commit the `.p8` or the service account file.

### With the ringtone push

Every other phone: a push with `sound: 'ringtone.wav'`, `interruptionLevel: 'time-sensitive'`, on the `calls` channel, living for the minute.

- **iPhone:** plays `ringtone.wav` (29 s; iOS plays at most 30 s), bundled with the `expo-notifications` config plugin (`sounds`); the push goes again every 30 s (`CALL_PUSH_REPEAT_MS`) while that person is still ringing. The time-sensitive notifications entitlement lets it ring through Focus. Without the file, iOS plays its short default sound.
- **Android:** the sound comes from the `calls` channel, so the app creates `calls` with `ringtone_long.wav` (60 s) and `MAX` importance. Android fixes a channel's sound when the channel is first created: a phone that already has `calls` keeps its old sound until the app is reinstalled.
- **App open:** the app rings itself from `call:incoming` until `call:updated` shows the call answered, declined, missed or over.

Ready-made code, the setup and free ringtones: `examples/expo-chat/NativeCalls.js`, `examples/expo-chat/CallRinging.js`, `examples/expo-chat/assets/sounds/`, and "Ringing calls" in `examples/expo-chat/README.md`.

## Devices

- `POST /api/users/me/devices { pushToken, platform, voipToken?, voipType? }` (Bearer only). The token is taken off any other account first (one phone, one signed-in account) and marked `authed`. Requests without a valid session get `401` and store nothing. `voipToken` / `voipType` (`APNS_VOIP` | `FCM`): the call token from expo-callkit-telecom, sent together; `voipToken: null` takes it off. The answer has `callRinging`: `native` (this phone's calls ring on its own call screen, so the app shouldn't ring itself too) or `push`.
- `DELETE /api/users/me/devices/:pushToken` (or `DELETE /api/users/me/devices { pushToken }`), Bearer only: the app calls it on sign-out.
- Every push goes out at high priority, so a phone in battery saving still shows it at once.
- Tokens Expo reports as `DeviceNotRegistered` are removed.

## Taps

Every push carries `data.type`. Message, mention and call pushes carry `data.chatId` (the app opens that chat). Game pushes carry `data.url`, a `cosquest://play?...` link (the app opens the game there).

Android channels: `messages`, `calls`, `game`, `default` (the app creates them).

## Configuration

| Variable | |
|---|---|
| `PUSH_ENABLED` | `0` stops sending. Off under `NODE_ENV=test` unless `1`. |
| `EXPO_ACCESS_TOKEN` | Only if the Expo project turns on enhanced push security. |
| `GAME_PUSH_SECRET` | Shared with the game server's `CQ_CHAT_PUSH_SECRET`. Unset, `/api/internal/push` returns 404. |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`, `APNS_PRODUCTION`, `FCM_SERVICE_ACCOUNT` | Calls ringing like a phone call (see Ringing). |
| `CALL_PUSH_REPEAT_MS` | How often the ringtone push goes again to iPhones still ringing. Default 30000. |

## Account steps (once per app id)

Expo can only deliver what the Expo project has keys for:

1. **iOS:** an APNs key (.p8) from the Apple Developer account that signs the app (Keys, Apple Push Notifications service). Upload it with `eas credentials` (iOS, Push Notifications) for the bundle id.
2. **Android:** a Firebase project with an Android app for the package name. Its `google-services.json` goes in the app build (`expo.android.googleServicesFile`); a service account key (Firebase console, Project settings, Service accounts, Generate new private key) goes to `eas credentials` (Android, FCM V1).

## Try it

```sh
curl -s https://exp.host/--/api/v2/push/send -H 'Content-Type: application/json' \
  -d '{"to":"ExponentPushToken[...]","title":"Test","body":"Hello"}'
```

`npm test` runs `test/push.js` (Expo replaced by a capture).
