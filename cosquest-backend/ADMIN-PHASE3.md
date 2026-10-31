# Super admin dashboard: backend, Phase 3 (Members, Groups)

Builds on Phases 1 and 2 (apply those first). Same rules: **a reason for every restriction**, **recorded in the audit log**, never on yourself or on another super admin.

## New: CosQuest-wide restrictions

Until now, mutes and bans only existed inside one group. The Members page adds two **community-wide** ones, stored on the user (`User.moderation`) so checks are a field read:

| | What the member can do | Where it's enforced |
|---|---|---|
| **Mute** (1h, 1d, 1w, 30d, forever) | Read and browse; **can't post, comment or send messages** (403 `community_muted`) | `createPost`, `createComment`, `createMessage` |
| **Suspend** (1d, 1w, 30d, forever) | **Can't use CosQuest** (403 `account_suspended` on every request) | `requireAuth` |

Group-only mutes and bans stay exactly where they were (`mutedByAdminUntil`, `GroupBan`), handled from the Chats page.

**Not covered yet (please tell me if you want them):** forwarding messages, share-to-feed, and the socket handshake don't check the mute/suspension. A suspended account's socket stays connected until it reconnects. Also, the suspension message deliberately avoids words like "session" or "log in", because the app signs people out when it sees those; the app will get a "suspended" screen later.

## Files

| File | |
|---|---|
| `src/utils/communityRestrictions.js` **new** | `refuseIfMuted(req, res)`, `suspendedAnswer(user)`, durations |
| `src/controllers/adminMembersController.js` **new** | Members: stats, directory, details, mute/unmute, suspend/unsuspend |
| `src/controllers/adminGroupsController.js` **new** | Groups: stats, directory with health, details, settings, join requests, archive/restore |
| `src/validators/admin.js`, `src/routes/adminRoutes.js` **replace Phase 2's** | Phases 1-3 |
| `test/adminPhase3.js` **new** | Register it like the others |
| `apply-admin-phase3.js` | The edits below |

## Edits to existing files (`node apply-admin-phase3.js`)

- **`User.js`**: `moderation: { mutedUntil, mutedReason, mutedBy, suspendedUntil, suspendedReason, suspendedBy }` after `adminSessionId`, plus two partial indexes.
- **`auth.js`** (`requireAuth` only, not `optionalAuth`), before `req.userId = user.id;`:
  ```js
  const suspended = require('../utils/communityRestrictions').suspendedAnswer(user);
  if (suspended) return res.status(403).json(suspended);
  ```
- **`postController.js`**: first line of `createPost` and `createComment`, and **`chatController.js`**: first line of `createMessage`:
  ```js
  if (require('../utils/communityRestrictions').refuseIfMuted(req, res)) return undefined;
  ```
  (It also deletes any staged upload.)

## API (admin token)

**Members**
| Method | Path | |
|---|---|---|
| GET | `/api/admin/members/stats?from&to` | `{ total, active {value, change}, newMembers {value, change}, pending, muted, suspended }` |
| GET | `/api/admin/members?tab=all\|pending\|muted\|suspended&role=admin\|member&group=<id>&q&offset` | name, @handle, email, role, status, group count, last active |
| GET | `/api/admin/members/:userId` | details (faction, rank), restrictions, group memberships (role, joined, group mute, open reports), group bans, safety history (reports), admin history |
| POST | `.../:userId/mute` | `{ duration: 1h\|1d\|1w\|30d\|forever, reason }` (the member gets a notice) |
| POST | `.../:userId/unmute` | `{ reason? }` |
| POST | `.../:userId/suspend` | `{ duration: 1d\|1w\|30d\|forever, reason }` |
| POST | `.../:userId/unsuspend` | `{ reason? }` |

"Pending" = signed up but onboarding not finished (CosQuest has no community-level approval).

**Groups** (user-created groups)
| Method | Path | |
|---|---|---|
| GET | `/api/admin/groups/stats?from&to` | `{ total, active, newGroups, joinRequests, approvalGroups, withReports }` |
| GET | `/api/admin/groups?tab=all\|active\|attention\|archived&kind&q&offset` | owner, members, messages this week, open reports, health (`reports`/`quiet`/`healthy`/`archived`) |
| GET | `/api/admin/groups/:groupId` | the group, new members this week, settings, bans count, admins, pending requests, history |
| PATCH | `/api/admin/groups/:groupId/settings` | `{ joinMode?, whoCanAdd?, memberListVisibility?, reason? }` |
| POST | `/api/admin/groups/:groupId/requests/:requestId/approve\|decline` | `{ reason? }` (respects bans, faction and size limit) |
| POST | `/api/admin/groups/:groupId/archive` / `restore` | `{ reason }` (members get `group:removed` / `chat:preview`) |
