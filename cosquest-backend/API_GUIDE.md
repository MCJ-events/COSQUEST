# CosQuest Backend — API Guide

Base URL: `http://localhost:6893` (match your `.env`'s `PORT`). Every response below is the **complete** object exactly as the codebase returns it (matches `src/models/User.js`'s schema field-for-field, run through `userModel.sanitize()`, which is why `passwordHash`/`tokenVersion`/`_id` never appear and `id` does instead).

Signup is just step 0 of one continuous onboarding process, not a separate thing - there's no token yet at that point, and no server-generated id is handed out as a stand-in credential either. So every Step 1-4 endpoint below accepts **either** the plain `email` you signed up with (in the body/query) **or** an `Authorization: Bearer <token>` header - whichever you have. **Login itself refuses to issue a token until `onboardingComplete` is true**, so onboarding has to be finished (via `email`) before login will ever succeed. Once you're logged in, the Bearer token works on all the same endpoints too, e.g. for editing faction/interests later.

Registration requires a unique, valid email address. Usernames are required during the profile step and are also unique without regard to letter case (for example, `Hero` and `hero` cannot both exist). Passwords must be at least eight characters and include an uppercase letter, lowercase letter, number, and special character.

Profile fields also include an optional editable `bio` (500 characters maximum), a category with a `showCategoryOnProfile` display switch, and every user has a `pointsBalance` which starts at `0`. Public profile APIs return only safe public information; they never return an account email address, age, or gender. A separately saved contact email is public because the Contact options screen has no visibility switches.

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

**POST** `/api/auth/login` — this is the only place a token is ever issued. Send the email or username in `identifier`; the legacy `email` field remains supported.
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

**POST** `/api/users/me/onboarding/complete` — **login refuses to issue a token until this has succeeded**

Two ways to call this, both valid, both identified by `email` (no token exists yet):

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

Follow notifications appear in the same inbox with `"type": "follow"` and an `actor` containing the follower's public profile preview.

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

Follows the public profile and creates a follow notification for Ravencaller. `DELETE` on the same path unfollows it. A duplicate follow returns `409`.

**GET** `/api/users/Ravencaller/followers?page=1&limit=20` and **GET** `/api/users/Ravencaller/following?page=1&limit=20` are public paginated lists.

## Posts, reels, thoughts, likes, and comments

**POST** `/api/posts` — Bearer token required; use `multipart/form-data`.

| Type | Required fields | Rules |
|---|---|---|
| `image` | `type=image`, one or more `media` files | 1-8 JPEG, PNG, WEBP, or GIF files; maximum 10MB each |
| `reel` | `type=reel`, one `media` file | exactly one MP4, MOV, or WEBM; Cloudinary must report 30 seconds or shorter |
| `thought` | `type=thought`, `content` | no media; content must be 1-300 characters |

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
