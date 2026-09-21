# Community, Spotlight, settings, and immediate sign-in

For the latest attachment types, sticker/voice-note code, timed pin durations, and bulk actions, see [CHAT_ATTACHMENTS_API.md](CHAT_ATTACHMENTS_API.md).

Current contract for the supplied Community and Settings screens. This document supersedes older onboarding, comment-threading, and Spotlight assumptions in the other guides.

All protected examples use `Authorization: Bearer <token>`. Chat, Spotlight, social writes, and settings require completed onboarding. `:postId`, `:commentId`, `:conversationId`, and `:messageId` are IDs returned by the API; they are not usernames. JSON requests use `Content-Type: application/json`.

## Sign up once, continue directly into the app

```http
POST /api/auth/signup
Content-Type: application/json

{"identifier":"hero@example.com","password":"Quest@1234","confirmPassword":"Quest@1234"}
```

New signup returns `201` with `{ token, onboardingRequired: true, resumed: false, user }`. The frontend saves `token` in its session/secure storage immediately, sends it with onboarding calls, then calls `POST /api/users/me/onboarding/complete`. Completion returns `onboardingRequired: false`; the original token already works for the main app. Do not redirect to Login or make another login call. Returning to an incomplete signup requires the existing password and returns `200`, `resumed: true`, and a token; it no longer overwrites the password. Login and OAuth still support returning users. Logout invalidates all existing tokens for the account. Sessions currently have no time-based expiry.

## Feed, comments, and replies

```http
GET    /api/posts?page=1&limit=20
GET    /api/posts/:postId
POST   /api/posts
PATCH  /api/posts/:postId
DELETE /api/posts/:postId
POST   /api/posts/:postId/likes
DELETE /api/posts/:postId/likes
GET    /api/posts/:postId/comments?page=1&limit=20
GET    /api/posts/:postId/comments?parentComment=:rootCommentId&page=1&limit=20
POST   /api/posts/:postId/comments
DELETE /api/posts/:postId/comments/:commentId
POST   /api/posts/:postId/comments/:commentId/likes
DELETE /api/posts/:postId/comments/:commentId/likes
GET    /api/posts/:postId/share
POST   /api/posts/:postId/shares
DELETE /api/posts/:postId/shares
POST   /api/posts/:postId/bookmarks
DELETE /api/posts/:postId/bookmarks
GET    /api/users/me/bookmarks
```

Comment body: `{ "body": "Great cosplay!" }`.

Reply to any comment or reply:

```json
{"body":"Thanks!","parentComment":"<the comment or reply being answered>"}
```

Replies stay under the original top-level comment, like a flat Instagram-style thread. The response gives `parentComment` (root thread ID) and `replyToComment` (the exact comment/reply answered). Further replies work the same way. This supports conversations of any depth without ever more indented UI. A `parentComment` query using a reply ID also resolves its root thread.

Every returned comment/reply has `likeCount` and `likedByMe`; send the bearer header on reads to get viewer state. Like/unlike accepts no body and returns `200 { liked, likeCount }`. Repeating the same action is safe. A post ID cannot be used with another post's comment ID. Delete is comment-author-only; deleting a root removes its entire reply thread and their likes. Deleting a reply leaves sibling replies intact. Posts can only be edited/deleted by their author.

`GET .../share` returns `{ url, title, text, imageUrl, appUrl }`. `url` opens a real `/p/:postId` HTML page with Open Graph metadata. Public previews are unavailable for private/friends-only profiles or hidden activity feeds. `POST .../shares` is the separate share-count operation; it does not open the device share sheet. The app passes the share payload to its native share sheet.

## Chats and long-press actions

```http
GET    /api/chats
GET    /api/users/search?search=mark&page=1&limit=20
POST   /api/chats/dm
GET    /api/chats/:conversationId
GET    /api/chats/:conversationId/share
GET    /api/chats/:conversationId/messages?page=1&limit=30
GET    /api/chats/:conversationId/messages/:messageId
GET    /api/chats/:conversationId/messages/:messageId/share
POST   /api/chats/:conversationId/messages
PATCH  /api/chats/:conversationId/messages/:messageId
DELETE /api/chats/:conversationId/messages/:messageId?scope=me
DELETE /api/chats/:conversationId/messages/:messageId?scope=everyone
POST   /api/chats/:conversationId/messages/:messageId/reactions
DELETE /api/chats/:conversationId/messages/:messageId/reactions
POST   /api/chats/:conversationId/messages/:messageId/forward
GET    /api/chats/:conversationId/messages/:messageId/seen?page=1&limit=30
PATCH  /api/chats/:conversationId/pinned-message
PATCH  /api/chats/:conversationId/read
```

| Action | Body / behavior |
| --- | --- |
| Start/find DM | `{"username":"MarkJ"}`; returns the existing conversation if already created |
| Text | `{"content":"Hello"}` |
| Reply, including to your own message | `{"content":"Following up","replyTo":"<messageId>"}` |
| Edit | `{"content":"Corrected text"}`; sender only, no edit time limit, returns `editedAt` |
| React | `{"emoji":"❤️"}`; one emoji per user per message, a new emoji replaces the old one |
| Remove reaction | DELETE, no body |
| Pin | `{"messageId":"<messageId>","duration":"24h"}`; duration is `24h`, `7d`, or `30d` (default `7d`); one pinned message per conversation, any member |
| Unpin | `{"messageId":null}` |
| Forward to an existing chat | `{"targetConversationId":"<conversationId>"}` |
| Forward to a person | `{"targetUsername":"MarkJ"}`; finds/creates the DM |
| Read / Seen | PATCH read advances the caller's read timestamp; GET seen returns people who have read through that message |
| Copy text | Frontend copies already-loaded `message.content`; no backend call |
| Copy link | GET message share; frontend copies `url` |
| Select | Frontend selection state; POST `.../messages/bulk-delete` or `.../messages/bulk-forward` with `messageIds` |

Forwarding requires exactly one target field and returns `{ conversationId, message }`, with `message.forwarded: true`. It copies text and media metadata; editing/deleting the original does not change the forwarded copy. Membership, blocking, and the recipient's Allow Direct Messages setting apply, including when forwarding by conversation ID. Sending into an existing DM also respects these settings.

Deletion currently preserves the saved rules: `scope=me` hides from the caller at any time; `scope=everyone` is sender-only within 5 minutes, and leaves `This message was deleted.` Both are soft deletion. A message deleted for everyone is unpinned and cannot be repinned, forwarded, replied to, or reacted to. A message deleted for me is hidden from that viewer's list, direct-message lookup, share link, reply preview, and pinned banner. Invalid scope returns `400`. The revised deletion requirements requested in this conversation still need their exact replacement rules before changing the time limit/ownership/tombstone behavior.

Chat links open `/c/:conversationId` or `/c/:conversationId/m/:messageId`. The public page deliberately contains a generic CosQuest card; it never includes private chat text, participant names, or attachments. Opening a link does not join a chat or grant access. The frontend preserves the target while signing in, then calls the protected detail/message endpoint to navigate to it, even if the message is not on page 1.

Set `PUBLIC_BASE_URL` to the backend's public HTTPS origin so shared links work outside localhost. Set `APP_WEB_URL` to the web frontend base URL to enable the landing-page "Open in CosQuest" link. The frontend must implement `/chats/:id`, `/chats/:id/messages/:id`, and `/posts/:id`; native universal/app links require mobile platform configuration. Without `APP_WEB_URL`, the landing page still opens, but has no configured app destination.

## Voice notes and the paperclip/file button

Send one attachment per message as `multipart/form-data`: 10 MB for images/audio/documents, 50 MB for videos, and 1 MB for stickers.

```text
POST /api/chats/:conversationId/messages
Authorization: Bearer <token>

media: <file>
content: optional caption
replyTo: optional message ID
```

- Voice notes: MP3, M4A, WEBM, OGG, WAV with the appropriate `audio/*` MIME type. Response `kind: "audio"` and `media.durationSeconds`. Existing audio support was retained.
- Images: JPEG, PNG, WEBP, GIF. Response `kind: "image"`.
- Documents: PDF, TXT, CSV, DOC/DOCX, XLS/XLSX, PPT/PPTX. Response `kind: "file"`.
- Video: MP4, MOV, WEBM. Response `kind: "video"`.
- Sticker: PNG, WEBP, GIF, with explicit `kind=sticker`.
- Media includes `url`, `publicId`, `resourceType`, `fileName`, `mimeType`, `sizeBytes`, and `durationSeconds` where available. Forwarding preserves these values.

The microphone permission/recording, waveform display, playback, paperclip picker, clipboard, and device share sheet belong to the mobile frontend. No frontend exists in this repository. Chat delivery is REST/polling; voice/video calls and WebSockets are not implemented. Production media storage requires Cloudinary configuration; test uploads use the existing test adapter. Cloudinary account delivery settings can also restrict PDF/Office-file downloads, so verify those using the production account.

## Spotlight / Bounty Board

```http
GET /api/spotlight/leaderboard?page=1&limit=20
GET /api/spotlight/leaderboard?interest=anime&page=1&limit=20
GET /api/spotlight/realms
GET /api/users/me/points
```

The leaderboard returns `podium` (top 3 users), paginated `leaders`, `me` (caller and rank, or null when outside the selected realm), and `pagination`. Rows contain `{ rank, points, user }`, where user includes ID, name, username, avatar/photo, faction, and interests. Sort is descending `pointsBalance`; equal scores share a competition rank (1, 1, 3), with stable ordering by user ID. Only completed accounts participate, and blocked users are omitted for the viewer. An interest/realm board filters the existing user `interests` array. Limit is 1-100; page is 1-1000.

As requested, this reads existing points only. It adds no automatic point awards and no client endpoint for setting a score. New accounts remain at 0 until the later points-awarding system updates balances. Earning rules, levels, and level thresholds remain undefined: `pointsEarningEnabled: false`, `levelsConfigured: false`, `level: null`. The screenshot's "Level 1" is not derived from a made-up formula.

## Account Settings screens

```http
GET    /api/users/me/settings
GET    /api/users/me/account
PATCH  /api/users/me/account
POST   /api/users/me/avatar/photo
PATCH  /api/users/me/avatar
GET    /api/meta/avatars
PATCH  /api/users/me/password
GET    /api/users/me/privacy
PATCH  /api/users/me/privacy
GET    /api/users/me/blocked
POST   /api/users/:username/block
DELETE /api/users/:username/block
GET    /api/users/me/preferences/notifications
PATCH  /api/users/me/preferences/notifications
POST   /api/users/me/devices
GET    /api/users/me/appearance
PATCH  /api/users/me/appearance
GET    /api/users/me/data-usage
PATCH  /api/users/me/data-usage
GET    /api/users/me/help
POST   /api/users/me/support-requests
POST   /api/auth/logout
```

`GET /settings` supplies account, privacy, notification, appearance and data-usage values plus `blockedUserCount` for the overview and blocked-users row.

Account Information PATCH accepts any combination of:

```json
{
  "displayName": "CosplayQueen",
  "username": "cos_queen",
  "email": "queen@example.com",
  "currentPassword": "Quest@1234",
  "phone": "+1 (555) 234-5678",
  "dateOfBirth": "1998-10-12"
}
```

`displayName` is 1-80 characters. Username remains unique and 3-20 letters/numbers/underscores. Phone is stored in international form and may be cleared with an empty string. Birth date must be a real YYYY-MM-DD date, age 13-120. These account phone/date values are private and are never copied into public Contact Options. Avatar photo uses multipart `photo` (existing image endpoint); preset avatar uses `{"avatar":"green-knight"}`.

Changing the login email requires `currentPassword`, invalidates previous sessions, and returns a replacement `token` to save. It does not send a verification email; verification infrastructure is not present. Social sign-in accounts cannot change login email through this endpoint until provider reauthentication is added. Public contact email remains a separate field under `GET/PATCH /api/users/me/contact`.

Password PATCH:

```json
{"currentPassword":"Quest@1234","newPassword":"NewQuest@1234","confirmPassword":"NewQuest@1234"}
```

Returns a replacement token and invalidates other sessions. Password strength checks are the same as signup.

Privacy PATCH:

```json
{"profileVisibility":"friends","showOnlineStatus":false,"showActivityFeed":true,"allowFriendRequests":true,"allowDirectMessages":false}
```

Visibility is `public`, `friends`, or `private`. Friends currently means mutual follows. Turning off online status hides the presence timestamp from chat users. `allowFriendRequests` is persisted for this UI; a separate friend-request/inbox/accept flow does not exist yet. Direct-message permission is enforced for starting, sending, and forwarding DMs.

Notifications PATCH (each toggle is independently optional):

```json
{
  "notificationsEnabled":true,
  "eventReminders":true,
  "questUpdates":true,
  "factionNews":false,
  "friendActivity":true,
  "rankChanges":true,
  "emailWeeklyNewsletter":false,
  "emailPromotionalEvents":false
}
```

These save preferences. Push/email delivery, scheduled reminders, newsletters, and promotional campaigns are not created by toggling them. Existing in-app notifications continue to work. Device registration accepts `{ "pushToken": "...", "platform": "android" }` (`ios`/`web` also supported).

Appearance PATCH:

```json
{"themeMode":"dark","accentColor":"#ca4aa0","fontSize":"medium","reduceMotion":false}
```

Theme: `light|dark|system`; accent: six-digit hex; font size: `small|medium|large`. The frontend applies the saved settings.

Data Usage PATCH:

```json
{"downloadOverWifiOnly":true,"autoPlayVideos":false,"imageQuality":"high"}
```

Image quality: `low|medium|high|auto`. Storage capacity/usage and cache size are measured on the device. Clear Cache deletes only the app's local cache through the frontend; it has no backend delete endpoint. The app also enforces Wi-Fi-only downloads, autoplay, image quality, and OS permissions.

Help returns configurable `faqUrl`, `supportUrl`, `termsUrl`, `privacyPolicyUrl`, and the support-request endpoint. Set `HELP_FAQ_URL`, `HELP_SUPPORT_URL`, `TERMS_URL`, `PRIVACY_POLICY_URL`; absent links return null. No invented legal documents or support contact addresses are supplied. Display the installed app version/build from the frontend package.

Contact Support / Report a Bug:

```json
{"type":"bug","subject":"Audio will not play","message":"Describe what happened and how to reproduce it.","platform":"android","appVersion":"2.4.0"}
```

`type` is `support|bug`. Response `201 { request: { id, type, status: "open", createdAt } }`. This stores a support request; there is no live-agent support chat, staff dashboard, or email dispatch yet. Requests are limited to 10 per account per hour. Subject limit 150 characters; message limit 5000.

## Validation

`npm test` runs the existing smoke tests and `test/communitySettings.js` against a disposable MongoDB, covering immediate sign-in, comment/reply likes and cleanup, thread replies, link pages and access restrictions, forwarding, deletion visibility, document upload metadata, leaderboard ranking/ties/filtering, private account updates, session revocation, settings validation, and support requests. Production Cloudinary delivery and native frontend behavior need device/account integration testing.
