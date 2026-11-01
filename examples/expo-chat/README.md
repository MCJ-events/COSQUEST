# Expo chat integration

Projects, subject documents, linked Sparks and scheduled calls: see [PROJECTS_AND_SCHEDULING.md](../../PROJECTS_AND_SCHEDULING.md). `ProjectsAndCalls.js` supplies integration screens and `projectsCallsApi.js` supplies the API client.

These files are integration code for the existing iOS/Android Expo app. This folder is not a runnable Expo project; do not replace the app's package.json with the small module marker in this folder. The backend is implemented in `cosquest-backend`. See [CHAT_ATTACHMENTS_API.md](../../CHAT_ATTACHMENTS_API.md) for the API contract.

## Install in the mobile app

```sh
npx expo install expo-image-picker expo-document-picker expo-audio expo-file-system expo-image-manipulator
```

For video playback bubbles, add `npx expo install expo-video`. Use Expo-compatible versions for the app's SDK. These helpers use the current File API and expo-audio; an older SDK may need upgrading before copying them.

Merge the following permission configuration with the app's existing config (do not overwrite existing plugins), then rebuild the native app when plugin settings change:

```json
{
  "expo": {
    "plugins": [
      ["expo-image-picker", {
        "photosPermission": "Choose photos and videos to send in CosQuest chats.",
        "cameraPermission": "Take photos to send in CosQuest chats."
      }],
      ["expo-audio", {
        "microphonePermission": "Record voice notes in CosQuest chats.",
        "enableBackgroundRecording": false,
        "enableBackgroundPlayback": false
      }]
    ]
  }
}
```

Picker/camera behavior follows the official [ImagePicker documentation](https://docs.expo.dev/versions/latest/sdk/imagepicker/). Documents use [DocumentPicker](https://docs.expo.dev/versions/latest/sdk/document-picker/) with a cache copy, and uploads use [FileSystem with expo/fetch](https://docs.expo.dev/versions/latest/sdk/filesystem/). Photo conversion uses [ImageManipulator](https://docs.expo.dev/versions/latest/sdk/imagemanipulator/). Recording and playback use [expo-audio](https://docs.expo.dev/versions/latest/sdk/audio/); video playback uses [expo-video](https://docs.expo.dev/versions/latest/sdk/video/).

## Connect the client

Copy the `.js` files into the mobile app. Create a stable client that reads the current token from the app's existing session store:

```js
import { createChatApi } from './chat/chatApi.js';

const api = createChatApi({
  baseUrl: process.env.EXPO_PUBLIC_API_URL, // origin only; e.g. https://your-api-domain
  getToken: () => sessionStore.getState().token, // replace with your own session accessor
});
```

The server token is returned at signup/login. Do not put Cloudinary secrets in Expo public variables. On a physical device, use the backend's reachable LAN address or HTTPS deployment, not localhost.

## Attach button and preview

`AttachMenu.js` provides a basic modal with Photo, Video, Document, Camera, Audio, and Sticker choices. Its symbols can be replaced with your design's icon set. It returns a chosen asset without sending it. Connect `visible`, `onClose`, and `onSelected` to the composer's state:

```jsx
<AttachMenu
  visible={attachOpen}
  onClose={() => setAttachOpen(false)}
  onSelected={setPendingAttachment}
/>
```

Show a preview, caption field, Cancel and Send buttons. When the user confirms:

```js
async function sendPendingAttachment() {
  if (!pendingAttachment || sending) return;
  setSending(true);
  try {
    const { message } = await api.sendAttachment(conversationId, pendingAttachment, {
      kind: pendingAttachment.kind,
      content: caption,
      replyTo: replyingTo?.id,
    });
    appendMessage(message);
    setPendingAttachment(null);
  } catch (error) {
    Alert.alert('Could not send attachment', error.message);
  } finally {
    setSending(false);
  }
}
```

Alternatively call `pickAttachment('photo'|'video'|'document'|'camera'|'audio'|'sticker')` from your own existing sheet. Picker cancellation returns null. Documents/audio/stickers selected through the file picker are cached for upload. Unsupported HEIC/HEIF/unknown photo formats are converted to JPEG; GIF photos are left intact. Clear temporary files your app owns when the user discards them or after confirmed sending.

## Send a sticker

```js
import { pickAttachment } from './chat/attachmentPicker.js';

const sticker = await pickAttachment('sticker');
if (sticker) {
  // Invoke after the user confirms this sticker in your picker/preview.
  const { message } = await api.sendSticker(conversationId, sticker);
  appendMessage(message);
}
```

The sticker must be a local PNG, WEBP, or GIF, at most 1 MB. Render the returned `kind: 'sticker'` using its `media.url` with contain sizing and no ordinary text bubble. Supply your own sticker artwork/pack picker; no proprietary sticker assets are included. Bundled assets must be resolved to a local file URI before upload. Emoji reactions use their existing API instead.

## Record and send a voice note

Inside the composer component:

```js
import { useVoiceNote } from './chat/useVoiceNote.js';

const voice = useVoiceNote({ api, conversationId });

async function runVoiceAction(action) {
  try { await action(); }
  catch (error) { Alert.alert('Voice note', error.message); }
}

// Microphone button: () => runVoiceAction(voice.start)
// Stop button:       () => runVoiceAction(voice.stop)
// Discard button:    () => runVoiceAction(voice.discard)
// Disable these buttons while voice.busy is true.
// Show voice.durationSeconds and voice.isRecording while recording.

async function sendRecordedVoice() {
  await runVoiceAction(async () => {
    const result = await voice.send(replyingTo?.id);
    if (result) appendMessage(result.message);
  });
}
```

The hook requests microphone access, records an M4A file on iOS/Android, samples optional waveform levels, stops when the app leaves the foreground, and produces `voice.draft` for confirmation. `send` uploads it as `kind=audio`. The server returns the provider's duration and hosted URL. Failed sends retain the local draft; refresh the chat before retrying an uncertain network result to avoid duplicates. The hook guards simultaneous button presses and prevents sending a draft recorded in a different chat. Unmount the composer on navigation away so its recorder is released. Native microphone interruption/permission denial behavior still needs physical-device verification.

For playback, make a separate bubble component that calls `useAudioPlayer(message.media.url)` and `useAudioPlayerStatus(player)` from expo-audio. Toggle `player.play()`/`player.pause()` on press; use its playback state for progress and the stored waveform for the bars. A preview bubble can use `voice.draft.uri` as its audio source.

## Pin choices and bulk selection

```js
import { PIN_OPTIONS, pinIsActive } from './chat/pinOptions.js';

// Render PIN_OPTIONS in your bottom sheet: 24 hours, 7 days, 30 days.
await api.pin(conversationId, message.id, '24h');
await api.unpin(conversationId);

// Render the banner only while pinIsActive(chat.pinnedMessage).
// Re-evaluate on a timer at expiresAt and refresh chat data on focus/polling.

const deleted = await api.deleteSelected(conversationId, selectedMessageIds, 'me');
const forwarded = await api.forwardSelected(conversationId, selectedMessageIds, [
  { targetConversationId: selectedChatId },
  { targetUsername: selectedUsername },
]);

const failures = deleted.results.filter((result) => result.status >= 300);
// Update successful rows; retain failures and display their reasons.
```

Use a Set of selected message IDs from the current conversation; cap it at 50. After selecting Forward, show a recipient picker (up to 10). Each destination has exactly one of targetConversationId/targetUsername. Both bulk APIs return a results array and summary. HTTP 207 is not a promise rejection: inspect `summary.failed`, not just whether fetch succeeded. Refresh before retrying an uncertain result, and do not resend successful items.

## Sparks (on-device AI)

`sparks.js` connects the Sparks SDK (`@cosquest/sparks-sdk`, the real package; React Native New Architecture, which Expo SDK 52+ uses by default) to the app's existing Socket.IO connection. The backend half is already in `cosquest-backend` (see [SPARKS_INTEGRATION.md](../../cosquest-backend/SPARKS_INTEGRATION.md)); the full SDK guide is `docs/guides/APP_INTEGRATION.md` in the cosquest-sparks repo.

### Install and build

The SDK is a native module, so it needs a development build; Expo Go cannot load it (`createSparks` rejects there). We hand over the SDK package; install it from the path or registry we give you, then:

```sh
npx expo install expo-dev-client expo-build-properties
```

Merge into `app.json` (keep your existing plugins):

```json
{
  "expo": {
    "plugins": [
      "expo-dev-client",
      ["expo-build-properties", {
        "android": { "minSdkVersion": 26 },
        "ios": { "deploymentTarget": "16.0" }
      }]
    ]
  }
}
```

Then `npx expo prebuild` and `npx expo run:ios` / `npx expo run:android` (or an EAS development build). Android needs NDK 27.1.12297006 and CMake 3.22.1 installed locally (EAS images have them); keep `arm64-v8a` for release builds (the model tiers need it).

### Start it once per login

```js
import { startSparks, stopSparks } from './chat/sparks.js';

// After login, with the app's existing socket (io(url, { auth: { token } })):
await startSparks({
  socket,
  userId: me.id,
  sessionId: loginSessionId,        // new value on every login
  apiBaseUrl: process.env.EXPO_PUBLIC_API_URL,
  getToken: () => sessionStore.getState().token,
  onError: (error) => console.warn(error.message),
});

// Logout:
await stopSparks();                 // wipes the SDK's local store and device key
```

The helper listens for `sparks` socket frames before creating the SDK and replays any that arrive early (the backend answers `device.register` immediately). Do not recreate the SDK on reconnect; it queues and retries by itself.

### Feed every chat, DMs included

```js
import { ingestMessages, openChatForSparks } from './chat/sparks.js';

// When a chat screen opens:
await openChatForSparks(api, conversationId);           // members, roles, admin flags; first time also catches up history

// Every message you render: history pages, message:new / message:edited, your own sends.
ingestMessages(conversationId, page.messages);
socket.on('message:new', ({ conversationId, message }) => ingestMessages(conversationId, [message]));
const { message } = await api.sendText(conversationId, text);
ingestMessages(conversationId, [message]);              // the response carries seq; the SDK then tags it (hint)
```

### Show Sparks

The REST API and socket events the app already uses keep working (same URLs and shapes; they now include DMs). With the SDK running, `useSparks` gives the live list straight from the phone's mirror:

```js
import { useSparks } from './chat/sparks.js';

const { available, sparks } = useSparks(conversationId);
// available === false (Expo Go, before login): keep using api.listSparks(conversationId).
```

| Existing Spark UI | Call it uses now |
|---|---|
| Circles / cards list | `api.listSparks(id)` plus `spark:updated` / `spark:deleted` as before; or `useSparks(id)` with the SDK |
| Side panel | `api.getSpark(id, sparkId)` (messages oldest first, seams) |
| Marker on a message | `message.spark` `{ id, era, postedInSpark }` as before; `era` is the Spark's revival index (colour by it) |
| Reply inside a Spark | `api.sendInSpark(id, sparkId, text)` (revives a quiet Spark) |
| "Start a Spark" | `api.startSpark(id, messageId, subject)` works on every phone (409 `similar_sparks` / `already_in_spark` as before). With the model loaded, `sdk.sparks.startSpark({ chatId, seedMessageId, subject })` uses the model's duplicate check and returns `needs_choice` |
| "Add to existing" | `api.addToSpark(id, sparkId, messageId)` |
| Pin / merge / delete (admins) | `api.pinSpark`, `api.mergeSpark`, `api.deleteSpark` (403 for non-admins; both people in a DM are admins) |
| "Catch me up" (new) | `getSparks().sparks.summarize(sparkId)`; needs the model, else hide the button |
| Role pings (new) | Arrive as normal `notification:new` mentions ("A Spark needs Front-end: ...") |

Spark ids are now strings like `spk_3f2a9c1b0d4e`; treat them as opaque.

### Game state and the model

```js
import { useSparksAppState, setSparksGameState, ensureSparksModel } from './chat/sparks.js';

useSparksAppState(currentGameState);      // root component: 'background' when the app is backgrounded
setSparksGameState('battle');             // on every change: idle, map, battle, ar, trivia, background

// After onboarding, when it suits the UX (Wi-Fi only by default; about 1 GB plus 142 MB of speech files):
await ensureSparksModel({ onStatus: (s) => setModelStatus(s) });
```

Until the model is loaded the phone does no AI work for the group (other members' phones do it), so the user still sees every Spark.

### Automatic updates (expo-updates)

JavaScript changes reach phones over the air; native changes need a store build. Set it up once:

```sh
npx expo install expo-updates
eas update:configure                      # writes updates.url with your EAS project id
```

`app.json`:

```json
{
  "expo": {
    "runtimeVersion": { "policy": "fingerprint" },
    "updates": { "url": "https://u.expo.dev/<your-eas-project-id>" }
  }
}
```

`eas.json` (a channel per build profile):

```json
{
  "build": {
    "preview": { "distribution": "internal", "channel": "preview" },
    "production": { "channel": "production" }
  }
}
```

Ship a JavaScript change: `eas update --branch preview --message "..."` to testers first, then `eas update --branch production --message "..."`. Each channel reads the branch of the same name.

The `fingerprint` runtime version is a hash of the native project, so an update is only offered to builds with exactly the same native code: a JavaScript update can never land on a build whose native side does not match it.

What arrives how:

| Change | How it reaches phones |
|---|---|
| Sparks SDK JavaScript layer (message sorting, the transport, job handling, these helpers) | Over the air with `eas update`, after updating the SDK package |
| SDK native code (the inference engine, Swift/Kotlin, speech) | A new store build (the fingerprint changes, so old builds keep their old update) |
| The model itself | Automatically: phones read the model manifest and download the new version; no app update |
| Backend module | Deployed with the backend; no app update |

## Verification boundary

`sparks.js` is checked for syntax and its backend protocol is covered end to end by `cosquest-backend` tests (mock-SDK phones over Socket.IO), but it has not run inside the app with the real SDK here. JavaScript syntax is checked and the matching backend APIs have automated integration coverage. This repository has no Expo app or mobile build environment, so these components have not been bundled or run on iOS/Android here. Verify permissions, camera/gallery/cloud-file selection, cancel paths, microphone interruption, playback, foreground/background transitions, and production Cloudinary uploads in the actual app before release.

## In-app notifications (banners while the app is open)

With the app open, iOS and Android hand pushes to the app silently, so the backend doesn't send a push to someone whose app is on screen. It sends the same title, text and data over the socket as the `banner` event. `InAppNotifications.js` shows it Instagram-style: it slides down from the top, a tap opens the thing, a swipe up dismisses it, it hides after 4 seconds, and the next one follows. With the app in the background or closed, the normal push arrives instead.

The backend only knows the app is on screen if the app says so (`useAppStateReport(socket)`). A locked phone keeps its socket open for a while; without the report it counts as on screen, gets a banner nobody sees, and no push. Calls always push (so a locked phone rings); `showPushesWhileOpen` keeps that push hidden while the app is open, because the ringing screen (`call:incoming`) shows the call.

```sh
npx expo install expo-notifications
```

```js
import { InAppNotifications, showPushesWhileOpen, usePushTaps, useAppStateReport } from './InAppNotifications.js';

showPushesWhileOpen(); // once, at startup: pushes that still arrive while open (game events) show too; call pushes stay hidden

// The socket: `auth` as a function, so every reconnect sends the current state.
// const socket = io(url, { auth: (cb) => cb({ token, active: AppState.currentState === 'active' }) });

// Where a notification opens. Same data in a banner and in a tapped push.
function openFromNotification(data) {
  if (data.chatId && data.type === 'message') return navigation.navigate('Chat', { chatId: data.chatId, messageId: data.messageId });
  if (data.postId) return navigation.navigate('Post', { postId: data.postId, commentId: data.commentId });
  if (data.scheduledCallId) return navigation.navigate('ScheduledCall', { callId: data.scheduledCallId });
  if (data.type === 'follow') return navigation.navigate('Notifications');
  if (data.chatId) return navigation.navigate('Chat', { chatId: data.chatId }); // mentions, group notices
  return navigation.navigate('Notifications');
}

function Root() {
  usePushTaps(openFromNotification); // tapping a push, including one that opened the app
  useAppStateReport(socket);          // on screen or not: banners while open, pushes while locked
  return h(View, { style: { flex: 1 } },
    h(AppNavigator),
    h(InAppNotifications, { socket, onOpen: openFromNotification, currentChatId: openChatId }));
}
```

What pops up (`banner.data.type`): `message` (a chat message: `title` is the sender or the group, `body` the message), `mention`, `follow`, `like` (a post, or a comment with `commentId`), `comment` (a comment or a reply), `repost`, `post` (someone you follow posted or reposted), `group`, `scheduled-call` (invitations, changes, the 10-minute reminder). `call` banners are skipped because the ringing screen (`call:incoming`) shows calls. A chat's messages and mentions don't pop up while that chat is on screen (`currentChatId`). `banner.actor` is who did it (`username`, `name`, `avatarKey`, `avatarPhotoUrl`): the default picture is their photo or initials; pass `renderAvatar(actor)` to draw the app's avatar for `avatarKey`. Kinds switched off in notification settings (e.g. Friend activity) don't pop up either.

The inbox still updates from `notification:new` as before; a banner is only the pop-up.

## Ringing calls (app open, in the background, or locked)

An incoming call rings for **a minute**; after that the backend marks it missed. There are two ways a phone rings:

- **Like a phone call (`NativeCalls.js`):** the phone's own call screen, full screen and on the lock screen too: CallKit on iPhones, the system call screen on Android. It rings for the whole minute, with Answer and Decline, even when the app is closed. This needs the backend's Apple and Firebase keys (`PUSH.md`, "Ringing like a phone call"); until they are set, phones ring the second way.
- **With the ringtone push (`CallRinging.js`):** every other phone. In the background, locked or closed, the backend's call push rings: iPhones play `ringtone.wav` (29 s; iOS plays at most 30 s) and the backend sends it again at 30 s while the call is still ringing; Android plays the `calls` channel's `ringtone_long.wav` (60 s). The push is time-sensitive, so an iPhone in Focus still rings. With the app open, the app rings itself (the ringtone on a loop, plus vibration) from `call:incoming` until the call is answered, declined, cancelled, missed or over; the call push stays hidden (`showPushesWhileOpen`). Sent to the background mid-ring, it posts a ringing notification instead.

Setup (native: a new build with `eas build`; `eas update` alone is not enough):

1. Copy `assets/sounds/ringtone.wav` (29 s) and `assets/sounds/ringtone_long.wav` (60 s), bell ringtones free to use, into the app's `assets/sounds/`, or use your own with those names (`ringtone.wav` under 30 s).
2. `app.json`:

```json
{
  "expo": {
    "plugins": [
      ["expo-notifications", { "sounds": ["./assets/sounds/ringtone.wav", "./assets/sounds/ringtone_long.wav"] }],
      ["expo-callkit-telecom", {
        "sounds": ["./assets/sounds/ringtone.wav", "./assets/sounds/ringtone_long.wav"],
        "defaultRingtoneIos": "ringtone.wav",
        "defaultRingtoneAndroid": "ringtone_long.wav",
        "incomingCallTimeout": 65,
        "supportsVideo": true,
        "microphonePermission": "$(PRODUCT_NAME) needs the microphone for calls."
      }]
    ],
    "ios": { "entitlements": { "com.apple.developer.usernotifications.time-sensitive": true } },
    "android": { "googleServicesFile": "./google-services.json" }
  }
}
```

   `npx expo install expo-callkit-telecom`. `google-services.json` comes from the Firebase project (Android app with the app's package name); keep it out of git if the repository is public. `incomingCallTimeout` 65: a little over the backend's minute, so the backend says "missed" first and the call isn't recorded as declined.

3. Create the `calls` channel with the long ringtone, where the app creates its other channels (PushRegistration), in place of the old `calls` settings: `await setUpCallChannel();`. Android fixes a channel's sound when it is first created, so a phone that already has the app keeps the old sound until the app is reinstalled.
4. Wire it up:

```js
import { setUpCallChannel, useCallRinging } from './CallRinging.js';
import { setUpNativeCalls, useNativeCallToken, useNativeCalls } from './NativeCalls.js';

setUpNativeCalls(); // module scope, in the file the app starts from

function Root() {
  // Registers the push token and the call token together (POST /api/users/me/devices);
  // callRinging: 'native' once the backend can ring this phone's own call screen.
  const callRinging = useNativeCallToken({ pushToken, register: (body) => api.post('/api/users/me/devices', body) });

  // Answer / Decline on the call screen, and closing it when the ring is over elsewhere.
  // joinCall: the app's LiveKit join with the accept answer ({ call, token, livekitUrl, ... }).
  const { endNativeCall } = useNativeCalls({ socket, userId: me.id, api: (method, path) => api.request(method, path), joinCall });
  // Hanging up in the app's call screen: endNativeCall(call.id) too, so the system screen closes.

  // The app rings itself only when the phone's own call screen doesn't.
  const { ringingCall, startRinging, stopRinging } = useCallRinging({
    socket,
    userId: me.id,
    ringtone: require('./assets/sounds/ringtone.wav'),
    ringInApp: callRinging !== 'native',
    // Checked on coming back to the app (an iPhone app in the background misses call:updated):
    fetchIncoming: async () => (await api.get('/api/calls/incoming')).call,
  });
  // Show the ringing screen while ringingCall is set; Accept/Decline call stopRinging()
  // (call:updated stops it too). Opened from a tapped call push: GET /api/calls/incoming
  // and, if a call is still ringing, startRinging(call).
}
```

On Android 14 and later, Google Play grants full-screen calls over the lock screen (USE_FULL_SCREEN_INTENT) only to apps whose core use includes calling or alarms, through the full-screen intent declaration in Play Console. Where it isn't granted, or the person turns it off for the app, the call shows as a heads-up notification that still rings.

`NativeCalls.js` is written against expo-callkit-telecom's documented API and has not run in the app here; check it against the installed version and try a call on a real iPhone and Android phone (both locked) before release.
