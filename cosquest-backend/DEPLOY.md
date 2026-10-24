# Deploys: test and production on Mark's server

Every push to `main` that touches `cosquest-backend/` runs the backend tests on GitHub and, only if they pass, deploys to the **test server** on Mark's machine:

**https://cosquest-api-test.204.168.162.79.sslip.io** (health: `/health`, model manifest: `/v1/model`)

It is a full copy of the backend with its own MongoDB and Redis (fresh data, not production), and Sparks switched on (`SPARKS_ENGINE=module`). Point a development build of the app at it to test Sparks end to end. Production is not touched.

## What happens on a push

1. **test**: `npm ci` and `npm test` in `cosquest-backend/` (in-memory MongoDB and Redis).
2. **deploy**: the code of that commit is sent to the server, which builds `cosquest-backend/Dockerfile`, starts the new version, and checks `/health` for up to 90 seconds. If the new version does not come up, the server switches straight back to the previous one, and the workflow fails so you see it.
3. **check**: `/health` over HTTPS.

The workflow is `.github/workflows/deploy.yml`. You can also run it by hand: Actions > deploy > Run workflow.

4. **deploy-prod** (once production has moved, see below): if the test server came up healthy, the same commit goes to **production** the same way (build, health check, automatic rollback). It is switched off until the repository variable `PROD_ENABLED` is `true`.

## Settings and keys (`COSQUEST_TEST_ENV`)

The server already sets the infrastructure values: `MONGODB_URI`, `REDIS_URL`, `PORT`, `UPLOAD_DIR`, `NODE_ENV`, `PUBLIC_BASE_URL`, `SPARKS_ENGINE`, `SPARKS_MODEL_MANIFEST_URL`, plus its own `JWT_SECRET` and `OAUTH_COOKIE_SECRET`.

Everything else (Cloudinary, LiveKit, Deepgram, SMTP, Google/Apple sign-in, Anthropic, dashboard settings...) goes in **one repository secret, `COSQUEST_TEST_ENV`**, written like a `.env` file:

```
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
LIVEKIT_URL=...
```

Settings > Secrets and variables > Actions > `COSQUEST_TEST_ENV`. Use test or development keys, not production ones. The next deploy applies it (run the workflow by hand to apply it at once). The infrastructure values above cannot be overridden from here.

## Call and voice chat size limits

Optional. Without them, calls take up to 1,000 people at once and voice chats up to 1,000. Set them in `COSQUEST_TEST_ENV` / `COSQUEST_PROD_ENV` like any other setting; a missing or invalid value uses the default.

| Setting | Default | What it does |
|---|---|---|
| `CALL_MAX_IN_CALL` | 1000 | People ringing or in one call at the same time. The app shows it (`maxParticipants`) |
| `CALL_MAX_EVER_INVITED` | 5000 | Everyone who was ever part of one call (at least 2) |
| `CALL_MAX_INVITES_PER_REQUEST` | 50 | People added by one "add people" request. The app shows it (`maxInvitesPerRequest`) |
| `VOICE_ROOM_MAX_MEMBERS` | 1000 | People in one Community or faction voice chat (`maxMembers`) |
| `CALL_BROADCAST_INTERVAL_MS` | 250 | Shortest gap between two live updates of one call or voice chat |
| `CALL_BROADCAST_MS_PER_MEMBER` | 2 | Extra gap per person, so big calls update less often (500 people: 1 s, 1,000: 2 s) |

Calls of a few hundred people or more also need LiveKit sized for them: see "Big calls and LiveKit" in the pull request that added these (about one CPU core per 100 listeners with 10 people talking; 1,000 people needs its own LiveKit server).

## LiveKit webhook

So the backend hears at once when a phone drops out of a call or voice chat (API_GUIDE.md, "Call controls"), point LiveKit's webhook at `https://<API address>/api/livekit/webhook`: LiveKit Cloud, Settings > Webhooks; self-hosted, `webhook.urls` in the LiveKit server config, with `webhook.api_key` set to the same key as `LIVEKIT_API_KEY`. The backend checks LiveKit's signature with `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`; nothing else to set. Without it everything still works, with the slower 90-second check-in rule for voice chats and no automatic clean-up of crashed phones in calls.

The same keys are used for LiveKit's server API (muting, removing, screen-share permission, ending a voice chat), at the HTTPS form of `LIVEKIT_URL`.

## Secrets this workflow uses

| Secret | What it is |
|---|---|
| `DEPLOY_SSH_KEY` | A key that can only start a deploy on the test server (no shell, nothing else) |
| `DEPLOY_HOST_KEY` | The server's SSH host key, so the workflow only talks to the real server |
| `COSQUEST_TEST_ENV` | Your keys for the test server (above). Optional |
| `DEPLOY_PROD_SSH_KEY` | Like `DEPLOY_SSH_KEY`, for production only |
| `COSQUEST_PROD_ENV` | Production settings, like `COSQUEST_TEST_ENV` (see the cutover below) |
| `SOURCE_MONGODB_URI` | Only for the one-off database move: the current production database |

## Rollback and status

A failed deploy rolls back by itself. To go back to the previous version on purpose, ask us, or (with the deploy key) run `ssh cosquest-deploy@204.168.162.79 rollback`; `status` shows what is live. The server keeps the last five versions and a nightly database backup (seven days).

## Production cutover (moving production from Render to Mark's server)

Production on Mark's server is ready next to the test server: its own MongoDB and Redis, nightly backups (14 kept), its own deploy key, health check and rollback. It is not serving anyone yet. The move is one planned window of about 30 minutes.

**Before the window**
1. **Address.** Tell us the API address the live app uses today. Production should be on a domain you control (for example `api.<your domain>`), pointed at `204.168.162.79` (an `A` record): we add it to the server and HTTPS is automatic. If the app has a Render address built in, the new address has to ship in an app build before the window.
2. **Settings.** Add the secret `COSQUEST_PROD_ENV` with all of Render's environment variables except `MONGODB_URI`, `REDIS_URL`, `PORT`, `UPLOAD_DIR` and `NODE_ENV` (the server sets those). Keep **`JWT_SECRET` and `OAUTH_COOKIE_SECRET` exactly as they are on Render**, or every user is logged out. Keep `SPARKS_ENGINE` as it is in production today.
3. **Database.** Add the secret `SOURCE_MONGODB_URI` (the production connection string; read access is enough). If it is MongoDB Atlas, allow `204.168.162.79` under Network Access.
4. **Sign-in.** Add the new callback URLs to the Google and Apple consoles (`https://<new address>/api/auth/oauth/google/callback` and `.../apple/callback`) and set `GOOGLE_OAUTH_CALLBACK_URL` / `APPLE_OAUTH_CALLBACK_URL` in `COSQUEST_PROD_ENV` to them.
5. **Files.** If production keeps files on Render's disk (`UPLOAD_DIR`) rather than Cloudinary, tell us: they are copied in the window too.

**In the window**
1. **Stop writes on Render without breaking the app.** In the Render service, switch it to the forwarder (see "Leaving Render" below): it stops using the old database and passes every request to Mark's server instead. Apps already installed keep working.
2. Actions > **migrate-prod-db** > Run workflow, type `MIGRATE`. It copies the database, checks the document count of every collection on both sides, and starts production on Mark's server with `main`.
3. Check it: `ssh cosquest-deploy-prod@204.168.162.79 smoke` (health, the public address, the live socket, the Sparks model list, the Sparks engine and the main collections), then by hand: sign in, send a message, start a call, open a chat with Sparks. Do it once in an app pointed at the new address and once in a build that still uses the Render address (through the forwarder).
4. Set the repository variable `PROD_ENABLED` to `true` (Settings > Secrets and variables > Actions > Variables). From then on every push to `main` goes test, then production.

**Going back:** point the Render service back at the old backend and start it. Anything written on Mark's server after the move stays there (nightly backup plus a dump on request), so decide quickly if you need to go back.

The whole sequence was rehearsed on Mark's server on 14 October 2026 with stand-in data (the test database as the source): copy with matching counts, deploy, smoke check, and sign-in, chats and the live socket through the forwarder. The stand-in data was deleted afterwards.

## Leaving Render

Every app build in people's hands today has `https://cosquest-1.onrender.com` built in, so Render keeps one small job for a while after the move: forwarding. Nothing else stays there.

**1. The forwarder (at the cutover).** `render-forwarder/` in this repo is a tiny Node service that passes everything (HTTP, uploads, the Socket.IO websocket) to Mark's server. In the existing Render service: Root Directory `render-forwarder`, Build Command `npm ci`, Start Command `npm start`, and the only environment variable `FORWARD_TO=https://<new address>`. Remove all the other variables from Render (database, secrets): the forwarder needs none of them. It logs requests per minute, and `GET /__forwarder` shows where it forwards.

**Google and Apple sign-in from old builds.** Sign-in keeps its state in a cookie on the address the browser is looking at, and Google and Apple call back to the new address. So the forwarder does not proxy the two sign-in start pages (`GET /api/auth/oauth/google` and `/api/auth/oauth/apple`): it answers them with a redirect to the same path and query on the new address. The browser then runs the whole sign-in on the new address, exactly like a new build, and the app still gets its `cosquest://` return link. Callbacks and `POST /api/auth/oauth/exchange` are proxied as before. Only the new callback URLs are used after the move; the onrender ones can stay registered until the Render service is deleted. `OAUTH_REDIRECT=false` turns the redirect off (not recommended). `npm test` in `render-forwarder/` covers it, including a check that plain proxying fails.

**2. Each user's own address.** Through the forwarder, requests arrive with one more proxy in front. Set `TRUST_PROXY` in `COSQUEST_PROD_ENV` to `loopback, uniquelocal, <Render's outbound IPs>` (Render shows them under the service's Connect > Outbound) for as long as the forwarder runs, so rate limits stay per user. Afterwards remove it (the default, one proxy, is right for direct traffic).

**3. The new app build.** Set `EXPO_PUBLIC_API_URL` in `eas.json` (preview and production) to the new address and ship a store build. That build includes over-the-air updates (expo-updates, branch `leave-render` of the app): from then on a change of address, or any JavaScript fix, reaches installed builds with `eas update --channel production`, without a store release.

**4. Turning Render off.** When the forwarder's log shows (almost) no requests for a week or two after the new build is out:
- delete the Render service (and any other CosQuest services, cron jobs or Redis on Render), and disconnect the GitHub repository from Render so pushes no longer deploy there;
- in MongoDB Atlas, take a final backup of the old database, then remove Render's database user and its Network Access entries, and delete the cluster when you are sure;
- remove `cosquest-1.onrender.com` from the code and docs (`grep -rn onrender`).

After that, the backend, its database, Redis and the Sparks model all run on Mark's server; images stay on Cloudinary, which was never on Render.
