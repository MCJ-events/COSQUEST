# Quests & Events, Phase 1 (admin dashboard + clock-based status)

Builds on the admin dashboard backend (all 6 phases). `validators/admin.js` and `routes/adminRoutes.js` replace Phase 6's.

## What changes for everyone

- **Status follows the clock** (`src/utils/questStatus.js`, your suggestion): only `draft` and `cancelled` are stored decisions; `upcoming` (before `startsAt`), `live` (until `endsAt`) and `completed` are worked out when read. Lists, registration and the home dashboard all use it, so the seeded "live" quest no longer stays live forever and no timer job is needed. `?status=` filters use the clock too; without it, lists hide cancelled quests.
- **USD by default** (`QUEST_CURRENCY` to change). Existing quests keep their stored currency.
- **`isRegistered`** on `GET /api/quests` and `GET /api/quests/:id` for signed-in people (`optionalAuth` on those two routes).
- **Home dashboard**: `user.points` (pointsBalance, i.e. CosXP for now).
- **New quest fields**: `kind` (`quest` | `event`), `location.city`, `location.country`, `requireAtVenue` + `venueRadiusMeters` (stored now; enforced when Join / check-in arrive), `createdBy`, `updatedBy`, `cancelledAt`, `cancelReason`.

## Files

| File | |
|---|---|
| `src/utils/questStatus.js` **new** | `effectiveStatus`, `statusFilter`, `openForRegistration` |
| `src/utils/geocode.js` **new** | Address search with OpenStreetMap Nominatim (no key; 1 request/second; `GEOCODER_URL`, `GEOCODER_USER_AGENT` optional) |
| `src/controllers/adminQuestsController.js` **new** | The admin endpoints below |
| `src/validators/admin.js`, `src/routes/adminRoutes.js` | Replace Phase 6's |
| `test/questsAdmin.js` **new** | 24 checks; register it like the admin suites |
| `apply-quests-phase1.js` | Edits `Quest.js`, `utils/quest.js`, `questController.js`, `questRoutes.js`, `homeController.js`, `AuditEvent.js` (the `quests` area) |

## Admin API (admin token)

| Method | Path | |
|---|---|---|
| GET | `/api/admin/quests/stats` | `{ live, upcoming, drafts, completed, cancelled, registrationsThisWeek }` |
| GET | `/api/admin/quests?tab=all\|live\|upcoming\|draft\|completed\|cancelled&kind=quest\|event&q&offset` | 25 a page |
| GET | `/api/admin/quests/:questId` | `{ quest, counts, registrations (latest 100), history }` |
| POST | `/api/admin/quests` | `{ title, kind?, description?, coverImageUrl?, startsAt, endsAt, location { name, address?, city?, country?, lat, lng }, entryFee { amount }, prizePool { amount }, maxParticipants, faction?, requireAtVenue?, venueRadiusMeters?, publish? }` → a draft (or published) |
| PATCH | `/api/admin/quests/:questId` | any of the fields; time or venue changes tell the registrants; places can't go below registrations |
| POST | `/api/admin/quests/:questId/publish` · `/unpublish` · `/duplicate` | unpublish refused once people are registered (cancel instead) |
| POST | `/api/admin/quests/:questId/cancel` | `{ reason }`: registrants are told, their registrations are cancelled (refunds come with tickets) |
| POST | `/api/admin/quests/cover` | multipart field `cover` (the 5 MB image `upload`) → `{ url, publicId }` (Cloudinary, posts folder) |
| GET | `/api/admin/geocode?q=` | `{ places: [{ label, name, address, city, country, lat, lng }], attribution }` |

Every change is in the audit log (area `quests`).
