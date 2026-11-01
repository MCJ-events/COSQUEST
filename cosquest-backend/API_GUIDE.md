# CosQuest Backend — API Guide

> Current signup, comments/replies, chat links/files, Spotlight, and Settings contract: [COMMUNITY_SETTINGS_API.md](../COMMUNITY_SETTINGS_API.md). That guide supersedes older examples and deferred-feature notes below for these features.

Base URL: `http://localhost:6893` (match your `.env`'s `PORT`). Every response below is the **complete** object exactly as the codebase returns it (matches `src/models/User.js`'s schema field-for-field, run through `userModel.sanitize()`, which is why `passwordHash`/`tokenVersion`/`_id` never appear and `id` does instead).

Signup signs the user in immediately and returns a token. Save it and use Bearer authorization throughout onboarding. Completion unlocks the app using the same token; no extra login is needed. Returning users can also log in before completion and resume onboarding. Legacy identifier-based onboarding examples below remain supported.

Registration requires a unique, valid email address. Usernames are required during the profile step and are also unique without regard to letter case (for example, `Hero` and `hero` cannot both exist). Passwords must be at least eight characters and include an uppercase letter, lowercase letter, number, and special character.

Profile fields also include an optional editable `bio` (500 characters maximum), a category with a `showCategoryOnProfile` display switch, and every user has a `pointsBalance` which starts at `0`. Public profile APIs return only safe public information; they never return an account email address, age, or gender. A separately saved contact email is public because the Contact options screen has no visibility switches.

## Request validation (every endpoint)

Every route checks its input before the controller runs (express-validator; rules in `src/validators/<area>.js`, the shared helpers in `src/middleware/validate.js`). A refused request answers:

```json
{ "error": "<the first problem, ready to show>", "errors": [{ "field": "pushToken", "location": "body", "message": "..." }] }
```

- Status `400` for bad input. A malformed id in the path keeps the status and message it always had (usually `404 "<thing> not found."`).
- Messages are the same ones the endpoints gave before; `errors` lists every field that failed (the first one is `error`).
- Types are checked strictly: text must be a JSON string, lists arrays, switches real `true`/`false`, ids 24 hex characters. Stored text has a length limit (for example names 50, messages 2000, comments 500).
- Query values must be single values (`?limit=1&limit=2` is refused); paging values that were read leniently still fall back to their defaults.
- On every route: field names starting with `# CosQuest Backend — API Guide

> Current signup, comments/replies, chat links/files, Spotlight, and Settings contract: [COMMUNITY_SETTINGS_API.md](../COMMUNITY_SETTINGS_API.md). That guide supersedes older examples and deferred-feature notes below for these features.

Base URL: `http://localhost:6893` (match your `.env`'s `PORT`). Every response below is the **complete** object exactly as the codebase returns it (matches `src/models/User.js`'s schema field-for-field, run through `userModel.sanitize()`, which is why `passwordHash`/`tokenVersion`/`_id` never appear and `id` does instead).

Signup signs the user in immediately and returns a token. Save it and use Bearer authorization throughout onboarding. Completion unlocks the app using the same token; no extra login is needed. Returning users can also log in before completion and resume onboarding. Legacy identifier-based onboarding examples below remain supported.

Registration requires a unique, valid email address. Usernames are required during the profile step and are also unique without regard to letter case (for example, `Hero` and `hero` cannot both exist). Passwords must be at least eight characters and include an uppercase letter, lowercase letter, number, and special character.

Profile fields also include an optional editable `bio` (500 characters maximum), a category with a `showCategoryOnProfile` display switch, and every user has a `pointsBalance` which starts at `0`. Public profile APIs return only safe public information; they never return an account email address, age, or gender. A separately saved contact email is public because the Contact options screen has no visibility switches.

 (MongoDB operators such as `{"$ne": null}`) are refused with 400, a body that isn't valid JSON answers `400 "The request body is not valid JSON."`, and unexpected server errors answer `500 "Something went wrong on our side. Please try again."` without internal details.
- Validation runs after the login check (401) and before permission checks, so a malformed request gets 400 even from someone who couldn't do it anyway.

## Auth

**POST** `/api/auth/signup`
```json
{
  "identifier": "alex@gmail.com",
  "password": "Quest@1234",
  "confirmPassword": "Quest@1234"
}
```
`identifier` can instead be a username such as `Ravencaller`. When a username is used here, it is automatically saved as the profile username; it can later be edited from the user's profile.
Response — the current response additionally includes `token`, `onboardingRequired: true`, and `resumed: false`. Save the token for onboarding. The legacy user snapshot below omits those fields:
```json
{
  "message": "Account created. Complete onboarding using your email, then log in.",
  "user": {
    "email": "alex@gmail.com",
    "profile": {
      "firstName": "",
      "lastName": "",
      "username": "",
      "age": null,
      "gender": "",
      "avatarKey": "adventurer",
      "avatarPhotoUrl": null
    },
    "faction": null,
    "interests": [],
    "preferences": {
      "notificationsEnabled": false
    },
    "devices": [],
    "onboardingComplete": false,
    "createdAt": "2026-07-20T12:00:00.000Z",
    "updatedAt": "2026-07-20T12:00:00.000Z",
    "id": "652f1a2b3c4d5e6f7a8b9c0d"
  }
}
```
Signup also creates one welcome notification for the account automatically (unconditional - it doesn't wait for the `notificationsEnabled` preference, since that isn't chosen until onboarding step 4). It's only reachable with a Bearer token, and login won't hand one out until onboarding is done - so it's the very first thing they see right after their first successful login.

**POST** `/api/auth/login` — returning-user login also issues a token. Send the email or username in `identifier`; the legacy `email` field remains supported.
```json
{
  "identifier": "Ravencaller",
  "password": "Quest@1234"
}
```
**Success (200)** — only happens once `onboardingComplete` is `true`:
```json
{
  "message": "Logged in successfully.",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "email": "alex@gmail.com",
    "profile": {
      "firstName": "Alex",
      "lastName": "Rivera",
      "username": "Ravencaller",
      "age": 24,
      "gender": "Female",
      "avatarKey": "green-knight",
      "avatarPhotoUrl": null
    },
    "faction": "ascendants",
    "interests": ["anime", "comic", "cosplay"],
    "preferences": {
      "notificationsEnabled": true
    },
    "devices": [],
    "onboardingComplete": true,
    "createdAt": "2026-07-20T12:00:00.000Z",
    "updatedAt": "2026-07-20T12:09:00.000Z",
    "id": "652f1a2b3c4d5e6f7a8b9c0d"
  }
}
```
**Onboarding not finished yet (403)** — this is what you get instead, until `POST /api/users/me/onboarding/complete` has succeeded for this account:
```json
{
  "error": "Please complete onboarding before logging in."
}
```
**Wrong password / unknown email (401)**:
```json
{ "error": "Invalid email or password." }
```

**POST** `/api/auth/logout` — Bearer token required, no body
Response:
```json
{
  "message": "Logged out successfully.",
  "user": { "...": "same complete user object as above" }
}
```

## Step 1 — Profile

**GET** `/api/users/me` with `Authorization: Bearer <token>` (signup and login both return the token; every `/api/users/me*` route requires it, and an email or username is never accepted in its place)
Response:
```json
{
  "user": {
    "email": "alex@gmail.com",
    "profile": {
      "firstName": "",
      "lastName": "",
      "username": "",
      "age": null,
      "gender": "",
      "avatarKey": "adventurer",
      "avatarPhotoUrl": null
    },
    "faction": null,
    "interests": [],
    "preferences": {
      "notificationsEnabled": false
    },
    "devices": [],
    "onboardingComplete": false,
    "createdAt": "2026-07-20T12:00:00.000Z",
    "updatedAt": "2026-07-20T12:00:00.000Z",
    "id": "652f1a2b3c4d5e6f7a8b9c0d"
  }
}
```

**PATCH** `/api/users/me/profile`
```json
{
  "email": "alex@gmail.com",
  "firstName": "Alex",
  "lastName": "Rivera",
  "username": "Ravencaller",
  "age": 24,
  "gender": "Female"
}
```
Response:
```json
{
  "user": {
    "email": "alex@gmail.com",
    "profile": {
      "firstName": "Alex",
      "lastName": "Rivera",
      "username": "Ravencaller",
      "age": 24,
      "gender": "Female",
      "avatarKey": "adventurer",
      "avatarPhotoUrl": null
    },
    "faction": null,
    "interests": [],
    "preferences": {
      "notificationsEnabled": false
    },
    "devices": [],
    "onboardingComplete": false,
    "createdAt": "2026-07-20T12:00:00.000Z",
    "updatedAt": "2026-07-20T12:01:00.000Z",
    "id": "652f1a2b3c4d5e6f7a8b9c0d"
  }
}
```

**GET** `/api/users/check-username?username=Ravencaller` (public, rate-limited; with a Bearer token your own current username reads as available)
Response:
```json
{
  "username": "Ravencaller",
  "available": true
}
```

**PATCH** `/api/users/me/avatar`
```json
{
  "email": "alex@gmail.com",
  "avatar": "green-knight"
}
```
Response:
```json
{
  "user": {
    "email": "alex@gmail.com",
    "profile": {
      "firstName": "Alex",
      "lastName": "Rivera",
      "username": "Ravencaller",
      "age": 24,
      "gender": "Female",
      "avatarKey": "green-knight",
      "avatarPhotoUrl": null
    },
    "faction": null,
    "interests": [],
    "preferences": {
      "notificationsEnabled": false
    },
    "devices": [],
    "onboardingComplete": false,
    "createdAt": "2026-07-20T12:00:00.000Z",
    "updatedAt": "2026-07-20T12:02:00.000Z",
    "id": "652f1a2b3c4d5e6f7a8b9c0d"
  }
}
```

**POST** `/api/users/me/avatar/photo` — not JSON, form-data: a file field named `photo`, plus an `email` field
Response:
```json
{
  "user": {
    "email": "alex@gmail.com",
    "profile": {
      "firstName": "Alex",
      "lastName": "Rivera",
      "username": "Ravencaller",
      "age": 24,
      "gender": "Female",
      "avatarKey": "green-knight",
      "avatarPhotoUrl": "http://localhost:6893/uploads/3f9c1a2e-8b4d-4a11-9c2e-7d6f5a3b2c1d.jpg"
    },
    "faction": null,
    "interests": [],
    "preferences": {
      "notificationsEnabled": false
    },
    "devices": [],
    "onboardingComplete": false,
    "createdAt": "2026-07-20T12:00:00.000Z",
    "updatedAt": "2026-07-20T12:03:00.000Z",
    "id": "652f1a2b3c4d5e6f7a8b9c0d"
  }
}
```

**GET** `/api/meta/avatars` — public, no body (100 illustrated characters, not emoji - each `key` is what you send to `PATCH /api/users/me/avatar`)
Response (truncated to 2 of 100 for brevity):
```json
{
  "avatars": [
    { "key": "adventurer", "label": "Adventurer", "imageUrl": "https://res.cloudinary.com/your-cloud/image/upload/example.png" },
    { "key": "sky-guardian", "label": "Sky Guardian", "imageUrl": "https://res.cloudinary.com/your-cloud/image/upload/example.png" }
  ]
}
```

## Step 2 — Faction

**GET** `/api/factions` — public, no body
Response:
```json
{
  "factions": [
    { "key": "ascendants", "name": "Ascendants", "color": "#8B5CF6", "description": "Ambitious challengers who rise through courage, growth, and relentless determination." },
    { "key": "icons", "name": "Icons", "color": "#EC4899", "description": "Bold trendsetters whose creativity, presence, and style leave a lasting mark." },
    { "key": "controllers", "name": "Controllers", "color": "#06B6D4", "description": "Calculated strategists who master every challenge through skill, focus, and precision." },
    { "key": "blockbusters", "name": "Blockbusters", "color": "#F97316", "description": "Big-energy adventurers who thrive on action, spectacle, and unforgettable moments." },
    { "key": "everborns", "name": "Everborns", "color": "#22C55E", "description": "Resilient spirits who adapt, endure, and return stronger after every challenge." },
    { "key": "celestials", "name": "Celestials", "color": "#EAB308", "description": "Visionary explorers drawn to discovery, imagination, and limitless possibilities." }
  ]
}
```

**POST** `/api/users/me/faction`
```json
{
  "email": "alex@gmail.com",
  "factionKey": "ascendants"
}
```
Response:
```json
{
  "user": {
    "email": "alex@gmail.com",
    "profile": {
      "firstName": "Alex",
      "lastName": "Rivera",
      "username": "Ravencaller",
      "age": 24,
      "gender": "Female",
      "avatarKey": "green-knight",
      "avatarPhotoUrl": "http://localhost:6893/uploads/3f9c1a2e-8b4d-4a11-9c2e-7d6f5a3b2c1d.jpg"
    },
    "faction": "ascendants",
    "interests": [],
    "preferences": {
      "notificationsEnabled": false
    },
    "devices": [],
    "onboardingComplete": false,
    "createdAt": "2026-07-20T12:00:00.000Z",
    "updatedAt": "2026-07-20T12:04:00.000Z",
    "id": "652f1a2b3c4d5e6f7a8b9c0d"
  }
}
```

## Step 3 — Interests

**GET** `/api/interests` — public, no body
Response:
```json
{
  "interests": [
    { "key": "anime", "name": "Anime & Manga" },
    { "key": "comic", "name": "Comics" },
    { "key": "movie", "name": "Movies & TV" },
    { "key": "game", "name": "Video Games" },
    { "key": "toon", "name": "Cartoons" },
    { "key": "scifi", "name": "Sci-Fi" },
    { "key": "fantasy", "name": "Fantasy" },
    { "key": "horror", "name": "Horror" },
    { "key": "cosplay", "name": "Cosplay & Props" },
    { "key": "sports", "name": "Sports" },
    { "key": "music", "name": "Music" },
    { "key": "news", "name": "News & Politics" }
  ]
}
```

**PUT** `/api/users/me/interests`
```json
{
  "email": "alex@gmail.com",
  "interests": ["anime", "comic", "cosplay"]
}
```
Response:
```json
{
  "user": {
    "email": "alex@gmail.com",
    "profile": {
      "firstName": "Alex",
      "lastName": "Rivera",
      "username": "Ravencaller",
      "age": 24,
      "gender": "Female",
      "avatarKey": "green-knight",
      "avatarPhotoUrl": "http://localhost:6893/uploads/3f9c1a2e-8b4d-4a11-9c2e-7d6f5a3b2c1d.jpg"
    },
    "faction": "ascendants",
    "interests": ["anime", "comic", "cosplay"],
    "preferences": {
      "notificationsEnabled": false
    },
    "devices": [],
    "onboardingComplete": false,
    "createdAt": "2026-07-20T12:00:00.000Z",
    "updatedAt": "2026-07-20T12:05:00.000Z",
    "id": "652f1a2b3c4d5e6f7a8b9c0d"
  }
}
```

## Step 4 — Notifications

**PATCH** `/api/users/me/preferences/notifications`
```json
{
  "email": "alex@gmail.com",
  "notificationsEnabled": true
}
```
Response:
```json
{
  "user": {
    "email": "alex@gmail.com",
    "profile": {
      "firstName": "Alex",
      "lastName": "Rivera",
      "username": "Ravencaller",
      "age": 24,
      "gender": "Female",
      "avatarKey": "green-knight",
      "avatarPhotoUrl": "http://localhost:6893/uploads/3f9c1a2e-8b4d-4a11-9c2e-7d6f5a3b2c1d.jpg"
    },
    "faction": "ascendants",
    "interests": ["anime", "comic", "cosplay"],
    "preferences": {
      "notificationsEnabled": true
    },
    "devices": [],
    "onboardingComplete": false,
    "createdAt": "2026-07-20T12:00:00.000Z",
    "updatedAt": "2026-07-20T12:07:00.000Z",
    "id": "652f1a2b3c4d5e6f7a8b9c0d"
  }
}
```

**POST** `/api/users/me/devices` (Bearer). `voipToken` / `voipType` (`APNS_VOIP` on iPhones, `FCM` on Android) are optional: the call token from expo-callkit-telecom, so calls ring on the phone's own call screen; `voipToken: null` takes it off. The response also has `callRinging`: `"native"` or `"push"` (PUSH.md, Ringing).
```json
{
  "pushToken": "ExponentPushToken[abc123]",
  "platform": "ios",
  "voipToken": "5f1d...apns-voip-token",
  "voipType": "APNS_VOIP"
}
```
Response:
```json
{
  "user": {
    "email": "alex@gmail.com",
    "profile": {
      "firstName": "Alex",
      "lastName": "Rivera",
      "username": "Ravencaller",
      "age": 24,
      "gender": "Female",
      "avatarKey": "green-knight",
      "avatarPhotoUrl": "http://localhost:6893/uploads/3f9c1a2e-8b4d-4a11-9c2e-7d6f5a3b2c1d.jpg"
    },
    "faction": "ascendants",
    "interests": ["anime", "comic", "cosplay"],
    "preferences": {
      "notificationsEnabled": true
    },
    "devices": [
      { "pushToken": "fcm-token-abc123", "platform": "web", "registeredAt": "2026-07-20T12:08:00.000Z" }
    ],
    "onboardingComplete": false,
    "createdAt": "2026-07-20T12:00:00.000Z",
    "updatedAt": "2026-07-20T12:08:00.000Z",
    "id": "652f1a2b3c4d5e6f7a8b9c0d"
  }
}
```

**POST** `/api/users/me/onboarding/complete` — unlocks the app using the existing signup token

Two ways to call this, both valid with the signup token; legacy email examples below are also supported:

1. **`email`-only**, after already calling the individual step endpoints above one by one (as shown through this guide) — just flips `onboardingComplete` to `true`.
2. **One-shot**, matching the front-end exactly: nothing is saved while a user clicks through onboarding steps 1-4 in the app — everything sits in the client's local `state` until they tap "Enter CosQuest," which fires once, all together. This endpoint accepts that same combined payload in a single call:

```json
{
  "email": "alex@gmail.com",
  "profile": { "firstName": "Alex", "lastName": "Rivera", "username": "Ravencaller", "age": 24, "gender": "Female", "avatar": "green-knight" },
  "faction": "ascendants",
  "interests": ["anime", "comic", "cosplay"],
  "preferences": { "notificationsEnabled": true }
}
```

Every field is validated exactly like its individual endpoint (username format/uniqueness, valid faction key, valid interest keys, valid avatar key). Completion additionally requires first name, last name, username, age, gender, an avatar or photo, a faction, at least one interest, and an explicit notification choice. The submission is **one atomic unit**: if anything is invalid, nothing is saved, `onboardingComplete` stays `false`, and login keeps refusing too. (`avatar` maps to `avatarKey`; the photo upload stays its own separate multipart endpoint since a file can't ride along in this JSON body.)

Response (same either way - the full user, now onboarded, ready to log in):
```json
{
  "message": "Onboarding complete.",
  "user": {
    "email": "alex@gmail.com",
    "profile": {
      "firstName": "Alex",
      "lastName": "Rivera",
      "username": "Ravencaller",
      "age": 24,
      "gender": "Female",
      "avatarKey": "green-knight",
      "avatarPhotoUrl": null
    },
    "faction": "ascendants",
    "interests": ["anime", "comic", "cosplay"],
    "preferences": {
      "notificationsEnabled": true
    },
    "devices": [],
    "onboardingComplete": true,
    "createdAt": "2026-07-20T12:00:00.000Z",
    "updatedAt": "2026-07-20T12:09:00.000Z",
    "id": "652f1a2b3c4d5e6f7a8b9c0d"
  }
}
```

**Invalid one-shot payload (400)** — e.g. a bad username and an unknown faction key together:
```json
{
  "error": "profile.username must be 3-20 characters: letters, numbers, underscore only. faction must be one of the values from GET /api/factions.",
  "errors": [
    "profile.username must be 3-20 characters: letters, numbers, underscore only.",
    "faction must be one of the values from GET /api/factions."
  ]
}
```

## Notifications (Bearer token only - i.e. after login)

Two ways a notification ends up in someone's account:
1. **Automatically at signup** — every new account gets one welcome notification the moment it's created (see the Auth section above). This one is unconditional, not tied to the `notificationsEnabled` preference.
2. **Manually, via the broadcast script** — `npm run notify -- "message"` on the server drops that message into the account of every user who currently has `preferences.notificationsEnabled` on. There's no API endpoint for this, only the script.

Either way, these two endpoints (Bearer token required, so only reachable once onboarding is done and login has succeeded) are how the app reads them back.

**GET** `/api/users/me/notifications` — no body
Response (right after first login, before any broadcast):
```json
{
  "notifications": [
    {
      "id": "652f1a2b3c4d5e6f7a8b9c1a",
      "message": "🎉 Welcome to CosQuest! 🥷✨ Your account is officially live. This is your new home for everything you love — real-world quests, your faction, your people, all in one place. 🗺️💜 So glad you're here — let's go make some legendary memories. 🏆",
      "read": false,
      "createdAt": "2026-07-23T09:00:00.000Z"
    }
  ]
}
```

**PATCH** `/api/users/me/notifications/read` — no body, marks every unread notification for this user as read
Response:
```json
{
  "message": "Notifications marked as read."
}
```

Follow notifications appear in the same inbox with `"type": "follow"` and an `actor` containing the follower's public profile preview (one per person per day, so follow/unfollow/follow doesn't notify again).

Post activity is in the same inbox, live (`notification:new`) and as a push (the "Friend activity" setting). Each has `postId` (and `commentId` for comments) to open; never about yourself, never across a block, never twice for the same thing (like, unlike, like = one):

| `type` | When | Who gets it | Message |
|---|---|---|---|
| `like` | A post is liked | The post's author | "Bea liked your post." |
| `like` (with `commentId`) | A comment is liked | The commenter | "Bea liked your comment." |
| `comment` | A comment on a post | The post's author | "Bea commented on your post: \"I'll be there\"" |
| `comment` | A reply to a comment | The person replied to (and the post's author, if someone else) | "Cal replied to your comment: \"Same\"" |
| `repost` | A post is reposted (share to feed, or the share count) | The post's author | "Bea reposted your post." |
| `post` | Someone you follow posts or reposts | Their followers who may see their posts (everyone for a public profile; mutual followers for friends-only or "Show Activity Feed" off; nobody for a private profile) | "Author posted a new thought: \"Meet at the mural\"", "Bea reposted Author's post." |

Deleting a post removes its notifications. Push data: `{ type, postId, commentId? }`.

## Public profile, follows, quest history, and points

All profiles are public for now. Their public response intentionally excludes email address, age, gender, location, notification preferences, and devices.

**GET** `/api/users/Ravencaller/profile` — public, no body

```json
{
  "profile": {
    "id": "652f1a2b3c4d5e6f7a8b9c0d",
    "username": "Ravencaller",
    "name": "Alex Rivera",
    "avatarKey": "green-knight",
    "avatarPhotoUrl": null,
    "faction": "ascendants",
    "bio": "Building a community around cosplay and creative experiments.",
    "category": "digital-creator",
    "contact": { "email": "hello@example.com", "phone": "+2348148327836", "businessAddress": "14 CosQuest Way, Lagos" },
    "stats": { "followers": 12, "following": 4, "posts": 8, "quests": 3, "wins": 1, "points": 480 }
  }
}
```

**GET** `/api/meta/profile-categories` is public and returns the searchable category list. **PATCH** `/api/users/me/profile` also accepts `"bio"`, `"category"` (one of those category keys), and `"showCategoryOnProfile"` (boolean). Bio is optional and limited to 500 characters.

**GET** `/api/users/me/contact` and **PATCH** `/api/users/me/contact` require a Bearer token. Patch accepts any combination of:

```json
{ "email": "hello@example.com", "phone": "+2348148327836", "businessAddress": "14 CosQuest Way, Lagos" }
```

The contact email is public and does not update the account/login email. Phone numbers must be in international format; business addresses are limited to 250 characters.

**GET** `/api/users/me/points` — Bearer token required

```json
{ "points": 0 }
```

Points start at zero. This endpoint only reads the balance; the future points/rewards system is responsible for awarding or deducting them.

**GET** `/api/users/Ravencaller/quests?status=registered&page=1&limit=20` — public

Returns the user's quest registrations, newest first. Omit `status` for all; allowed values are `registered`, `cancelled`, `completed`, and `winner`. The Profile Quest count means every quest the user registered for. The future quest-management system, not the user, is responsible for marking a registration as `winner`.

**POST** `/api/users/Ravencaller/follow` — Bearer token required, no body

Follows the public profile and notifies Ravencaller. Answers at once with the new counts, so the button and the numbers can change without asking for the profile again:

```json
{ "message": "Following profile.", "following": true, "followerCount": 13, "followingCount": 5 }
```

`followerCount` is Ravencaller's, `followingCount` yours. `201` the first time, `200` if you already follow them (a double tap is not an error). `DELETE` on the same path unfollows, with the same counts and `"following": false` (also `200` if you didn't follow them).

Signed in, `GET /api/users/:username/profile` includes `"relationship": { "following": true, "followedBy": false }` (do you follow them, do they follow you; `null` on your own profile or signed out), and every row of the followers/following lists has the same `relationship`.

**GET** `/api/users/Ravencaller/followers?page=1&limit=20` and **GET** `/api/users/Ravencaller/following?page=1&limit=20` are public paginated lists.

## Posts, reels, thoughts, likes, and comments

**Your state on each post.** Signed in, every post (`GET /api/posts`, `GET /api/posts/:postId`, `GET /api/users/:username/posts`, bookmarks) has `"viewer": { "liked": true, "bookmarked": false, "reposted": false }`, so hearts and bookmark icons show filled straight away. Signed out there is no `viewer`.

**Likes and bookmarks.** `POST` / `DELETE /api/posts/:postId/likes` → `{ liked, likeCount }`; `POST` / `DELETE /api/posts/:postId/bookmarks` → `{ bookmarked, bookmarkCount }`. Repeating one (a double tap, a retry) is not an error: `200` with the same state. Bookmarks are stored per person (`PostBookmark`) and listed newest first with **GET** `/api/users/me/bookmarks?page=1&limit=20` → `{ posts, pagination }` (Bearer token; only you see your bookmarks).


**POST** `/api/posts` — Bearer token required; use `multipart/form-data`.

| Type | Required fields | Rules |
|---|---|---|
| `image` | `type=image`, one or more `media` files | 1-8 JPEG, PNG, WEBP, or GIF files; maximum 10MB each |
| `reel` | `type=reel`, one `media` file | exactly one MP4, MOV, or WEBM; Cloudinary must report 30 seconds or shorter |
| `thought` | `type=thought`, `content` | no media; content must be 1-2,000 characters |

`content` is optional for image posts/reels (a caption) and limited to 2,200 characters. Uploaded image posts go to `CLOUDINARY_POST_IMAGE_FOLDER` (default `cosquest/posts`); reels go to `CLOUDINARY_REEL_FOLDER` (default `cosquest/reels`). The existing Cloudinary credentials are used—no frontend Cloudinary secret is needed.

Public reads:

- `GET /api/posts?type=&page=&limit=` — public feed.
- `GET /api/users/:username/posts?type=&page=&limit=` — profile posts.
- `GET /api/posts/:postId` — one post.
- `GET /api/posts/:postId/comments?page=&limit=` — public comments.

Authenticated interactions:

- `PATCH` or `DELETE /api/posts/:postId` — post author only.
- `POST` or `DELETE /api/posts/:postId/likes` — like/unlike; responses include the public `likeCount`.
- `POST /api/posts/:postId/comments` with `{ "body": "..." }` — add a public 1-500 character comment.
- `DELETE /api/posts/:postId/comments/:commentId` — comment author only.


## Sparks (sub-conversations in every chat, DMs included)

A Spark is a sub-conversation detected in the main chat (3+ messages from 2+ people on one subject within ~2 minutes) or started by hand. Since the Sparks module (`@cosquest/sparks-backend`, see [SPARKS_INTEGRATION.md](SPARKS_INTEGRATION.md)) the detection, sorting and summaries run on members' phones through the Sparks SDK, and Sparks exist in Community, faction rooms, groups **and DMs**. All endpoints need login. Spark ids are strings like `spk_3f2a...` (no longer ObjectIds).

- `GET /api/chats/:conversationId/sparks` — `{ sparks, canManage }`. Active (pulsing) first, pinned ones first among them, then quiet cards. Each Spark keeps the old fields and adds `state` (`active`/`dormant`), `revivalIndex`, `seams` (`fold`/`labeled`), `summaryStale`, `participantIds`, `version`, and `rolePings`: `[{ role, userIds, at }]`, the roles the Sparks module pinged for it (a mention notification each), newest first, the last 10 (`[]` when none).
- `GET /api/chats/:conversationId/sparks/native` — the module's own Spark objects (the SDK's `Spark` type), for web clients.
- `GET /api/chats/:conversationId/sparks/members` — `{ members: [{ userId, displayName, roles, isAdmin }] }`, the chat's members as Sparks sees them (roles = expertise labels), for the app's `sdk.sparks.setMembers`.
- `GET /api/chats/:conversationId/sparks/:sparkId` — side panel: `{ spark, messages, seams, canManage }`. `messages` are the latest 500, oldest first, with reactions; `seams` are `[{ beforeMessageId, label }]` for long silences ("5 weeks later").
- `POST /api/chats/:conversationId/sparks` with `{ messageId, subject (2-60; stored up to 48), force? }` — start a Spark from a message. `409 { code: "similar_sparks", matches }` if similar ones exist (resend with `force: true` to start a new one anyway); `409 { code: "already_in_spark" }` if the message is already in one.
- `POST /api/chats/:conversationId/sparks/:sparkId/messages` with `{ messageId }` — add a message to a Spark.
- `PATCH .../sparks/:sparkId/pin` with `{ pinned }`, `DELETE .../sparks/:sparkId`, `POST .../sparks/:sparkId/merge` with `{ intoSparkId }` — group owners/admins, and both people in a DM (Community and faction rooms have no admins yet). Deleting leaves the messages in the main chat, unmarked; merging moves them into the other Spark.
- `POST /api/chats/:conversationId/messages` with an extra `sparkId` — reply from inside a Spark (revives it if it was quiet).
- `GET /api/calls/:callId/outline` — the post-call outline (people who were on the call, and chat admins): `{ status: "pending"|"ready", outline }`. Works for voice chats too (below).
- **Sparks in voice chats** (Community and faction rooms). A voice chat is a Sparks call: its Sparks call id is `voiceRoom.id` (from `POST /api/chats/:conversationId/voice/join`), its chat is the room. The app does what it does in a call: show the notice, `recordConsent`, `startTranscription({ callId: voiceRoom.id, chatId: conversationId, callStartedAt: voiceRoom.startedAt, commands: false })`. Every endpoint below and `.../outline` take a call id or a voice chat id. `GET /api/calls/:voiceRoomId/command-context` answers `{ canIssue: false }` (nobody is an admin of a Community or faction room).
- **Voice chat ended entry.** When a voice chat closes (Community, faction or group), a message is posted in its chat so its Sparks notes can be reopened later: `kind: "call"`, sent by whoever started the voice chat, with `callLog: { callId: <voice chat id>, type: "audio", status: "ended", durationSeconds, callerId, groupCall: true, participantCount, voiceChat: true }`. It arrives as `message:new`; the chat list preview is "🎙️ Voice chat". `callLog.callId` is the voice chat id, so `GET /api/calls/:callId/outline` opens its outline. One entry per voice chat; `participantCount` counts everyone who was in it (`null` for voice chats that started before this was tracked).
- `GET /api/calls/:callId/transcript?cursor=&limit=` — the full transcript, same access as the outline (people who were on it, and chat admins; `403` otherwise). `{ callId, chatId, kind: "call"|"voice_room", status: "active"|"ended"|"outlining"|"ready", startedAt, endedAt, segments: [{ segmentId, userId, startMs, endMs, text, locale, confidence?, topicId }], topics: [{ topicId, title, colorIndex, startedAtMs, returning }], speakers: { [userId]: { id, username, name, avatarKey, avatarPhotoUrl } }, nextCursor }`. Final lines only, in call order; times are ms since `startedAt`; `topicId` is the live topic the line fell under (`null` before the first). `limit` 1-500 (default 200); pass `nextCursor` back as `cursor` until it is `null`. Only people who accepted the transcription notice are ever in it. `400` bad cursor, `404` unknown id.
- `POST /api/calls/:callId/outline/share` — post the finished outline into the call's chat (the DM, or the voice chat's room). People who were on it and are in the chat, and chat admins. `201 { shared: true, post, message }` the first time, then `200 { shared: false, post, message }` with the same message for everyone (once per call). `message` is the new chat message (`kind: "sparks_bot"`, `sparksBot.kind: "call_outline"`, below), also sent as `message:new`. `409` the outline is not ready yet, `404` no outline (nobody on it had transcription on) or unknown id, `403` not allowed.
- Manage Sparks (M31; owners/admins, both people in a DM; needs Sparks module 1.3). `GET /api/chats/:conversationId/sparks/merge-suggestions` — `{ suggestions: [{ id, sourceSpark, targetSpark, score, reason, method, status, createdAt }], canManage }`: Sparks the bot thinks are the same subject, best first; nothing merges on its own. `POST .../sparks/merge-suggestions/:id/accept` merges it (`{ spark, mergedSparkIds }`), `POST .../dismiss` drops it for good (`{ dismissed: true }`); `409 { code: "already_decided" }` if someone already did. `POST /api/chats/:conversationId/sparks/merge` with `{ sourceSparkIds: [...], intoSparkId }` merges up to 20 Sparks into one, all or nothing. Admins get `spark:merge_suggested { conversationId, suggestion }` and a bell notification when a merge is proposed.
- Search inside one Spark (M16; module 1.3). `GET /api/chats/:conversationId/sparks/:sparkId/search?q=&era=&page=&limit=` — every message of the Spark across its eras (merged-in ones too), newest first; `q` optional (2-100), `era` optional (0 = first conversation). `{ query, spark, resolvedFrom, eras, results: [{ message, context: { label, sparkId, sparkSubject, era, eraStartedAt } }], pagination }`. `GET .../sparks/:sparkId/messages/:messageId/context?size=12` — the Spark conversation around a result: `{ targetId, sparkId, era, messages, seams, hasOlder, hasNewer }`.
- Voice commands ("calling all Back-end"). `GET /api/calls/:callId/command-context` — `{ canIssue, ranks, roles, groups, members }` for the SDK's `CommandContext`. A confirmed command rings the targets into the leader's call (normal invite rules: blocks, busy, limits; batches of 50) or starts a new call; targets get `call:incoming`, the leader gets `sparks:targeted_call { commandId, callId, started, invited, skipped: [{ userId, reason }] }`.

Every message has `seq` (per-chat sequence number) and `spark`: `null` or `{ id, era, postedInSpark }` (`era` = the Spark's revival index when the message joined). Socket events in the conversation room: `spark:updated { conversationId, spark }`, `spark:messages { conversationId, sparkId, era, messageIds }`, `spark:deleted { conversationId, sparkId, mergedInto? }`. Apps with the SDK also get the module's own protocol on the `sparks` socket event.

**Sparks bot posts** (module engine only). The Sparks bot adds messages of `kind: "sparks_bot"` to the chat: `sender` is `{ id: "sparks-bot", username: "sparks-bot", name: "Sparks bot", displayName: "Sparks bot", isBot: true, ... }`, `content` is a plain headline, and `sparksBot` is the post to render: `{ kind: "role_pings", sparkId, revivalIndex, subject, headline, pings: [{ role, userIds, mode: "automatic"|"suggested", status: "notified"|"pending"|"dismissed", confidence, decidedBy?, decidedAt? }] }` ("Relevant expertise: Front-end and Back-end.") or `{ kind: "earlier_context", sparkId, subject, headline, relatedSparkId, quotes: [{ messageId, seq, senderId, sentAt, text }], jumpToMessageId, score, method }` ("Earlier context: Route preview"; quotes are filtered to what the viewer can read, `[]` means hide the post) or `{ kind: "call_outline", callId, callKind: "call"|"voice_room", headline, title, summary, startedAt, endedAt, topics: [{ topicId, title, colorIndex, summary, decisions, actionItems: [{ text, ownerUserId? }] }], speakerIds, sharedBy, sharedAt }` ("Call outline: Quest board and travel", from `POST /api/calls/:callId/outline/share`; tapping it opens the outline with `GET /api/calls/:callId/outline`, which only people who were on it can read). They arrive on `message:new` and change on `message:edited`, have a `seq`, can be replied to, reacted to and deleted "for me"; they cannot be edited or forwarded. Full rendering spec: cosquest-sparks `docs/APP_SPEC_bot_posts.md`.
- `POST /api/chats/:conversationId/sparks/bot-posts/:messageId/role-pings/decide` with `{ role, decision: "approve"|"dismiss" }` — admins (as for pin): approve a suggested role ping (its people get the mention notification now) or dismiss it. `200 { post }` (the updated `role_pings` post; members also get `message:edited`). `400` bad body, `403` not an admin, `404` no such post or suggestion, `409` already decided the other way, `410` the Spark is gone (approve only).

With `SPARKS_ENGINE=legacy` the old stand-in engine (`src/utils/sparks.js`: keyword detection, no DMs, optional `ANTHROPIC_API_KEY` summaries) serves these endpoints instead.

## Chat search, jump to message, albums, and "before your change"

All need login and chat membership.

- `GET /api/chats/:conversationId/messages` — the chat's history, newest first: `{ messages, pagination: { page, limit, total, hasMore } }`. With no `limit` it returns the whole chat at once, like WhatsApp (up to `CHAT_HISTORY_MAX`, default 1000 newest messages; past that, `page=2` and on). Send no `limit` to show everything; a `limit` (up to the same maximum) still pages.
- `GET /api/chats/:conversationId/search?q=&page=&limit=&from=&to=&sort=` — text and voice-note transcripts (and album captions), newest first (`sort=oldest` for oldest first; `sort=newest` is the default), `q` 2-100 characters, matched literally. Optional `from` / `to` limit it to messages sent in that range, both inclusive: a date (`2026-10-01`, UTC; as `to` it means the end of that day) or a date-time (`2026-10-01T09:30:00Z`, with an offset or UTC). `400` for an invalid date, `from` after `to`, or any other `sort`. Each result: `{ message, context: { label, sparkId, sparkSubject } }` where `label` is the Spark's subject (`· revived` / `· history` once it has several eras) or `Original conversation`. Messages you deleted for yourself, and messages deleted for everyone, never appear.
- `GET /api/chats/:conversationId/messages/:messageId/context?size=12` — the message with up to `size` (max 30) messages before and after, oldest first: `{ targetId, messages, hasOlder, hasNewer }`. Messages include reactions and DM read state.
- `POST /api/chats/:conversationId/album` (multipart) — `media` ×1-10 (photos JPEG/PNG/WEBP/GIF up to 10 MB each, videos MP4/MOV/WEBM up to 50 MB each), optional `content` caption, `replyTo`, `sparkId`. Returns `{ message }` with `kind: "album"` and `album: [{ url, publicId, resourceType, kind, ... }]`. Albums can be forwarded; the chat-list preview reads `📷 3 photos` / `🎥 2 videos` / `📷 4 photos & videos`.
- Messages now carry `album` (null unless `kind` is `album`) and `previousContent`: for the author only, the wording an undo (`POST .../rollback`) would restore; always null for everyone else and in live broadcasts.

## Call controls (joining, screen sharing, ending, moderation)

**Joining.** Every response that hands out a LiveKit token (`POST /api/chats/:id/voice/join`, starting, answering or rejoining a call, a private call) and `GET /api/chats/:id/voice` / `GET /api/calls/incoming` (before connecting or answering) also carry:
- `media: { cameraStartsOn }`: `false` for voice chats, audio calls and private calls, `true` only for video calls. Everyone may still turn their camera on.
- `transcription: { on, consent, scope }`: `on` = calls are transcribed here (the Sparks notice applies); `consent` = this person's latest decision for this call or a standing one (`"accepted"`, `"declined"` or `null` = not decided yet: show the notice before connecting), `scope` = `"call"` or `"always"`. Sparks off: `{ on: false }`.
- Voice chats only: `canModerate` (an admin: see Moderation), `canEnd` and `canManageStage` (started it, or an admin).

Tokens allow the microphone and camera. The screen only for the person sharing (below), no microphone for someone an admin muted, and nothing at all (`canPublish: false`, listen only) for a listener on a stage.

**Sparks notes.** `GET /api/calls/:callId/notes` (a call id or a voice chat id): `{ callId, kind: "call"|"voice_room", canOpen, reason: "attended"|"chat_admin"|"not_on_call", outline: "pending"|"ready"|"none", kept: "until_deleted" }`. Who can open the outline and transcript: people who were on it and the chat's admins. Notes are kept until deleted (no retention period is set). `404` no notes for that id, `503` Sparks off.

**Screen sharing (one person at a time).** `POST /api/calls/:callId/screen-share/start` and `/stop`; `POST /api/voice/:roomId/screen-share/start` and `/stop`. Start, then publish the screen track: LiveKit only allows it to the person sharing. `409 { reason: "someone_sharing", screenShare }` while someone else shares; starting again is safe. The share ends by itself when the sharer leaves or the call ends. Stop: the sharer; in a voice chat an admin can also stop someone's share. Listeners on a stage can't share (`403`). Who is sharing: `screenShare: { userId, startedAt } | null` on the call (`call:updated`) and the voice chat (`voice:updated`).

**Ending a voice chat for everyone.** `POST /api/voice/:roomId/end`: whoever started it, or an admin (`403` otherwise). Everyone is disconnected, `voice:updated` carries `voiceRoom: null`, the people in it get `voice:ended { roomId, conversationId, endedBy }`, and the "voice chat ended" entry is posted. Nobody ending it: it still ends when the last person leaves or goes quiet.

**Moderation (voice chats).** Admins: in a group, its owner and admins, by the group's rule (admins act on members, only the owner acts on admins, nobody on the owner); in the Community room and faction rooms, that room's admins, set with `node scripts/setRoomAdmin.js <username> community|faction:<key> [--remove]` (room admins can't act on each other). Rank alone gives no powers.
- `POST /api/voice/:roomId/members/:userId/mute`: their microphone is muted and stays off (they can't unmute) until `.../unmute`. `voiceRoom.members[].mutedByAdmin`; they get `voice:moderated { roomId, conversationId, action: "muted"|"unmuted", by }`.
- `POST /api/voice/:roomId/members/:userId/remove`: out of the voice chat and LiveKit, and kept out of this voice chat: joining again answers `403 { reason: "removed", error: "An admin removed you from this voice chat. You can join the next one." }`. They get `voice:removed { roomId, conversationId, by }`. `.../allow` lets them back in. The next voice chat starts clean.
- Errors: `403` not an admin / acting on the owner or (as an admin) on another admin, `400` acting on yourself, `404` they are not in it, `410` it has ended.

**Moderation (calls).** A call starts in a DM, so whoever started it (`call.moderatorId`) mutes and removes people; nobody else can (`403`).
- `POST /api/calls/:callId/members/:userId/mute` / `.../unmute`: as in voice chats. `call.members[].mutedByAdmin`; they get `call:moderated { callId, action: "muted"|"unmuted", by }`.
- `POST /api/calls/:callId/members/:userId/remove`: out of the call (marked `left`, or `declined` if it was ringing) and LiveKit, and kept out: answering or `POST /calls/:id/join` answers `403 { reason: "removed", error: "You were removed from this call." }`, and adding them again is skipped with `reason: "removed"`. They get `call:removed { callId, by }`. `.../allow` lets them be added again.

**Stage (speakers and listeners).** For big voice chats. Run by whoever started it or an admin (`canManageStage`).
- `POST /api/voice/:roomId/stage { on: true|false }`: on = only speakers talk (the person switching it on and the starter are speakers; everyone else, and everyone joining later, listens); off = everyone talks again.
- `POST /api/voice/:roomId/members/:userId/role { role: "speaker"|"listener" }`: promote or demote (`409` while the stage is off; only the owner moves an admin to the audience). LiveKit changes at once; they get `voice:role { roomId, conversationId, role, by }`.
- `POST /api/voice/:roomId/hand { raised: true|false }`: a listener asks to speak (`409` for speakers).
- `voiceRoom` carries `stage`, `speakerCount` and per member `role` ("speaker"|"listener") and `handRaised`.

**"Faction in danger" alerts.** `POST /api/calls/:callId/alert` or `POST /api/voice/:roomId/alert` with optional `{ message }` (200 characters), from a call or voice chat you are in (not a private call); you need a faction. `201 { alert }`, where `alert` is `{ alertId, from, factionKey, source: "call"|"voice", callId, voiceRoomId, conversationId, message, at, flareUntil, respondUntil }`. One per person every 5 minutes (`429 { reason: "cooldown", retryAfter }`).
- Everyone in the sender's faction (not the sender, nobody blocked either way) gets the socket event `alert:faction` (the same object). People with the app closed get a high-priority push on the Android channel `alerts` (the app must create it) with `data: { type: "faction_alert", alertId, callId|voiceRoomId, chatId }`; people with the app open get only the socket event, no generic `banner`.
- The flare: `alert: { alertId, userId, at, expiresAt } | null` on the call and the voice chat, for 10 minutes (hide it after `expiresAt`).
- `GET /api/alerts/:alertId` (faction members and the sender): `{ alert, canRespond, responded, responderCount }`.
- `POST /api/alerts/:alertId/respond` ("Respond"), for 30 minutes: from a call, straight into the call without ringing (answers like accepting: `call`, `token`, `livekitUrl`, ...); from a voice chat, the usual join. Both add `source`. `410 { reason: "expired" }` after 30 minutes, `410` if the call or voice chat has ended, `403` another faction / blocked / removed, `400` the sender, `409` already on another call or full.

**Dropped phones (LiveKit webhook).** With the webhook set up (DEPLOY.md), someone whose phone drops out of LiveKit and doesn't reconnect within 20 seconds is taken out: of a voice chat (count right within seconds instead of after the 90-second check-in window), or of a call (marked left, so a one-to-one call ends instead of staying "busy"). A network switch or a server restart reconnects within that and changes nothing.

## Expertise roles, regional groups, join introductions, Spark-only mute

- `GET /api/expertise` — public list `[{ key, label }]` (edit it in `src/models/expertiseModel.js`; no app update needed). `PATCH /api/expertise/me` with `{ "expertise": "front_end" }` sets yours, `{ "expertise": null }` clears it (the field must be sent). People in chat (`sender`, member pickers, seen-by) carry `expertise`: the label ("Front-end") or null. Expertise is a label only, not a rank and gives no powers.
- Groups have `scope`: `local` (member-made, the default) or `regional` (orchestrator-made). It appears in group info, discovery and the chat list's `group`. Until orchestrators have a screen, set it with `node scripts/setGroupScope.js "<group name or id>" regional|local`.
- `POST /api/groups/:groupId/join` and `POST /api/groups/invite/:code/join` accept an optional `{ "message": "..." }` introduction (200 characters max) that admins see in `GET /api/groups/:groupId/requests` as `message`. `DELETE /api/groups/:groupId/requests/mine` cancels your own pending request (`{ cancelled: true|false }`).
- `PATCH /api/chats/:conversationId/notifications` with `{ "sparksMuted": true|false }` — "mute only Sparks": replies posted inside Sparks stop counting toward your unread badge while the main chat still does. The chat list reports `sparksMuted`.

## Polls

A poll is a chat message with `kind: "poll"`, so replying, reacting, pinning, deleting, search and read state work like any message. Needs login and chat membership; creating follows the normal send rules (blocked DMs, muted by an admin, slow mode). Polls work in every chat type, DMs included.

- `POST /api/chats/:id/polls` with `{ question (1-300), options: [text, ...] (2-12, each up to 100, no duplicates ignoring capitals), multiple?, anonymous?, closesIn?: "1h" | "1d" | "1w", replyTo? }` returns `201 { message }`. Option ids are `o1`, `o2`, ...
- `POST /api/chats/:id/messages/:messageId/vote` with `{ optionIds: ["o1"] }`. Several ids only if the poll is `multiple`; an empty list removes your vote; voting again changes it. `400` once the poll is closed (by hand or by `closesIn`) or deleted. Returns `{ messageId, poll }`.
- `POST .../messages/:messageId/poll/close` closes it early. Only the creator or, in groups, an admin (`403` otherwise).
- `GET .../messages/:messageId/poll/votes` lists the voters per option. `403` for anonymous polls (counts only).

A poll message carries `poll`: `{ question, options: [{ id, text, votes }], multiple, anonymous, closesAt, closedAt, closed, totalVoters, myVotes }`. The message list, a single message, search results and Spark panels all include live results; `myVotes` is that viewer's own picks. Live: the new poll arrives as `message:new`, and every vote or close sends `poll:updated { conversationId, messageId, poll }` (without `myVotes`: each app keeps its own). Polls cannot be edited or forwarded. The chat-list preview reads `📊 Poll: <question>`.

## Faction ranks and online count

- `GET /api/ranks` (public) — `{ ranks: [{ key, name, short, level, chevrons, bars, star, minPoints }] }`, lowest first (`level` 1). The point levels in the default ladder (`src/utils/ranks.js`) are placeholders until the real ladder is agreed; set the env var `RANKS_JSON` to a JSON array of the same objects to replace the whole ladder without a code change (`key`, `name`, `minPoints` required, one rank at 0 points; an invalid value is logged and ignored).
- People in chat (`message.sender`, `GET /api/chats/:id/members`, `GET /api/groups/:id/members`, join requests, bans, seen-by, poll voters) carry `rank`: `{ key, name, short, level, chevrons, bars, star }` — the highest rank their points reach, or the one an orchestrator set by hand (`User.rankOverride` = a rank key), which adds `overridden: true`. Points themselves are not shown.
- `GET /api/chats/:conversationId` has `onlineCount` for group, faction and Community chats: members connected right now, not counting anyone who hides their online status (you are counted when you are online). `null` for DMs (use `otherParticipant.isOnline`) and when both the chat and the number of people online are over 5000. Only this endpoint computes it, not the chat list.
- Messages in group chats have `senderGroupRole`: `"owner"`, `"admin"` or `null` (members, and every other chat type). It is on the message list, a single message, new messages (REST and `message:new`), search and context results, and the messages of `GET /api/chats/:id/sparks/:sparkId`, so the app can show "Owner" / "Admin" beside the name.

## The CostQuest game's one login

- `GET /api/game/session` (Bearer) returns `{ user: { id, username, displayName, faction, avatarKey, avatarPhotoUrl, onboardingComplete } }` with `Cache-Control: no-store`. It runs the full session check (logged out, or signed in on another phone, is `401`), which is why the game backend's single sign-on (`POST /v1/sso/cosquest` on ubmids/costquest-backend, docs/SSO.md there) calls it with the person's own token before giving them their game player. Nothing private is in the answer (no email, token version or session id). Rate limited per address: 120 per 5 minutes (`GAME_SESSION_RATE_MAX`), `429` beyond. Tests: `node test/gameSession.js`.
