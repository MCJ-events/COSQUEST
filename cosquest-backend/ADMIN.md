# Super admin dashboard: backend, Phase 1

The admin dashboard (`cosquest.vercel.app/admin`, website only) is for **platform super admins**: people who look after all of CosQuest. It is separate from group owners/admins (`ConversationMember.role`) and Community/faction room admins (`roomRoles.js`), and **faction rank never gives admin access**.

Phase 1 adds: the super admin role, the dashboard's own sign-in, member **reports**, the **audit log**, readable numbers (`CQ-1042`, `EV-2084`) and the **Overview** endpoint. Later phases add Moderation, Feeds, Chats, Members, Groups, Sparks, Roles & permissions, Settings and the Audit log pages, reusing what already exists (slow mode, group mutes, `GroupBan`, `Block`).

## Files

| New file | What it does |
|---|---|
| `src/models/Counter.js` | Atomic sequences for readable numbers |
| `src/models/Report.js` | A member report; one open report per target (more reporters join it); evidence `snapshot` |
| `src/models/AuditEvent.js` | One admin action. **Append-only**: updates and deletes throw |
| `src/utils/superAdmin.js` | `isSuperAdmin(user)`, beside `roomRoles.js` |
| `src/utils/adminToken.js` | The dashboard's own session token |
| `src/utils/audit.js` | `recordAudit(actor, {...})`, `auditJson(event)` |
| `src/utils/adminStats.js` | Counting helpers (windows, interaction mix, active people, daily series) |
| `src/middleware/requireSuperAdmin.js` | Guard for every `/api/admin` route except signing in |
| `src/controllers/adminAuthController.js` | Sign in (password or app session), me, sign out |
| `src/controllers/reportController.js` | `POST /api/reports` |
| `src/controllers/adminOverviewController.js` | `GET /api/admin/overview` |
| `src/validators/admin.js` | express-validator rules for the above |
| `src/routes/adminRoutes.js`, `src/routes/reportRoutes.js` | Routes |
| `scripts/setSuperAdmin.js` | Make (or remove) a super admin from the server |
| `test/admin.js` | Test suite (register it in `test/runWithMemoryMongo.js`) |
| `apply-admin-phase1.js` | Applies the edits below (run once, then delete) |

## Edits to existing files

`node apply-admin-phase1.js` does these; by hand:

**`src/models/User.js`**, before `lastActiveAt`:
```js
platformRole: { type: String, enum: ['admin', null], default: null },
adminSince: { type: Date, default: null },
adminAssignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
adminSessionId: { type: String, default: null },
```
and after the last index:
```js
userSchema.index({ platformRole: 1 }, { partialFilterExpression: { platformRole: 'admin' } });
```

**`src/routes/index.js`**, after the `/auth` line:
```js
router.use('/admin', require('./adminRoutes')); // /api/admin/* (super admin dashboard)
router.use('/', require('./reportRoutes')); // /api/reports (members report content)
```

**`test/runWithMemoryMongo.js`**: add the suite, e.g. beside the validation suites:
```js
const admin = await require('./admin').run(`http://localhost:${process.env.PORT}`);
result.pass += admin.pass;
result.fail += admin.fail;
```

## Sessions (why the dashboard has its own token)

App sign-in is one device at a time (`currentSessionId`), so signing in on the website would sign a super admin's phone out. The dashboard therefore has **its own session**:

- `POST /api/admin/auth/login { email, password }`, or `POST /api/admin/auth/exchange` with an app token (for Google/Apple accounts without a password). Neither touches `currentSessionId`.
- The token carries `scope: 'admin'` and `User.adminSessionId`, is signed with `ADMIN_JWT_SECRET` (falls back to `JWT_SECRET`), lasts `ADMIN_TOKEN_TTL` (default `12h`).
- Only `/api/admin` accepts it; `requireAuth` refuses it (it has no app session id). An app token never opens `/api/admin`.
- It ends on sign-out, a new dashboard sign-in, an app logout (`tokenVersion`), or losing the role (403 at once).

Passwords are checked with `bcryptjs`, like the app's sign-in. Set `ADMIN_JWT_SECRET` on the server to a different secret from `JWT_SECRET`. App sessions refuse any token with a `scope` (src/utils/token.js), so a dashboard token never works as an app token. The password sign-in has its own rate limit (10 attempts per address per 2 hours, `adminLoginLimiter`).

## API

All errors: `{ error, code? }`; validation errors: `400 { error, errors: [...] }`.

| Method | Path | Auth | Answer |
|---|---|---|---|
| POST | `/api/admin/auth/login` | none | `{ token, admin }` · 401 wrong email/password · 403 `not_admin` |
| POST | `/api/admin/auth/exchange` | app token | `{ token, admin }` · 403 `not_admin` |
| GET | `/api/admin/auth/me` | admin token | `{ admin }` |
| POST | `/api/admin/auth/logout` | admin token | `{ signedOut: true }` |
| GET | `/api/admin/overview?from&to` | admin token | Overview (below); default the last 7 days |
| POST | `/api/reports` | app token | `{ targetType: post\|comment\|message\|profile, targetId, reason, statement? }` → 201 new / 200 joined / 200 `alreadyReported` |

Admin routes answer **401 `admin_signin`** (no/expired/ended session) or **403 `not_admin`** (role removed).

**Report reasons:** `spam, harassment, impersonation, creator_credit, off_topic, hate, violence, self_harm, other`. Spam, harassment, hate, violence and self-harm are **high priority**. Members can't report themselves or their own content; messages only in chats they can see; 30 reports per person per day.

**Overview** returns `stats` (active members, interactions with a 7-day series, active groups, open reports by state), `engagement` (this period and the previous one, per day), `pulse` (feed posts, chat messages, new Sparks, the reactions/comments/replies mix, new members), `queue` (3 open reports, high priority first), `recentActivity` (4 audit events) and `activeGroups` (the 3 busiest groups). Counts use `createdAt`: they assume `PostLike`, `CommentLike` and `MessageReaction` have `{ timestamps: true }`.

## Setting up the first super admin

```sh
node scripts/setSuperAdmin.js <username> --reason "Initial admin"
node scripts/setSuperAdmin.js <username> --remove
```
Both are recorded in the audit log. After that, super admins are invited from the dashboard (Roles & permissions, Phase 5). The script reads `MONGODB_URI` (or `MONGO_URI`).
