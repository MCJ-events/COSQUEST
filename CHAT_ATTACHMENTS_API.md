# Chat attachments, stickers, voice notes, timed pins, and bulk actions

This extends [COMMUNITY_SETTINGS_API.md](COMMUNITY_SETTINGS_API.md). Every API here requires a Bearer token and completed onboarding. The backend changes are implemented. The Expo integration code is in [examples/expo-chat](examples/expo-chat/README.md); copy it into the existing mobile app, which is not in this repository.

## Attach menu

All choices send `POST /api/chats/:conversationId/messages` as multipart form-data with one file under `media`. Optional fields: `content` and `replyTo`. `kind` may be supplied explicitly; it must match the file's type. Omitting it infers the type, except stickers require `kind=sticker`.

| Button | Frontend action | kind | Server limit |
| --- | --- | --- | --- |
| Photo | Open image library, preview, confirm | image | 10 MB; JPEG, PNG, WEBP, GIF |
| Video | Open video library, preview, confirm | video | 50 MB; MP4, MOV, WEBM |
| Document | Open document picker | file | 10 MB; PDF, TXT, CSV, DOC/DOCX, XLS/XLSX, PPT/PPTX |
| Camera | Request camera access, take photo, preview | image | 10 MB; same as Photo |
| Audio | Select an existing audio file | audio | 10 MB; MP3, M4A, AAC, WEBM, OGG, WAV |
| Composer microphone | Request microphone access, record, stop, confirm/send | audio | 10 MB |
| Sticker | Select a PNG/WEBP/GIF sticker from local files or your supplied sticker assets | sticker | 1 MB |

The Expo helper converts HEIC/HEIF/unknown photo formats to JPEG before uploading. The camera button captures a photo; video-library selection handles Video. Recording camera video would use the same `kind=video` upload endpoint with a camera video recorder.

The server returns `201 { message }`. `message.kind` controls the bubble renderer. `message.media` contains its hosted URL, filename, MIME type, size, and duration for audio/video when supplied by Cloudinary. A sticker is an image attachment with its own message kind, not a text emoji or reaction. Reactions continue using the reactions endpoint. No sticker pack catalog or third-party sticker provider is bundled.

```text
POST /api/chats/:conversationId/messages
Authorization: Bearer <token>
multipart/form-data:
  kind = sticker
  media = <sticker.webp file>
```

```text
POST /api/chats/:conversationId/messages
Authorization: Bearer <token>
multipart/form-data:
  kind = audio
  media = <recording.m4a file>
  waveform = [0.1,0.5,0.9,0.2]
  replyTo = <optional message ID>
```

`waveform` is optional display data: a JSON array of 1-128 finite values between 0 and 1. Only audio accepts it. The backend does not generate waveform samples. Duration is read from the media provider, not accepted from a client duration field. Stickers, video, and waveform metadata survive forwarding. Error `400` means invalid type/kind/fields; `413` means too large. Do not manually set multipart Content-Type in fetch—the runtime must set its boundary.

## Voice-note transcription

Set `DEEPGRAM_API_KEY` in the backend environment. New audio messages return immediately with `media.transcribing: true` and `media.transcript: null`. The backend sends the hosted audio URL to [Deepgram's pre-recorded transcription API](https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded) using Nova-2 and smart formatting.

When processing finishes, the backend stores the transcript, clears `transcribing`, and emits `message:edited` with the updated message. Clients can also retrieve these fields on their next message fetch. Empty transcripts and failed requests leave `transcript: null` and clear `transcribing`; requests time out after 60 seconds. Forwarding preserves completed transcripts; copies made while processing receive their own transcription job.

These jobs run in the server process. A server restart can interrupt pending transcription; automatic retries and a durable job queue are not included.

## Timed pin

```http
PATCH /api/chats/:conversationId/pinned-message
Content-Type: application/json

{"messageId":"<messageId>","duration":"24h"}
```

Exactly three duration values: `24h`, `7d`, `30d`. Missing duration defaults to `7d` for older clients. Invalid values return `400`. `messageId` is required; `{ "messageId": null }` explicitly unpins.

The response's `pinnedMessage` includes `pinnedAt`, `expiresAt`, `pinnedBy`, and `duration`, in addition to the message preview. Reading `GET /api/chats/:conversationId` returns `pinnedMessage: null` at or after expiry. No background scheduler is needed for that behavior. Expiry does not delete the underlying message or conversation. Existing untimed pins get one seven-day window on their first read; repeated reads do not extend it.

There remains one pinned message per conversation, and any member may replace it. The frontend presents the three choices in a modal or bottom sheet, refreshes conversation detail on focus/polling, and removes the currently displayed banner at `expiresAt`. Deleting the pinned message for everyone clears all pin metadata; deleting for me hides the banner for that viewer.

## Delete selected messages

```http
POST /api/chats/:conversationId/messages/bulk-delete
Content-Type: application/json

{"messageIds":["<id1>","<id2>"],"scope":"me"}
```

Use `scope: "everyone"` to delete for everyone. Select 1-50 IDs from one conversation. Duplicate IDs are processed once. The existing single-message DELETE endpoint still works.

The existing rules apply to each item: delete for me at any time; delete for everyone only by its sender within five minutes, with a deleted-message placeholder. This request changed selection from single to multiple; it does not invent replacement ownership/time-window rules.

Each selected message is processed independently. A mixture of sent and received/old messages can therefore partially succeed. All successful: HTTP `200`. Any item failure: HTTP `207`, including when every item fails. Malformed selection/scope returns `400` before actions start; lack of conversation access returns `403`.

```json
{
  "results": [
    {"messageId":"<id1>","status":200,"deleted":true,"scope":"everyone"},
    {"messageId":"<id2>","status":403,"error":"You can only delete your own message for everyone."}
  ],
  "summary":{"total":2,"succeeded":1,"failed":1}
}
```

The frontend updates successful items, retains failed selections, and explains their errors. Bulk operations are not database transactions. For an unexpected storage failure, refresh the chat before retrying because an action may already have persisted.

## Forward selected messages

Single recipient:

```http
POST /api/chats/:conversationId/messages/bulk-forward
Content-Type: application/json

{"messageIds":["<id1>","<id2>"],"targetUsername":"MarkJ"}
```

Alternatively supply `targetConversationId`. Multiple recipients:

```json
{
  "messageIds":["<id1>","<id2>"],
  "targets":[
    {"targetConversationId":"<chat-id>"},
    {"targetUsername":"MarkJ"}
  ]
}
```

Maximum 50 distinct selected messages, 10 target entries (up to 500 copies). Each target has exactly one destination field. Use either `targets` or the single-destination fields. Duplicate source IDs and recipients are deduplicated, including when username and conversation ID identify the same DM.

Messages must belong to the source chat and be visible to the caller. All sources and destinations are validated before sending; unavailable selections or an invalid target abort preflight with no copies sent. Membership, blocks, and Allow Direct Messages apply. Copies are sent oldest-first regardless of selection order. Each copy carries `forwarded: true`; the original's reactions, read state, pin, and reply thread are not copied.

Response: `{ results, summary }`, HTTP `200` if every copy succeeds, otherwise `207`. Each result contains `sourceMessageId`, `conversationId`, `status`, and either the new `message` or `error`. Existing single-message forwarding remains available. Refresh before retrying a transport/server failure; blindly replaying an entire successful batch creates duplicate forwards. No idempotency key is implemented.

## Backend and mobile setup

Configure the existing backend Cloudinary credentials and optionally `CLOUDINARY_CHAT_FOLDER`; keep secrets on the server. Files upload through the authenticated backend, which checks chat membership. The mobile app needs a reachable API base URL (a physical phone cannot reach the computer via its own localhost), the saved session token, camera/microphone permission descriptions, native builds with the required Expo modules, and message renderers for the six kinds.

The attachment helpers and recording hook preserve cancellation, require confirmation to send, and retain a voice-note draft after upload failure. Integrate upload/loading/error UI, selected-message state, the recipient picker, timer-based pin hiding, and cache cleanup into the real app. Native device behavior and production media delivery require device testing; automated backend tests use the existing Cloudinary test adapter.
