# CosQuest API Usage Examples and Flows

This document reflects the current backend routes. Base URL in Postman:

```text
{{baseUrl}} = http://localhost:6893
```

## Common Postman setup

Use collection variables instead of placing passwords or tokens directly in every request.

```text
email          test@example.com
username       test_user
password       AStrongPassword!1
accessToken    set from a successful login or OAuth exchange
targetUsername another_user
questId        copied from GET /api/quests
postId         copied from a post response
commentId      copied from a comment response
```

For every endpoint marked **Bearer**, add this header:

```http
Authorization: Bearer {{accessToken}}
```

Authentication labels:

- **Public** — no sign-in needed.
- **Identifier or Bearer** — before onboarding/login, include `email`, `username`, or `identifier` in the body/query. After login, use the Bearer header instead. If both are supplied, Bearer wins.
- **Bearer + completed onboarding** — user must be logged in and have completed onboarding.

Important: creation endpoints correctly return **201**, not 200. A duplicate like/follow/quest registration returns **409** by design. Signup is the one exception: re-signing-up with an email/username whose onboarding was never finished **resumes** that same account (`200`, `resumed: true`) instead of erroring - it's the same person coming back, not a real conflict. Signup only returns `409` when the existing account already finished onboarding.

## Recommended end-to-end flow

1. Call public reference endpoints: avatars, factions, interests, and categories.
2. Sign up with an email **or** a username and a strong password. Signup returns 201 but no token.
3. Complete onboarding using the email/username from signup (or use a token if the user already has one). It requires name, username, age, gender, an avatar or uploaded photo, faction, at least one interest, an explicit notification choice, and enabled location with real coordinates. (Sign in works even before this step now - see step 4 - but nothing beyond onboarding itself is usable until it's done.)
4. Sign in. Save `token` from the response into `{{accessToken}}`. This works as soon as the account exists with a correct password, even mid-onboarding - check the response's `onboardingRequired` to know whether to route to onboarding or the main app.
5. Use Bearer-protected profile, dashboard, social, post, quest, notification, and points endpoints.
6. To test a post lifecycle: create a thought → copy `post.id` → like/comment/read/update/delete → copy `comment.id` before deleting it.
7. To test a quest lifecycle: list quests → copy a published quest ID → register → view profile quest history → cancel registration.
8. Logout last. Logout invalidates every existing token for that user; sign in again for a new one.

## Health

| Method and URL | Login? | Usage / expected result |
| --- | --- | --- |
| `GET /health` | Public | Server check. Returns `200` with `{ "ok": true, "service": "cosquest-backend" }`. |

## Authentication and OAuth

| Method and URL | Login? | Usage |
| --- | --- | --- |
| `POST /api/auth/signup` | Public | Create an email-or-username account. Returns `201`, no token yet. If that identifier already exists **and its onboarding was never finished**, returns `200` with `resumed: true` and the existing (partial) user instead of an error - the same account, picked back up. Returns `409` only if the existing account already completed onboarding. |
| `POST /api/auth/login` | Public | Sign in with a valid password, whether or not onboarding is finished. Returns `200` with `token` and `onboardingRequired` (`true` if onboarding still isn't done - use that token to continue it; `requireCompletedOnboarding` still blocks every real feature until it's actually finished). |
| `POST /api/auth/logout` | Bearer | Invalidates current tokens for the account. Returns `200`. |
| `GET /api/auth/oauth/google` | Public | Browser redirect to Google. Expected browser redirect, not a JSON 200 response. |
| `GET /api/auth/oauth/google/callback` | Provider | Google redirects here after consent. Do not manually invent the code/state. |
| `GET /api/auth/oauth/apple` | Public | Browser redirect to Apple. |
| `POST /api/auth/oauth/apple/callback` | Provider | Apple posts provider data here after consent. |
| `POST /api/auth/oauth/exchange` | Public, one-time code | Exchange the OAuth completion code returned to the frontend redirect for a Bearer token. |

Email signup body:

```json
{
  "identifier": "{{email}}",
  "password": "{{password}}",
  "confirmPassword": "{{password}}"
}
```

Username signup body (use this instead of email if desired):

```json
{
  "identifier": "{{username}}",
  "password": "{{password}}",
  "confirmPassword": "{{password}}"
}
```

Password rule: include uppercase, lowercase, number, and special character; use at least 8 characters.

Login body. The **field name** must remain `identifier`; its value can be an email or username.

```json
{
  "identifier": "{{email}}",
  "password": "{{password}}"
}
```

OAuth exchange body:

```json
{ "oauthCode": "{{oauthCode}}" }
```

## Onboarding, preferences, and reference data

| Method and URL | Login? | Usage |
| --- | --- | --- |
| `GET /api/meta/avatars` | Public | List valid Cloudinary preset avatars. Use the returned `key` in avatar requests. |
| `GET /api/meta/profile-categories` | Public | List valid profile categories. |
| `GET /api/factions` | Public | List the six valid factions. |
| `GET /api/interests` | Public | List valid interest keys. |
| `GET /api/users/me` | Identifier or Bearer | Read the current/in-progress user record. Before login include `?email={{email}}`. |
| `PATCH /api/users/me/profile` | Identifier or Bearer | Save profile details during onboarding or edit profile later. |
| `GET /api/users/check-username?username=new_name` | Identifier or Bearer | Check if a username is available. Before login also send `&email={{email}}`. |
| `PATCH /api/users/me/avatar` | Identifier or Bearer | Set a valid preset avatar. It clears an uploaded photo. |
| `POST /api/users/me/avatar/photo` | Identifier or Bearer | Multipart upload; set form-data `photo` to a local image file and also add `email` before login. |
| `POST /api/users/me/faction` | Identifier or Bearer | Choose/replace faction. A faction is required before onboarding completion. |
| `PUT /api/users/me/interests` | Identifier or Bearer | Replace the full list of interests. At least one is required before completion. |
| `PATCH /api/users/me/preferences/notifications` | Identifier or Bearer | Save an explicit true/false notification choice. |
| `PATCH /api/users/me/preferences/location` | Identifier or Bearer | Save real device coordinates and a discovery radius (5-100 miles, default 50). **Required** before onboarding completion - CosQuest is played in the real world. `lat`/`lng` are required whenever `locationEnabled` is `true`. |
| `POST /api/users/me/devices` | Identifier or Bearer | Register an iOS, Android, or web push token. |
| `POST /api/users/me/onboarding/complete` | Identifier or Bearer | Atomic final onboarding submission. Returns `200` only if every required selection is valid, including location. |

Profile update body:

```json
{
  "email": "{{email}}",
  "firstName": "Postman",
  "lastName": "Tester",
  "username": "{{username}}",
  "age": 25,
  "gender": "Female",
  "bio": "Cosplayer and quest explorer.",
  "category": "Digital creator",
  "showCategoryOnProfile": true
}
```

Preset avatar body:

```json
{ "email": "{{email}}", "avatar": "adventurer" }
```

Faction body:

```json
{ "email": "{{email}}", "factionKey": "ascendants" }
```

Interest body:

```json
{ "email": "{{email}}", "interests": ["anime", "comic", "movies-tv"] }
```

Notification preference body:

```json
{ "email": "{{email}}", "notificationsEnabled": true }
```

Location preference body (required before onboarding can complete):

```json
{ "email": "{{email}}", "locationEnabled": true, "radiusMiles": 50, "lat": 6.5244, "lng": 3.3792 }
```

Send `locationEnabled: false` (no `lat`/`lng` needed) to disable it and clear the saved coordinates - but onboarding cannot complete while it's off.

Device body:

```json
{ "pushToken": "example-device-token-from-your-mobile-app", "platform": "android" }
```

Final onboarding body (preset-avatar route):

```json
{
  "email": "{{email}}",
  "profile": {
    "firstName": "Postman",
    "lastName": "Tester",
    "username": "{{username}}",
    "age": 25,
    "gender": "Female",
    "avatar": "adventurer"
  },
  "faction": "ascendants",
  "interests": ["anime", "comic"],
  "preferences": { "notificationsEnabled": true },
  "location": { "locationEnabled": true, "radiusMiles": 50, "lat": 6.5244, "lng": 3.3792 }
}
```

If a photo was uploaded first, omit `profile.avatar`; the uploaded photo already satisfies the avatar requirement. `location` follows the same shape as the standalone location-preference body above and is required the same way.

## My profile, contact, and notifications

All endpoints in this section require a logged-in, fully onboarded account.

| Method and URL | Usage |
| --- | --- |
| `GET /api/users/me/points` | Read current app points balance. Returns `200` with `{ "points": 0 }` until a future reward system awards points. |
| `GET /api/users/me/contact` | Read the owner’s editable public contact values. |
| `PATCH /api/users/me/contact` | Save public contact fields; does not change login email. |
| `GET /api/users/me/notifications` | List this user’s notifications, including follow notifications. |
| `PATCH /api/users/me/notifications/read` | Mark every currently unread notification as read. Body not required. |
| `GET /api/home/dashboard` | Get the dashboard anchored to the user's own saved location (`location.source: "user"`): user preview, unread notification count, live/upcoming/nearby quests. |

Contact body:

```json
{
  "email": "creator@example.com",
  "phone": "+2348148327836",
  "businessAddress": "Lekki, Lagos, Nigeria"
}
```

## Public profiles and follow system

| Method and URL | Login? | Usage |
| --- | --- | --- |
| `GET /api/users/:username/profile` | Public | Public profile, bio, visible category, public contact, and stats. |
| `GET /api/users/:username/quests?status=winner&page=1&limit=20` | Public | Registered-quest history. `status` may be `registered`, `cancelled`, `completed`, or `winner`. |
| `GET /api/users/:username/followers?page=1&limit=20` | Public | Paginated followers. |
| `GET /api/users/:username/following?page=1&limit=20` | Public | Paginated following. |
| `POST /api/users/:username/follow` | Bearer + completed onboarding | Follow another user. Returns `201` and creates a notification for them. |
| `DELETE /api/users/:username/follow` | Bearer + completed onboarding | Unfollow another user. Returns `200`. |
| `GET /api/users/:username/posts?type=thought&page=1&limit=20` | Public | List only one user’s posts; omit `type` for all types. |

Example public URL:

```http
GET {{baseUrl}}/api/users/{{targetUsername}}/profile
```

## Posts, reels, thoughts, likes, and comments

| Method and URL | Login? | Usage |
| --- | --- | --- |
| `GET /api/posts?page=1&limit=20&type=thought` | Public | Chronological public feed. `type` is optional: `image`, `reel`, or `thought`. |
| `POST /api/posts` | Bearer + completed onboarding | Create image post, reel, or thought. Returns `201`. |
| `GET /api/posts/:postId` | Public | Read one public post. |
| `PATCH /api/posts/:postId` | Bearer + completed onboarding | Owner only; edit `content`. Stamps `editedAt`, which stays set (no time limit on editing). |
| `DELETE /api/posts/:postId` | Bearer + completed onboarding | Owner only; removes post, comments, likes, and Cloudinary media. |
| `POST /api/posts/:postId/likes` | Bearer + completed onboarding | Like once. Returns `201`; repeated like is `409`. |
| `DELETE /api/posts/:postId/likes` | Bearer + completed onboarding | Remove own like. |
| `POST /api/posts/:postId/shares` | Bearer + completed onboarding | Share once. Returns `201`; repeated share is `409`. |
| `DELETE /api/posts/:postId/shares` | Bearer + completed onboarding | Remove own share. |
| `POST /api/posts/:postId/bookmarks` | Bearer + completed onboarding | Bookmark once. Returns `201`; repeated bookmark is `409`. |
| `DELETE /api/posts/:postId/bookmarks` | Bearer + completed onboarding | Remove own bookmark. |
| `GET /api/users/me/bookmarks?page=1&limit=20` | Bearer + completed onboarding | List my saved posts, newest bookmark first. |
| `GET /api/posts/:postId/comments?page=1&limit=20` | Public | Read public comments. |
| `POST /api/posts/:postId/comments` | Bearer + completed onboarding | Create a public 1–500 character comment. Returns `201`. |
| `DELETE /api/posts/:postId/comments/:commentId` | Bearer + completed onboarding | Comment author only. |

Create a thought: choose **raw → JSON**.

```json
{ "type": "thought", "content": "Getting ready for the next CosQuest!" }
```

Create image post: choose **form-data** (not raw JSON). Add text fields `type=image`, `content=Quest photos`, then add 1–8 `media` fields of type **File**.

Create reel: choose **form-data**. Add text fields `type=reel`, `content=My cosplay reveal`, then add exactly one `media` file. It must be MP4, MOV, or WEBM and 30 seconds or shorter.

Edit post body:

```json
{ "content": "Updated caption or updated thought text." }
```

Create comment body:

```json
{ "body": "This cosplay looks amazing!" }
```

## Chats (Community, faction rooms, and direct messages)

Every endpoint here is **Bearer + completed onboarding** - there is no pre-login/email-identified access, unlike the onboarding-step endpoints. There is no push/WebSocket layer; the client polls `GET .../messages` for new activity.

| Method and URL | Usage |
| --- | --- |
| `GET /api/chats` | "Your Space": the single Community room, my current faction's room, and every DM I'm part of. Each entry includes `unreadCount` and a `lastMessage` preview. |
| `POST /api/chats/dm` | Find-or-create a DM with `{ "username": "..." }`. Calling it again with the same username returns the same conversation, not a duplicate. |
| `GET /api/chats/:conversationId` | Room detail: title, member count, pinned message, and (for DMs) the other participant's presence (`lastActiveAt`). |
| `GET /api/chats/:conversationId/messages?page=1&limit=30` | Paginated, newest first. Each message includes its reactions and, for a DM, `read` (whether the recipient has seen it) on messages I sent. |
| `POST /api/chats/:conversationId/messages` | Send a message. `content` (text) and/or a single `media` file (image or voice note - MP3/M4A/WEBM/OGG/WAV) via multipart form-data; optional `replyTo` (a message id in the same conversation) to quote a message. |
| `PATCH /api/chats/:conversationId/messages/:messageId` | Sender-only. Edits `content`; stamps `editedAt`, which the message keeps showing forever afterward (no time limit on editing). |
| `DELETE /api/chats/:conversationId/messages/:messageId?scope=me` | Hides the message from **just the caller** - any time, no limit. Everyone else still sees it untouched. |
| `DELETE /api/chats/:conversationId/messages/:messageId?scope=everyone` | Sender-only, and only within **5 minutes** of sending. Replaces the message with a "This message was deleted." tombstone for every viewer. `scope` defaults to `me` if omitted. Neither scope ever removes the database row - only flags on it change, so the original content/media stay recoverable in the database even though the API stops returning them. |
| `PATCH /api/chats/:conversationId/read` | Marks the conversation read as of now, clearing my unread badge. |
| `PATCH /api/chats/:conversationId/pinned-message` | `{ "messageId": "..." }` to pin, or `{ "messageId": null }` to unpin. Any member can do this - there is no moderator role yet. |
| `POST /api/chats/:conversationId/messages/:messageId/reactions` | `{ "emoji": "😂" }` - one reaction per user per message; sending a new emoji replaces your old one. Returns `201` with the message's grouped reaction counts. |
| `DELETE /api/chats/:conversationId/messages/:messageId/reactions` | Remove my own reaction from the message. |

Faction-room access follows the user's **current** `faction` value live - there's no separate join/leave step, and switching factions moves you into the new faction's room automatically. A logged-in user who isn't in a given faction room gets `403` posting or reading there.

Send a text message:

```json
{ "content": "Yooo, anyone at Waterfront?" }
```

Reply to a message (form field alongside `content`, or JSON if there's no attachment):

```json
{ "content": "I can see you", "replyTo": "{{messageId}}" }
```

Send a voice note: choose **form-data**, add field `media` as a File (MP3/M4A/WEBM/OGG/WAV), leave `content` empty.

## Quests and registration

| Method and URL | Login? | Usage |
| --- | --- | --- |
| `GET /api/quests?lat=6.5244&lng=3.3792&radiusMiles=30&status=upcoming&limit=20` | Public | List published quests. Coordinates are optional; if supplied they filter/sort by distance. |
| `GET /api/quests/:questId` | Public | Read one published quest. |
| `POST /api/quests/:questId/registrations` | Bearer + completed onboarding | Register for an available upcoming/live quest. Returns `201`; paid quests return `paymentStatus: pending`. |
| `DELETE /api/quests/:questId/registrations` | Bearer + completed onboarding | Cancel the user’s active registration. Returns `200`. |

Quest registration has no raw body. First call `GET /api/quests`, copy a returned quest `id` to `{{questId}}`, then call the registration URL.

## Status-code guide

| Status | Meaning in this API |
| --- | --- |
| `200` | Successful read, update, login, logout, delete, or completion. |
| `201` | Successful new account, follow, post, comment, like, or quest registration. |
| `302` | Normal OAuth browser redirect. |
| `400` | Missing/invalid body, invalid option, invalid upload, or validation failure. |
| `401` | Missing, invalid, logged-out, or expired Bearer token. |
| `403` | Logged in but onboarding incomplete, or trying to edit/delete another user’s content. |
| `404` | User, quest, post, comment, or route does not exist. |
| `409` | An already-onboarded email/username re-signing up, or a duplicate follow/like/share/bookmark/registration, or an unavailable/full quest. (Re-signing up with an *incomplete* email/username resumes instead - see signup above.) |
| `503` | Cloudinary or OAuth provider configuration is missing. |

