# Expo chat integration

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

## Verification boundary

JavaScript syntax is checked and the matching backend APIs have automated integration coverage. This repository has no Expo app or mobile build environment, so these components have not been bundled or run on iOS/Android here. Verify permissions, camera/gallery/cloud-file selection, cancel paths, microphone interruption, playback, foreground/background transitions, and production Cloudinary uploads in the actual app before release.
