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
| Call ringing | the people rung | push lives 45 s |
| Game event | the user ids the game sends | the `category` switch is off |

Always skipped: `preferences.notificationsEnabled` off, and any device row left over from before registration required a session (`authed: false`). Messages, mentions, post activity and scheduled calls skip users with the app **on screen** (they get the in-app `banner` socket event instead); calls and game events always push.

## App on screen (`app:state`)

A connected socket doesn't mean the app is on screen: a phone that was just locked or switched away keeps its socket for a while (Socket.IO notices a dead one only after ~45 s; Android often keeps a live one much longer). Skipping the push then loses the notification, because a banner can't show in the background. So the app tells the server:

- `socket.emit('app:state', { active: false })` when `AppState` changes to `background` or `inactive`, and `{ active: true }` when it comes back to `active`;
- `active` in the handshake, as a function so every reconnect reads it afresh (a plain `auth` object is reused as it was): `io(url, { auth: (cb) => cb({ token, active: AppState.currentState === 'active' }) })`.

A socket that never says counts as on screen while connected (how older app builds behave). The server asks every instance's live sockets (`foregroundAmong` in `src/realtime/socket.js`), so nothing is stored that could go stale.

Calls always push, even with the app open: the app shows its own call screen from `call:incoming`, so its notification handler should leave pushes with `data.type === 'call'` unshown while the app is active.

## Devices

- `POST /api/users/me/devices { pushToken, platform }` (Bearer only). The token is taken off any other account first (one phone, one signed-in account) and marked `authed`. Requests without a valid session get `401` and store nothing.
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
