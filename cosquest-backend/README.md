# CosQuest Backend — API

Signup is just step 0 of one continuous onboarding process, not a separate thing. There's no token yet at that point, and no server-generated id is handed out as a stand-in credential either - so every onboarding-step endpoint below accepts either the plain `email` you signed up with **or** a Bearer token — whichever you have. **Login itself refuses to issue a token until onboarding is complete** — so onboarding has to be finished, identified by `email`, before login will ever succeed.

## Endpoints

### Auth
| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/api/auth/signup` | public, rate-limited | `{ email, password }` | 409 if email taken; password ≥ 6 chars; 10 req / 15 min / IP, else 429 |
| POST | `/api/auth/login` | public, rate-limited | `{ email, password }` | 401 on bad credentials; **403 if `onboardingComplete` is still false**; 10 req / 2 hours / IP, else 429 |
| POST | `/api/auth/logout` | Bearer token | — | bumps `tokenVersion`, invalidating this (and every other) existing token |

### Step 1 — Profile (identify with `email` in the body/query before login, or a Bearer token after)
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/users/me` | — (`?email=` or Bearer) | full current user (no `passwordHash`) |
| PATCH | `/api/users/me/profile` | `{ email, firstName, lastName, username, age, gender }` | all fields optional/independent; username 3-20 chars `[a-zA-Z0-9_]`, must be unique; age 13-120 |
| GET | `/api/users/check-username?username=&email=` | — | `{ available: boolean }` |
| PATCH | `/api/users/me/avatar` | `{ email, avatar }` | `avatar` is a key from `GET /api/meta/avatars` (25 illustrated characters); clears any uploaded photo |
| POST | `/api/users/me/avatar/photo` | multipart: `photo` file + `email` field | jpeg/png/webp/gif, 5MB max |
| GET | `/api/meta/avatars` | — (public) | the 25 illustrated avatar options (`key`, `label`, `imageUrl`) |

### Step 2 — Faction
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/factions` | — (public) | the 3 factions (Marvel, DC, Anime Realm) |
| POST | `/api/users/me/faction` | `{ email, factionKey }` | one of the 3 keys, or `"none"` |

### Step 3 — Interests
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/interests` | — (public) | the 12 interests |
| PUT | `/api/users/me/interests` | `{ email, interests: [key, ...] }` | replaces the full set; deduped, validated |

### Step 4 — Location & notification preferences
| Method | Path | Body | Notes |
|---|---|---|---|
| PATCH | `/api/users/me/preferences/location` | `{ email, locationEnabled, radiusMiles, lat, lng }` | radius 5-100; lat -90..90; lng -180..180; any subset of fields |
| PATCH | `/api/users/me/preferences/notifications` | `{ email, notificationsEnabled }` | |
| POST | `/api/users/me/devices` | `{ email, pushToken, platform }` | platform: `"ios" \| "android" \| "web"`; dedupes by token |
| POST | `/api/users/me/onboarding/complete` | `{ email }` alone, or `{ email, profile, faction, interests, preferences }` | `email`-only: just flags onboarding done. With the extra fields: validates + saves everything in one atomic call (nothing saved if any field is invalid), matching the front-end's `finishOnb()` one-shot submit, then flags it done. **Login won't succeed until this has run.** |

### Notifications (in-app inbox — Bearer token only, i.e. after login)
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/users/me/notifications` | — | this user's notifications, newest first |
| PATCH | `/api/users/me/notifications/read` | — | marks all of this user's unread notifications as read |

Every signup automatically creates one welcome notification for that account - since it's only reachable with a Bearer token, and login won't hand one out until onboarding is done, this is the very first thing they see right after their first successful login. Beyond that, sending a notification is done separately, via `npm run notify -- "message"` (see below) - there's no admin/broadcast endpoint yet, only a script, and it only reaches users who have `notificationsEnabled` on.

## Usage examples (curl)

```bash
BASE_URL="http://localhost:6893"   # match this to your .env's PORT
EMAIL="alex@gmail.com"
```

### 1. Sign up

```bash
curl -s -X POST $BASE_URL/api/auth/signup \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"quest1234\"}"
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
  -d "{\"email\":\"$EMAIL\",\"password\":\"quest1234\"}"
```

```json
{ "error": "Please complete onboarding before logging in." }
```

### 3. Complete onboarding, identified by `email` (no token exists yet)

```bash
# Step 1: profile
curl -s -X PATCH $BASE_URL/api/users/me/profile \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"firstName\":\"Alex\",\"lastName\":\"Rivera\",\"username\":\"Ravencaller\",\"age\":24,\"gender\":\"Female\"}"

curl -s -X PATCH $BASE_URL/api/users/me/avatar \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"avatar\":\"green-knight\"}"

curl -s -X POST $BASE_URL/api/users/me/avatar/photo \
  -F "email=$EMAIL" -F "photo=@/path/to/photo.jpg"

# Step 2: faction
curl -s $BASE_URL/api/factions

curl -s -X POST $BASE_URL/api/users/me/faction \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"factionKey\":\"anime\"}"

# Step 3: interests
curl -s $BASE_URL/api/interests

curl -s -X PUT $BASE_URL/api/users/me/interests \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"interests\":[\"anime\",\"comic\",\"cosplay\"]}"

# Step 4: location & notifications
curl -s -X PATCH $BASE_URL/api/users/me/preferences/location \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"locationEnabled\":true,\"radiusMiles\":50,\"lat\":32.7157,\"lng\":-117.1611}"

curl -s -X PATCH $BASE_URL/api/users/me/preferences/notifications \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"notificationsEnabled\":true}"

curl -s -X POST $BASE_URL/api/users/me/devices \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"pushToken\":\"fcm-token-abc123\",\"platform\":\"web\"}"

# Finish
curl -s -X POST $BASE_URL/api/users/me/onboarding/complete \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\"}"
```

### 4. Now log in — this is the only place a token is ever issued

```bash
TOKEN=$(curl -s -X POST $BASE_URL/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"quest1234\"}" | node -pe "JSON.parse(require('fs').readFileSync(0)).token")
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
$body = '{"email":"alex@gmail.com","password":"quest1234"}'
Invoke-RestMethod -Uri http://localhost:6893/api/auth/login -Method Post -ContentType "application/json" -Body $body
```

### 5. After login - Bearer token works everywhere `email` did, plus notifications/logout

```bash
# Any step 1-4 endpoint still works, now via Bearer token, for edits after onboarding
curl -s -X POST $BASE_URL/api/users/me/faction \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"factionKey":"dc"}'

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

The front-end doesn't call the step 1-4 endpoints individually — it collects everything into one local `state` object and submits it all together when the user taps "Enter CosQuest" (`finishOnb()`). `POST /api/users/me/onboarding/complete` accepts that same combined payload in a single call, identified by `email` since there's no token yet:

```bash
curl -s -X POST $BASE_URL/api/users/me/onboarding/complete \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$EMAIL\",
    \"profile\": { \"firstName\":\"Alex\",\"lastName\":\"Rivera\",\"username\":\"Ravencaller\",\"age\":24,\"gender\":\"Female\",\"avatar\":\"green-knight\" },
    \"faction\": \"anime\",
    \"interests\": [\"anime\",\"comic\",\"cosplay\"],
    \"preferences\": { \"locationEnabled\": true, \"radiusMiles\": 50, \"lat\": 32.7157, \"lng\": -117.1611, \"notificationsEnabled\": true }
  }"
```

If any field is invalid, nothing is saved — you get a `400` with an `errors` array listing every problem at once, and `onboardingComplete` stays `false` (so login keeps refusing too). The individual step endpoints above still work too, e.g. for editing a field after onboarding is already complete (that time, via Bearer token).
