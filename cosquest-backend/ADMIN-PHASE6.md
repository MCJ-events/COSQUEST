# Super admin dashboard: backend, Phase 6 (finishing touches)

Builds on Phases 1-5. **No edits to existing files**: one new controller, plus `validators/admin.js` and `routes/adminRoutes.js`, which replace Phase 4's.

| Feature | Endpoint | Notes |
|---|---|---|
| **Exports** | `GET /api/admin/overview/export`, `/reports/export`, `/members/export`, `/groups/export`, `/feeds/posts/export` | CSV, up to 5,000 rows. Each takes **the same filters as its page** (it runs the page's own list endpoint page by page, so the export always matches what's on screen). Formula-safe cells (`csvCell` from the audit controller). Each export is recorded (`<name>.export`, area `auth`, so it isn't counted as an admin action) |
| **Search** (top bar) | `GET /api/admin/search?q=` | 2+ characters. Up to 5 each: members (name, @handle, email), groups, posts (removed ones included), reports (CQ number or text), Sparks (module, never DMs) |
| **The bell** | `GET /api/admin/alerts` | New high-priority reports, open reports assigned to you, groups with join requests waiting, pending admin invitations, newest first, each with a link. "Unread" is kept by the website (no new field) |
| **Triage handoff** | `GET /api/admin/reports/triage` | Reports in review per admin (+ high-priority ones), and unassigned high-priority reports |
| **Create group** | `POST /api/admin/groups` `{ name, description?, kind: open\|private, joinMode? }` | The admin is the owner. Uses the community's default slow mode for new groups (Settings). Faction groups stay in the app |
| **Contact owner** | `POST /api/admin/groups/:groupId/contact-owner` `{ message }` | An in-app notice "CosQuest admins about <group>: <message>" to the owner; recorded in the audit log |
| **Create community post** | `POST /api/admin/feeds/posts` `{ content }` | A **text** post (thought, up to 2,000 characters) as the admin's account; followers are notified as usual. **Photo posts:** please send me the upload middleware used by `POST /api/posts` (the multer setup in `postRoutes.js` / `src/middleware/upload.js`) and I'll add them |

Routes: every `/export` and `/triage` route is registered **before** its section's `/:id` route.

Register `test/adminPhase6.js` like the others (20 checks).
