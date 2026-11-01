# CosQuest Backend — API

> Current signup, comments/replies, chat links/files, Spotlight, and Settings contract: [COMMUNITY_SETTINGS_API.md](../COMMUNITY_SETTINGS_API.md). That guide supersedes older examples and deferred-feature notes below for these features.

Projects, subject files, linked Sparks and scheduled calls are documented in [PROJECTS_AND_SCHEDULING.md](../PROJECTS_AND_SCHEDULING.md). Run `npm run test:planning` for their focused integration tests.

If this backend already has a MongoDB database from before username-only registration was added, run `npm run migrate:username-signup` once before deploying. It safely updates the unique email index so multiple accounts without an email are allowed.

Login sessions do not expire on a timer. They stay active until the user logs out, at which point every previous token for that account is invalidated; the next sign-in issues a fresh token.

The dashboard uses the fixed area last configured by `DASHBOARD_DEFAULT_LAT`, `DASHBOARD_DEFAULT_LNG`, and `DASHBOARD_RADIUS_MILES`. Users cannot view, save, or edit a personal location. To remove legacy personal location fields from an existing MongoDB database, run `npm run migrate:remove-user-location` once after deployment.

Preset avatar images are delivered only from Cloudinary; `GET /api/meta/avatars` returns their Cloudinary URLs. User-uploaded profile photos, image posts, and reels also go only to Cloudinary. Files are written to disk briefly while received, then deleted after Cloudinary upload—this backend does not serve or retain local media. Profile photos use `CLOUDINARY_PROFILE_PHOTO_FOLDER`; posts use `CLOUDINARY_POST_IMAGE_FOLDER` (default `cosquest/posts`) and reels use `CLOUDINARY_REEL_FOLDER` (default `cosquest/reels`). They all use the existing `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` values.

### Google and Apple OAuth

OAuth starts in the browser at `GET /api/auth/oauth/google` or `GET /api/auth/oauth/apple`. After provider verification, the backend redirects to `OAUTH_SUCCESS_REDIRECT_URL` with a short-lived `oauthCode`; the frontend must immediately send that code to `POST /api/auth/oauth/exchange` to receive the usual CosQuest token. First-time OAuth users are sent through onboarding (`onboardingRequired: true`). Configure the `GOOGLE_OAUTH_*`, `APPLE_OAUTH_*`, `OAUTH_SUCCESS_REDIRECT_URL`, and `OAUTH_COOKIE_SECRET` values in `.env` before using either button. Apple requires a public HTTPS callback URL.

Signup signs the user in immediately and returns a token. Save it and use Bearer authorization throughout onboarding. Completion unlocks the app using the same token; no extra login is needed. Returning users can also log in before completion and resume onboarding. Legacy identifier-based onboarding examples below remain supported.

### Sparks

Sparks (sub-conversations, in every chat including DMs) run on the `@cosquest/sparks-backend` module, vendored in `vendor/` and mounted in `src/sparks/`. Before the first deploy with it, run `npm run migrate:message-seq` once (numbers existing messages). Env vars, Render setup, upgrades, rollback (`SPARKS_ENGINE=legacy`) and what the app needs next: [SPARKS_INTEGRATION.md](SPARKS_INTEGRATION.md).

### Real-time: WebSockets + Redis

Chat (new/edited/deleted messages, reactions, read receipts, pins, typing), presence (online/offline for DM partners), and notifications push live over Socket.IO instead of requiring the client to poll. Requires `REDIS_URL` in `.env` (a local `redis-server` is enough for development); `npm test` doesn't need one, it spins up its own ephemeral Redis automatically. See `src/realtime/socket.js` and `src/realtime/presence.js`.

Connect with the same bearer token already used for REST:

```js
const socket = io('http://localhost:6893', { auth: { token }, transports: ['websocket'] });

socket.emit('conversation:join', conversationId, (ack) => {
  if (!ack.ok) console.error(ack.error); // same membership check as the REST endpoints
});

socket.on('message:new', ({ conversationId, message }) => { /* ... */ });
socket.on('message:edited', ({ conversationId, message }) => { /* ... */ });
socket.on('message:deleted', ({ conversationId, messageId, scope }) => { /* ... */ }); // scope is always 'everyone' - a 'me' delete has no one else to notify
socket.on('message:reaction', ({ conversationId, messageId, reactions }) => { /* [{emoji, userId}], not pre-counted - compute your own counts/"mine" locally */ });
socket.on('chat:read', ({ conversationId, userId, lastReadAt }) => { /* ... */ });
socket.on('chat:pinned', ({ conversationId, pinnedMessage }) => { /* pinnedMessage is null on unpin */ });
socket.on('chat:preview', ({ conversationId }) => { /* DM chat list changed - re-fetch GET /api/chats */ });
socket.on('typing:start', ({ conversationId, userId }) => { /* ... */ });
socket.on('typing:stop', ({ conversationId, userId }) => { /* ... */ });
socket.on('notification:new', (notification) => { /* same shape as GET /api/users/me/notifications */ });
socket.on('banner', ({ id, title, body, data, channel, actor, at }) => { /* app open: show an in-app banner (the push it replaces). data: { type, chatId?, messageId?, postId?, commentId?, scheduledCallId? }; see examples/expo-chat/InAppNotifications.js */ });
socket.on('presence:online', ({ userId }) => { /* a DM partner just connected */ });
socket.on('presence:offline', ({ userId, lastActiveAt }) => { /* a DM partner's last connection just closed; lastActiveAt drives "last seen" */ });
socket.on('call:incoming', ({ call, invitedBy, privateOf, privateOfType }) => { /* someone is calling you - show the ringing screen. privateOf is set for a private call (below) */ });
socket.on('call:updated', ({ call }) => { /* accepted/declined/missed/cancelled/ended - check call.status. call.members[].away: in a private call right now */ });
socket.on('voice:updated', ({ conversationId, voiceRoom }) => { /* who is in the voice chat (voiceRoom.members[].away as above); null when it closes */ });
socket.on('session:revoked', ({ reason }) => { /* 'signed_in_elsewhere': clear the token and go to login. 'password_changed'/'email_changed': reconnect with the new token from that response */ });

socket.emit('typing:start', conversationId); // and 'typing:stop' - ephemeral, never persisted
socket.emit('conversation:leave', conversationId);
```

**Private call on top.** Two people in a call or a voice chat (Community, faction or group) can step into a one-to-one call without leaving it: `POST /api/calls/:callId/private` or `POST /api/voice/:roomId/private` with `{ userId }` (both must be in it). It's a normal call in its own LiveKit room - `201 { call, token, livekitUrl }`, always audio to start, `call.privateOf` / `call.privateOfType` (`'call'` or `'voice'`) set - that rings only that person (`call:incoming` with `privateOf`), and is answered, declined and ended with the usual `/api/calls/:id/accept`, `/decline` and `/end`. While it's answered, the main call's or voice chat's `members[].away` is `true` for both, and both stay members of it (in a voice chat, time away counts as checking in). It keeps going if the main call ends. `409` if either person is already in a private call or on another call, or the other person isn't in the call/voice chat right now; nobody can be added to a private call. Private calls stay out of Sparks (no transcript or outline) and leave no call entry in the chat.

Anyone who's deleted a specific message "for me" is transparently excluded from live pushes that would reveal it (edits, reactions, pins, replies to it) - same rule the REST endpoints already enforce, just kept honest in real time too.

Runs correctly today as a single server process. If this is ever deployed as more than one instance behind a load balancer, the Socket.IO Redis adapter (already wired up) is what keeps a message saved by one instance reaching a recipient connected to another.

## Endpoints

### Auth
| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/api/auth/signup` | public, rate-limited | `{ identifier, password, confirmPassword }` | `identifier` may be a unique email or username. A username becomes the profile username automatically; password must be 8+ characters with uppercase, lowercase, number, and special character; 10 req / 15 min / IP, else 429 |
| POST | `/api/auth/login` | public, rate-limited | `{ identifier, password }` (or legacy `{ email, password }`) | `identifier` may be the email or username; 401 on bad credentials; **403 if `onboardingComplete` is still false**; 10 req / 2 hours / IP, else 429 |
| POST | `/api/auth/logout` | Bearer token | — | bumps `tokenVersion`, invalidating this (and every other) existing token |

### Step 1 — Profile (every `/api/users/me*` route needs `Authorization: Bearer <token>`; signup and login both return one)
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/users/me` | — (Bearer) | full current user (no `passwordHash`) |
| PATCH | `/api/users/me/profile` | `{ email, firstName, lastName, username, age, gender, bio, category, showCategoryOnProfile }` | all fields optional/independent; bio is 500 characters max; category must come from the public category list; username 3-20 chars `[a-zA-Z0-9_]`, must be unique; age 13-120 |
| GET | `/api/users/check-username?username=` | — (public, rate-limited; Bearer optional) | `{ username, available }`; with a token your own current username reads as available |
| PATCH | `/api/users/me/avatar` | `{ email, avatar }` | `avatar` is a key from `GET /api/meta/avatars` (100 illustrated characters); clears any uploaded photo |
| POST | `/api/users/me/avatar/photo` | multipart: `photo` file | jpeg/png/webp/gif, 5MB max |
| GET | `/api/meta/avatars` | — (public) | the 100 illustrated avatar options (`key`, `label`, `imageUrl`) |
| GET | `/api/meta/profile-categories` | — (public) | searchable list for the Category picker |
| GET | `/api/users/me/contact` | Bearer token | the user's public contact details for editing |
| PATCH | `/api/users/me/contact` | `{ email, phone, businessAddress }` | saves public contact details; does not change the private login email |

### Step 2 — Faction
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/factions` | — (public) | the 6 factions (Ascendants, Icons, Controllers, Blockbusters, Everborns, Celestials) |
| POST | `/api/users/me/faction` | `{ email, factionKey }` | one of the 6 required faction keys |

### Step 3 — Interests
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/interests` | — (public) | the 12 interests |
| PUT | `/api/users/me/interests` | `{ email, interests: [key, ...] }` | replaces the full set; deduped, validated |

### Step 4 — Notification preferences
| Method | Path | Body | Notes |
|---|---|---|---|
| PATCH | `/api/users/me/preferences/notifications` | `{ email, notificationsEnabled }` | |
| POST | `/api/users/me/devices` | `{ pushToken, platform, voipToken?, voipType? }` (Bearer) | platform: `"ios" \| "android" \| "web"`; dedupes by token. `voipToken`/`voipType` (`APNS_VOIP` \| `FCM`): the call token, so calls ring on the phone's own call screen; the answer's `callRinging` is `native` or `push` (PUSH.md) |
| POST | `/api/users/me/onboarding/complete` | `{ email }` alone, or `{ email, profile, faction, interests, preferences }` | Requires a completed profile, avatar/photo, faction, at least one interest, and notification choice. One-shot submissions are atomic: nothing is saved if anything is invalid. The signup token unlocks the app after this succeeds. |

### Notifications (in-app inbox — Bearer token only, i.e. after login)
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/users/me/notifications` | — | this user's notifications, newest first |
| PATCH | `/api/users/me/notifications/read` | — | marks all of this user's unread notifications as read |

Every signup automatically creates one welcome notification for that account - since it's only reachable with a Bearer token, and login won't hand one out until onboarding is done, this is the very first thing they see right after their first successful login. Beyond that, sending a notification is done separately, via `npm run notify -- "message"` (see below) - there's no admin/broadcast endpoint yet, only a script, and it only reaches users who have `notificationsEnabled` on.

### Public profiles, follows, quest history, and points

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/users/:username/profile` | public | public profile, bio, optional displayed category, public contact details, faction, and follower/following/post/registered-quest/win/point counts |
| GET | `/api/users/:username/quests` | public | registered quest history; supports `?status=&page=&limit=` |
| GET | `/api/users/me/points` | Bearer token | current in-app points balance; starts at `0` until the points system awards points |
| POST | `/api/users/:username/follow` | Bearer token | follows the public profile and creates a follow notification for that person |
| DELETE | `/api/users/:username/follow` | Bearer token | unfollows the profile |
| GET | `/api/users/:username/followers` | public | paginated follower list |
| GET | `/api/users/:username/following` | public | paginated following list |

The Quest count means every quest that the user registered for. The future quest-management system can mark a registration as `completed` or `winner`; the public profile's Wins count is the number marked `winner`. There is intentionally no user-facing endpoint that lets somebody mark themselves as a winner.

### Posts, reels, thoughts, likes, and comments

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/posts` | public | public feed; supports `?type=image|reel|thought&page=&limit=` |
| GET | `/api/users/:username/posts` | public | one user's public posts; supports the same query options |
| POST | `/api/posts` | Bearer token | multipart/form-data: `type`, `content`, and `media` files |
| GET/PATCH/DELETE | `/api/posts/:postId` | GET public; edits require Bearer token | authors can edit text or delete their own post |
| POST/DELETE | `/api/posts/:postId/likes` | Bearer token | like or unlike; public responses include the like count |
| GET/POST | `/api/posts/:postId/comments` | GET public; POST Bearer token | read or add public comments |
| DELETE | `/api/posts/:postId/comments/:commentId` | Bearer token | comment author can delete their own comment |

An image post requires 1-8 JPEG/PNG/WEBP/GIF files (10MB each maximum). A reel requires exactly one MP4/MOV/WEBM file and Cloudinary verifies it is 30 seconds or shorter. A thought has no media and must contain 1-2,000 characters. Image/reel captions are optional and limited to 2,200 characters.

### Home Dashboard and quests

The Home Dashboard is available after login with `GET /api/home/dashboard` (Bearer token required). It returns the greeting/profile data, unread-notification count, closest live quest, nearby upcoming quests, and the user's registration state. Quests can also be listed with `GET /api/quests`, viewed with `GET /api/quests/:questId`, joined with `POST /api/quests/:questId/registrations`, and cancelled with `DELETE /api/quests/:questId/registrations` (the join/cancel calls require a Bearer token).

CosQuest has no sample quests: real quests and events are created in the admin dashboard (Quests & Events, see [QUESTS.md](QUESTS.md)). The old Lagos demo quests can be removed from a database with `node scripts/removeSeedQuests.js` (it lists what it would remove; `--yes` removes it). `DASHBOARD_DEFAULT_LAT`, `DASHBOARD_DEFAULT_LNG` and `DASHBOARD_RADIUS_MILES` in `.env` are the dashboard's fallback location for accounts without their own (see [.env.example](.env.example)).

## Usage examples (curl)

```bash
BASE_URL="http://localhost:6893"   # match this to your .env's PORT
EMAIL="alex@gmail.com"
```

### 1. Sign up

```bash
curl -s -X POST $BASE_URL/api/auth/signup \
  -H "Content-Type: application/json" \
  -d "{\"identifier\":\"$EMAIL\",\"password\":\"Quest@1234\",\"confirmPassword\":\"Quest@1234\"}"
```

```json
{
  "message": "Account created. Complete onboarding using your email, then log in.",
  "user": { "email": "alex@gmail.com", "onboardingComplete": false, "...": "..." }
}
```

### 2. Trying to log in now fails - onboarding isn't done yet

```bash
curl -s -X POST $BASE_URL/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"identifier\":\"$EMAIL\",\"password\":\"Quest@1234\",\"confirmPassword\":\"Quest@1234\"}"
```

```json
{ "error": "Please complete onboarding before logging in." }
```

### 3. Complete onboarding with the signup token

```bash
# TOKEN is the `token` from the signup response.
# Step 1: profile
curl -s -X PATCH $BASE_URL/api/users/me/profile \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"firstName\":\"Alex\",\"lastName\":\"Rivera\",\"username\":\"Ravencaller\",\"age\":24,\"gender\":\"Female\"}"

curl -s -X PATCH $BASE_URL/api/users/me/avatar \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"avatar\":\"green-knight\"}"

curl -s -X POST $BASE_URL/api/users/me/avatar/photo \
  -H "Authorization: Bearer $TOKEN" -F "photo=@/path/to/photo.jpg"

# Step 2: faction
curl -s $BASE_URL/api/factions

curl -s -X POST $BASE_URL/api/users/me/faction \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"factionKey\":\"ascendants\"}"

# Step 3: interests
curl -s $BASE_URL/api/interests

curl -s -X PUT $BASE_URL/api/users/me/interests \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"interests\":[\"anime\",\"comic\",\"cosplay\"]}"

# Step 4: notifications
curl -s -X PATCH $BASE_URL/api/users/me/preferences/notifications \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"notificationsEnabled\":true}"

curl -s -X POST $BASE_URL/api/users/me/devices \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"pushToken\":\"fcm-token-abc123\",\"platform\":\"web\"}"

# Finish
curl -s -X POST $BASE_URL/api/users/me/onboarding/complete \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{}"
```

### 4. Optional returning-user login — new signups already have a token

```bash
TOKEN=$(curl -s -X POST $BASE_URL/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Quest@1234\"}" | node -pe "JSON.parse(require('fs').readFileSync(0)).token")
```

**Success (200):**
```json
{
  "message": "Logged in successfully.",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "652f1a2b3c4d5e6f7a8b9c0d",
    "email": "alex@gmail.com",
    "onboardingComplete": true,
    "...": "..."
  }
}
```

**Native PowerShell** (not git-bash):
```powershell
$body = '{"email":"alex@gmail.com","password":"Quest@1234"}'
Invoke-RestMethod -Uri http://localhost:6893/api/auth/login -Method Post -ContentType "application/json" -Body $body
```

### 5. After login - Bearer token works everywhere `email` did, plus notifications/logout

```bash
# Any step 1-4 endpoint still works, now via Bearer token, for edits after onboarding
curl -s -X POST $BASE_URL/api/users/me/faction \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"factionKey":"controllers"}'

curl -s $BASE_URL/api/users/me -H "Authorization: Bearer $TOKEN"

# Logout (invalidates $TOKEN immediately)
curl -s -X POST $BASE_URL/api/auth/logout -H "Authorization: Bearer $TOKEN"
```

### Sending a notification to everyone who opted in

This is a script, not an API call - run it from the server machine (e.g. a cron job, or by hand):

```bash
npm run notify -- "A CosQuest just opened near you!"
```

It finds every user with `preferences.notificationsEnabled` on and drops the message into each of their accounts. Each person then sees it the next time their app calls (Bearer token required - i.e. only after they've onboarded and logged in):

```bash
curl -s $BASE_URL/api/users/me/notifications -H "Authorization: Bearer $TOKEN"

curl -s -X PATCH $BASE_URL/api/users/me/notifications/read -H "Authorization: Bearer $TOKEN"
```

This is the in-app half only - it doesn't push a real phone/browser alert when someone is outside the app (that needs Firebase/APNs, not yet wired up).

### One-shot onboarding (matches the front-end exactly)

The front-end doesn't call the step 1-4 endpoints individually — it collects everything into one local `state` object and submits it all together when the user taps "Enter CosQuest" (`finishOnb()`). `POST /api/users/me/onboarding/complete` accepts that same combined payload in a single call, using the signup Bearer token (legacy email identification also works):

```bash
curl -s -X POST $BASE_URL/api/users/me/onboarding/complete \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$EMAIL\",
    \"profile\": { \"firstName\":\"Alex\",\"lastName\":\"Rivera\",\"username\":\"Ravencaller\",\"age\":24,\"gender\":\"Female\",\"avatar\":\"green-knight\" },
    \"faction\": \"ascendants\",
    \"interests\": [\"anime\",\"comic\",\"cosplay\"],
    \"preferences\": { \"notificationsEnabled\": true }
  }"
```

If any field is invalid, nothing is saved — you get a `400` with an `errors` array listing every problem at once, and `onboardingComplete` stays `false` (so login keeps refusing too). The individual step endpoints above still work too, e.g. for editing a field after onboarding is already complete (that time, via Bearer token).
cosquest-backend/postman/CosQuest.postman_collection.json
