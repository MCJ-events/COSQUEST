# Super admin dashboard: backend, Phase 5 (Roles & permissions, Settings, Audit log)

Builds on Phases 1-3 (Phase 4, Sparks, comes separately). **No edits to existing files** in this phase: only new files, plus `validators/admin.js` and `routes/adminRoutes.js`, which replace Phase 3's.

## Files

| File | |
|---|---|
| `src/models/AdminInvitation.js` **new** | An invitation to become a super admin (pending → accepted / declined / revoked; 7 days) |
| `src/models/CommunitySettings.js` **new** | One document (`_id: 'community'`) with a `version` |
| `src/controllers/adminRolesController.js` **new** | Admins, matrix, invitations, revoke, access reviews, and the invitee's accept/decline |
| `src/controllers/adminSettingsController.js` **new** | Read/save settings (allowed fields only, version check) |
| `src/controllers/adminAuditController.js` **new** | Audit log: stats, list/search/filters, detail, CSV export |
| `src/validators/admin.js`, `src/routes/adminRoutes.js` **replace Phase 3's** | Phases 1-3 and 5 |
| `test/adminPhase5.js` **new** | Register it like the others |

## Roles & permissions

- **Inviting** needs a reason and an **existing CosQuest account** (`member`: `@username` or email). The person gets an in-app notice (no email service yet).
- **An invitation grants nothing until accepted**, by the invited person **with their own app session** (`/api/admin/invitations/:id/accept`; these routes sit before the super admin guard). Nobody else can accept it; revoked or expired (7 days) ones can't be accepted.
- **Revoking an admin** ends their dashboard session at once. You can't revoke yourself, and the last super admin can't be removed.
- **Access reviews** are recorded (next one suggested 30 days later).

| Method | Path | Auth | |
|---|---|---|---|
| GET | `/api/admin/roles` | admin | `{ admins, invitations, matrix, accessReview }` |
| POST | `/api/admin/roles/invitations` | admin | `{ member, reason }` → 201 |
| POST | `/api/admin/roles/invitations/:id/resend` · `/revoke` | admin | revoke: `{ reason }` |
| POST | `/api/admin/roles/admins/:userId/revoke` | admin | `{ reason }` |
| POST | `/api/admin/roles/review` | admin | `{ note? }` |
| GET | `/api/admin/invitations/mine` | **app** | my pending invitations |
| POST | `/api/admin/invitations/:id/accept` · `/decline` | **app** | 409 not pending, 410 expired |

## Settings

`GET /api/admin/settings` → `{ settings, version, updatedAt, updatedBy, needsEmail }` · `PATCH /api/admin/settings` → `{ version, changes: { section: { field: value } }, reason? }`.

- Only the listed fields can change (identity, guidelines, privacy, notifications, moderation); each value is checked.
- **`version`** must match: if another admin saved first → 409 `stale_settings`, nothing overwritten.
- Each save is one audit event with **only the changed fields**, before and after.
- `notifications.dailyDigest`, `digestTime`, `digestTo` are **stored but need an email service** (listed in `needsEmail`).
- The settings are stored for the dashboard; wiring them into behaviour (e.g. `newGroupSlowMode` when a group is created, `reportRouting` when a report arrives) is a small follow-up per setting, whenever you want.

## Audit log

| Method | Path | |
|---|---|---|
| GET | `/api/admin/audit/stats` | today: `{ actions, actingAdmins, reportsDecided, roleChanges }` |
| GET | `/api/admin/audit?q&actor&area&action&from&to&offset` | `q`: EV number, target, reason or action |
| GET | `/api/admin/audit/:eventId` | the event + its report |
| GET | `/api/admin/audit/export?<filters>` | CSV, up to 5,000 events; cells that start with `= + - @` are prefixed with `'` so spreadsheets never run them. The export itself is recorded |
