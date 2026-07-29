# CosQuest Backend — API Guide

Base URL: `http://localhost:6893` (match your `.env`'s `PORT`). Every response below is the **complete** object exactly as the codebase returns it (matches `src/models/User.js`'s schema field-for-field, run through `userModel.sanitize()`, which is why `passwordHash`/`tokenVersion`/`_id` never appear and `id` does instead).

Signup is just step 0 of one continuous onboarding process, not a separate thing - there's no token yet at that point, and no server-generated id is handed out as a stand-in credential either. So every Step 1-4 endpoint below accepts **either** the plain `email` you signed up with (in the body/query) **or** an `Authorization: Bearer <token>` header - whichever you have. **Login itself refuses to issue a token until `onboardingComplete` is true**, so onboarding has to be finished (via `email`) before login will ever succeed. Once you're logged in, the Bearer token works on all the same endpoints too, e.g. for editing faction/interests later.

## Auth

**POST** `/api/auth/signup`
```json
{
  "email": "alex@gmail.com",
  "password": "quest1234"
}
```
Response — note there's **no token here**, and `id` is what every onboarding call below needs:
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
      "locationEnabled": false,
      "radiusMiles": 50,
      "lastKnownLocation": { "lat": null, "lng": null },
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

**POST** `/api/auth/login` — this is the only place a token is ever issued
```json
{
  "email": "alex@gmail.com",
  "password": "quest1234"
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
    "faction": "anime",
    "interests": ["anime", "comic", "cosplay"],
    "preferences": {
      "locationEnabled": true,
      "radiusMiles": 50,
      "lastKnownLocation": { "lat": 32.7157, "lng": -117.1611 },
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

**GET** `/api/users/me?email=alex@gmail.com` (or send `Authorization: Bearer <token>` instead, once logged in)
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
      "locationEnabled": false,
      "radiusMiles": 50,
      "lastKnownLocation": { "lat": null, "lng": null },
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
      "locationEnabled": false,
      "radiusMiles": 50,
      "lastKnownLocation": { "lat": null, "lng": null },
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

**GET** `/api/users/check-username?username=Ravencaller&email=alex@gmail.com`
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
      "locationEnabled": false,
      "radiusMiles": 50,
      "lastKnownLocation": { "lat": null, "lng": null },
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
      "locationEnabled": false,
      "radiusMiles": 50,
      "lastKnownLocation": { "lat": null, "lng": null },
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

**GET** `/api/meta/avatars` — public, no body (25 illustrated characters, not emoji - each `key` is what you send to `PATCH /api/users/me/avatar`)
Response (truncated to 2 of 25 for brevity):
```json
{
  "avatars": [
    { "key": "adventurer", "label": "Adventurer", "imageUrl": "http://localhost:6893/avatars/avatar-01.png" },
    { "key": "sky-guardian", "label": "Sky Guardian", "imageUrl": "http://localhost:6893/avatars/avatar-02.png" }
  ]
}
```

## Step 2 — Faction

**GET** `/api/factions` — public, no body
Response:
```json
{
  "factions": [
    { "key": "marvel", "name": "Marvel", "color": "#ED1D24", "description": "Web-slingers, mutants, and cosmic heroes — bold, witty, and always ready for a team-up." },
    { "key": "dc", "name": "DC", "color": "#0078F0", "description": "Gotham to Krypton — dark, epic, and larger than life. Justice never sleeps." },
    { "key": "anime", "name": "Anime Realm", "color": "#EC4899", "description": "Manga & anime devotees — disciplined, dramatic, and endlessly creative." }
  ],
  "factionless": { "key": "none", "name": "Factionless" }
}
```

**POST** `/api/users/me/faction`
```json
{
  "email": "alex@gmail.com",
  "factionKey": "anime"
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
    "faction": "anime",
    "interests": [],
    "preferences": {
      "locationEnabled": false,
      "radiusMiles": 50,
      "lastKnownLocation": { "lat": null, "lng": null },
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
    "faction": "anime",
    "interests": ["anime", "comic", "cosplay"],
    "preferences": {
      "locationEnabled": false,
      "radiusMiles": 50,
      "lastKnownLocation": { "lat": null, "lng": null },
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

## Step 4 — Location & Notifications

**PATCH** `/api/users/me/preferences/location`
```json
{
  "email": "alex@gmail.com",
  "locationEnabled": true,
  "radiusMiles": 50,
  "lat": 32.7157,
  "lng": -117.1611
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
    "faction": "anime",
    "interests": ["anime", "comic", "cosplay"],
    "preferences": {
      "locationEnabled": true,
      "radiusMiles": 50,
      "lastKnownLocation": { "lat": 32.7157, "lng": -117.1611 },
      "notificationsEnabled": false
    },
    "devices": [],
    "onboardingComplete": false,
    "createdAt": "2026-07-20T12:00:00.000Z",
    "updatedAt": "2026-07-20T12:06:00.000Z",
    "id": "652f1a2b3c4d5e6f7a8b9c0d"
  }
}
```

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
    "faction": "anime",
    "interests": ["anime", "comic", "cosplay"],
    "preferences": {
      "locationEnabled": true,
      "radiusMiles": 50,
      "lastKnownLocation": { "lat": 32.7157, "lng": -117.1611 },
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

**POST** `/api/users/me/devices`
```json
{
  "email": "alex@gmail.com",
  "pushToken": "fcm-token-abc123",
  "platform": "web"
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
    "faction": "anime",
    "interests": ["anime", "comic", "cosplay"],
    "preferences": {
      "locationEnabled": true,
      "radiusMiles": 50,
      "lastKnownLocation": { "lat": 32.7157, "lng": -117.1611 },
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

**POST** `/api/users/me/onboarding/complete` — **login refuses to issue a token until this has succeeded**

Two ways to call this, both valid, both identified by `email` (no token exists yet):

1. **`email`-only**, after already calling the individual step endpoints above one by one (as shown through this guide) — just flips `onboardingComplete` to `true`.
2. **One-shot**, matching the front-end exactly: nothing is saved while a user clicks through onboarding steps 1-4 in the app — everything sits in the client's local `state` until they tap "Enter CosQuest," which fires once, all together. This endpoint accepts that same combined payload in a single call:

```json
{
  "email": "alex@gmail.com",
  "profile": { "firstName": "Alex", "lastName": "Rivera", "username": "Ravencaller", "age": 24, "gender": "Female", "avatar": "green-knight" },
  "faction": "anime",
  "interests": ["anime", "comic", "cosplay"],
  "preferences": { "locationEnabled": true, "radiusMiles": 50, "lat": 32.7157, "lng": -117.1611, "notificationsEnabled": true }
}
```

Every section besides `email` is optional, and every field is validated exactly like its individual endpoint (username format/uniqueness, valid faction key, valid interest keys, valid avatar key, radius/lat/lng ranges) - but as **one atomic unit**: if anything is invalid, the whole call fails and **nothing is saved**, `onboardingComplete` stays `false` (so login keeps refusing too). (`avatar` maps to `avatarKey`; the photo upload stays its own separate multipart endpoint since a file can't ride along in this JSON body.)

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
    "faction": "anime",
    "interests": ["anime", "comic", "cosplay"],
    "preferences": {
      "locationEnabled": true,
      "radiusMiles": 50,
      "lastKnownLocation": { "lat": 32.7157, "lng": -117.1611 },
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
  "error": "profile.username must be 3-20 characters: letters, numbers, underscore only. faction must be one of the values from GET /api/factions, or \"none\".",
  "errors": [
    "profile.username must be 3-20 characters: letters, numbers, underscore only.",
    "faction must be one of the values from GET /api/factions, or \"none\"."
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
