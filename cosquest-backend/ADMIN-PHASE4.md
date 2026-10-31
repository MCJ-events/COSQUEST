# Super admin dashboard: backend, Phase 4 (Sparks)

Read-only page built on the Sparks module (as advised): it reads `sparks_sparks` directly, because the store only lists per chat. Builds on Phases 1-3 and 5; `validators/admin.js` and `routes/adminRoutes.js` replace Phase 5's.

## Rules

- **Module only** (`require('../sparks').isModule()`); on the legacy engine the endpoints answer 503 `sparks_legacy`.
- **Never DM Sparks:** only Sparks whose `chatId` is a group (not archived), the Community room or a faction room. A DM Spark's detail answers 404.
- **Merged and deleted are hidden** (`state` in `active`, `dormant`).
- **Dashboard states from `lastMessageAt`** (not the module's 12-minute dormancy): Active = last reply within 24 h, Quiet = 1-7 days, Dormant = more than 7 days. Pinned Sparks follow the same rule.
- **Replies** = messages with that `sparkId`, minus `sparks_bot` posts and messages deleted for everyone; counted for a whole page in **one** aggregate (not `serializeRow` per Spark).
- **History**: the latest 40 messages of the Spark (oldest first), deleted ones as tombstones, plus its sessions (revivals) and up to 3 related Sparks in the same chat.
- Pin, delete and merge are not here (requirements pending).

## Files

| File | |
|---|---|
| `src/controllers/adminSparksController.js` **new** | stats, list, detail, `newSparksBetween` (Overview) |
| `src/validators/admin.js`, `src/routes/adminRoutes.js` **replace Phase 5's** | Phases 1-5 |
| `test/adminPhase4.js` **new** | Inserts its own rows into `sparks_sparks` (and removes them); sets `SPARKS_ENGINE=module` for the suite |
| `apply-admin-phase4.js` | The two edits below |

## Edits (`node apply-admin-phase4.js`)

- **`src/sparks/mongoStore.js`** `ensureIndexes`, after `c.sparks.createIndex({ state: 1 })` (the line you asked for):
  ```js
  c.sparks.createIndex({ state: 1, lastMessageAt: -1 }),
  ```
- **`src/controllers/adminOverviewController.js`** (`newSparksCount`): on the module, count `sparks_sparks` created in the window (ms), not DMs, instead of returning null, so the Overview's "New Sparks" shows a number.

## API (admin token)

| Method | Path | |
|---|---|---|
| GET | `/api/admin/sparks/stats?from&to` | `{ newThisWeek, active, quiet, dormant, total }` |
| GET | `/api/admin/sparks?tab=all\|active\|quiet\|dormant&group=<id>&q&offset` | `{ sparks: [{ id, subject, chat, creator, startedByBot, state, moduleState, pinned, revivals, replies, participants, summary, createdAt, lastMessageAt }], total, nextOffset }` (25 a page, latest reply first) |
| GET | `/api/admin/sparks/:sparkId` | `{ spark, openReports, revivals, history, related }` |
