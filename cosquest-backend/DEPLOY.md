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
1. Stop the Render service (so nothing new is written to the old database).
2. Actions > **migrate-prod-db** > Run workflow, type `MIGRATE`. It copies the database, checks the document count of every collection on both sides, and starts production on Mark's server with `main`.
3. Point the address at Mark's server (DNS), then check: sign in, send a message, open a chat with Sparks.
4. Set the repository variable `PROD_ENABLED` to `true` (Settings > Secrets and variables > Actions > Variables). From then on every push to `main` goes test, then production.

**Going back:** start the Render service again and point the address back. Anything written on Mark's server after the move stays there (nightly backup plus a dump on request), so decide quickly if you need to go back.
