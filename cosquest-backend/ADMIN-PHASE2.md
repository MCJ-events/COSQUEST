# Super admin dashboard: backend, Phase 2 (Moderation, Feeds, Chats)

Builds on Phase 1 (apply that first). Super admins act **anywhere** (any group, including on group owners), but never on themselves or on other super admins (those are managed in Roles & permissions). **Every action needs a reason**, is **recorded in the audit log**, **tells the author** (a CosQuest notice, unless `notifyAuthor: false`) and **closes the open reports** on that content.

## Files

| File | |
|---|---|
| `src/utils/adminContent.js` **new** | The actions: remove/restore a post, remove a comment, delete a message, slow mode, mute/unmute/remove/ban in a group |
| `src/controllers/adminReportsController.js` **new** | Moderation: stats, queue, review, assign, decide |
| `src/controllers/adminFeedsController.js` **new** | Feeds: stats, posts, a post, remove, restore |
| `src/controllers/adminChatsController.js` **new** | Chats: stats, conversations, messages in context, delete, slow mode, member actions |
| `src/validators/admin.js` **replaces Phase 1's** | Phase 1 rules + Phase 2 |
| `src/routes/adminRoutes.js` **replaces Phase 1's** | Phase 1 routes + Phase 2 |
| `test/adminPhase2.js` **new** | Register it in `test/runWithMemoryMongo.js` like `test/admin.js` |
| `apply-admin-phase2.js` | The edit below (run once, then delete) |

## Edit to an existing file: `src/models/Post.js`

Admin removal **hides** a post and **keeps** it as evidence (the designs' "Removed" tab, "an evidence snapshot remains"). The author's own delete is unchanged (still erases it).

After `editedAt`:
```js
removedAt: { type: Date, default: null },
removedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
removedReason: { type: String, default: null, maxlength: 1000 },
```
After the indexes:
```js
postSchema.index({ removedAt: 1, createdAt: -1 });
function hideRemoved() {
  if (this.getOptions().includeRemoved) return;
  if (this.getQuery().removedAt === undefined) this.where({ removedAt: null });
}
postSchema.pre(['find', 'findOne', 'countDocuments', 'findOneAndUpdate', 'updateOne', 'updateMany'], hideRemoved);
```
This hides removed posts from **every existing query** (feeds, profiles, a post by id, counts, like/comment counters) with no change to postController. Only the dashboard passes `.setOptions({ includeRemoved: true })`. **Please check:** if `listPosts` / `listUserPosts` (or anything else) uses `Post.aggregate`, add `{ removedAt: null }` to its `$match` (aggregations don't run these hooks).

## API (admin token)

**Moderation**
| Method | Path | Body / query | Answer |
|---|---|---|---|
| GET | `/api/admin/reports/stats` | | `{ open, new, inReview, high, resolvedToday }` |
| GET | `/api/admin/reports` | `status=open\|new\|in_review\|resolved\|dismissed`, `type`, `priority`, `assignee=me\|none\|<id>`, `q` (CQ number, text, @handle), `offset` | `{ reports, total, nextOffset }` (25 a page; open: high priority first) |
| GET | `/api/admin/reports/:id` | | `{ report (with reporters), target (as it is now), author (history), actions, history }` |
| POST | `/api/admin/reports/:id/assign` | `{ adminId? }` | `{ report }` (→ in review) |
| POST | `/api/admin/reports/:id/decision` | `{ action, reason, notifyAuthor? }` | `{ report, auditEvent }` |

Actions: post `remove_post\|dismiss` · comment `remove_comment\|dismiss` · message `delete_message\|dismiss` · profile `dismiss` (member restrictions come with the Members page). 409 when already decided, 410 when the content no longer exists.

**Feeds**
| Method | Path | |
|---|---|---|
| GET | `/api/admin/feeds/stats?from&to` | `{ posts, reactions, openReports, removed }` |
| GET | `/api/admin/feeds/posts?tab=all\|reported\|removed&type&q&offset` | posts with status and open report counts |
| GET | `/api/admin/feeds/posts/:id` | `{ post, reports, history }` |
| POST | `/api/admin/feeds/posts/:id/remove` | `{ reason, notifyAuthor? }` |
| POST | `/api/admin/feeds/posts/:id/restore` | `{ reason }` |

**Chats** (groups, the Community room and faction rooms; **DMs are never browsable**: a reported DM message is reviewed from its report only)
| Method | Path | |
|---|---|---|
| GET | `/api/admin/chats/stats?from&to` | `{ messages, activeGroups, totalGroups, openReports, slowMode }` |
| GET | `/api/admin/chats/conversations?filter=all\|reported&q&offset` | last message, messages this week, open reports, members, slow mode |
| GET | `/api/admin/chats/conversations/:id/messages?around=<messageId>` (or `before=`) | 25 around a message (or 30 latest), with report markers and group roles |
| POST | `/api/admin/chats/messages/:id/delete` | `{ reason, notifyAuthor? }`: the "deleted by an admin" tombstone, live `message:deleted` |
| POST | `/api/admin/chats/conversations/:id/slow-mode` | `{ seconds: 0\|10\|30\|60\|300\|3600, reason? }` |
| POST | `.../members/:userId/mute` | `{ duration: 1h\|1d\|1w\|forever, reason }` (uses `mutedByAdminUntil`) |
| POST | `.../members/:userId/unmute` | `{ reason? }` |
| POST | `.../members/:userId/remove` | `{ reason }` (`code: use_ban` for people in a faction group by faction) |
| POST | `.../members/:userId/ban` | `{ reason }` (uses `GroupBan`) |

Member actions are for groups (Community/faction room restrictions come with the Members page). They reuse the existing fields, so the app's own checks (`canSendToConversation`, bans, `group:removed`) apply unchanged.
