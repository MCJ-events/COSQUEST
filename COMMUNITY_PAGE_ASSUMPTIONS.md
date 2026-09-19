# CosQuest Community Page — API Gap Analysis & Assumptions

This note maps the three Community tabs (Feeds, Chats, Spotlight) to the `cosquest-backend` API, records what's built, and what's still deferred. Kept outside `cosquest-backend`, alongside [PROFILE_PAGE_ASSUMPTIONS.md](PROFILE_PAGE_ASSUMPTIONS.md) and [API_USAGE_AND_FLOWS.md](API_USAGE_AND_FLOWS.md).

## Feeds tab — done

| Screen element | Backend support |
| --- | --- |
| "Share Your Cosplay Or A Hot Take..." composer | `POST /api/posts` |
| Author avatar, name, timestamp | `post.author`, `post.createdAt` (relative time is a client-side render) |
| Post image/video | `post.media[]` (Cloudinary) |
| Caption + hashtags | `post.content` — tags are plain substrings; there is no tag index or `#tag` search yet (not required by anything visible on this screen) |
| ❤️ like count | `POST/DELETE /api/posts/:postId/likes` |
| 💬 comment count, plus replies under a comment | `POST /api/posts/:postId/comments` (add `parentComment` to reply, one level deep); `GET /api/posts/:postId/comments?parentComment=:commentId` for a comment's replies |
| 🔁 share/repost count | `POST/DELETE /api/posts/:postId/shares` |
| 🔖 bookmark/save count | `POST/DELETE /api/posts/:postId/bookmarks`, `GET /api/users/me/bookmarks` |
| 🔔 bell (unread notifications) | `GET /api/users/me/notifications` |

## Chats tab — done

Built as a new subsystem: `Conversation`, `ConversationMember`, `Message`, `MessageReaction` models, and a full `chatController`/`chatRoutes`. See [API_USAGE_AND_FLOWS.md](API_USAGE_AND_FLOWS.md) for the endpoint table.

| Screen element (from the DM/Community chat mockups) | Backend support |
| --- | --- |
| "Your Space": Community — General, ICONS (faction room) | `GET /api/chats` — one global community room + the caller's current faction room, both find-or-created on first access |
| Direct Message list + "+" new DM | `POST /api/chats/dm` (find-or-create by username) |
| Text messages | `POST /api/chats/:id/messages` with `content` |
| Voice notes with waveform/duration | Same endpoint, multipart `media` file (MP3/M4A/WEBM/OGG/WAV) → `message.kind: 'audio'`, `media.durationSeconds` |
| Images in chat | Same endpoint, multipart `media` (JPEG/PNG/WEBP/GIF) → `message.kind: 'image'` |
| Quoted/reply messages ("Emmanuel Wemida ... i PURPOSELY DO AM") | `replyTo` field on send; each message returns a `replyTo` snippet (sender + preview) |
| Emoji reactions row | `POST/DELETE /api/chats/:id/messages/:messageId/reactions` — one reaction per user per message, grouped counts with `mine` on read |
| Pinned message banner | `PATCH /api/chats/:id/pinned-message` — any member can pin/unpin; there is no moderator role in this app yet, so this is intentionally unrestricted |
| Read-receipt checkmarks on sent DM bubbles | `message.read` (DM only) — computed from the recipient's `lastReadAt`, updated via `PATCH /api/chats/:id/read` |
| "Active 7h ago" presence | `User.lastActiveAt`, touched (throttled to once per 5 minutes) by `requireAuth` on every authenticated request, surfaced on a DM's `otherParticipant` |
| "507 messages" header count | `conversation.messageCount`, denormalized like `Post.likeCount` |
| Unread badges on chat rows | `chat.unreadCount` on `GET /api/chats`, from messages newer than the caller's `lastReadAt` |
| 📞 🎥 call icons | **Not built.** UI-only for now — real calling needs WebRTC signaling infrastructure, out of scope here. |
| Edit a sent message | `PATCH /api/chats/:id/messages/:messageId` — sender-only, stamps `editedAt` (no time limit) |
| Delete a message | `DELETE /api/chats/:id/messages/:messageId?scope=me\|everyone` — see below |
| "Seen" on a message | `GET /api/chats/:id/messages/:messageId/seen` — who has read up to this message (excluding the sender), reusing the same `lastReadAt` the unread badge/DM checkmark already track; 0-1 people in a DM, potentially many in a room |
| Forward a message | `POST /api/chats/:id/messages/:messageId/forward` with `{ targetConversationId }` (a conversation the caller already belongs to — Community, their faction room, or a DM they're in; `403` for anywhere else) **or** `{ targetUsername }` (any user found via `GET /api/users/search` — the DM is found-or-created automatically, so you can forward to someone you haven't messaged yet). Exactly one of the two is required. Copy is flagged `forwarded: true`, independent of the original from then on |
| Search people to forward/DM with | `GET /api/users/search?search=jamie` — username/first/last name, case-insensitive. This is the fuzzy "search people by name" endpoint the DM "+" picker was missing (see "Still deferred" below, now resolved) — not gated by profile visibility (it's for finding someone to message, not viewing their profile), but blocks still hide people from it in both directions |
| Long-press "Copy" | **Frontend-only** — copies the already-loaded `message.content` to the clipboard, no API call |
| Emoji reactions row (as quick replies on a **post**) | Post-level "reactions" shown in some mockups are frontend-only shortcuts that submit a real comment — there's no separate reaction storage/endpoint for posts. (Chat-message reactions above are real and backend-backed.) |
| Blocking someone in a chat context | `POST/DELETE /api/users/:username/block` (see `PROFILE_PAGE_ASSUMPTIONS.md`) — blocks unconditionally hide the profile and refuse new DMs/follows in both directions; the chats list/UI is expected to use the existing `GET /api/users/me/blocked` to grey out or hide a blocked person, there is no separate per-chat block flag |
| Stories | **Deferred, not started**, per explicit product decision |

**Message editing and deletion:** editing stamps `editedAt` on the message (kept forever, not just until the next change) so the client can show "(edited)." Deletion has two scopes, both **soft** — the `Message` row is never removed from the database, only flagged, so content stays recoverable/auditable there even once hidden from the API:
- `scope=me` (default): adds the caller to the message's `deletedFor` list. Hidden from that person's own message list from then on, any time after sending, with no effect on anyone else's view.
- `scope=everyone`: sender-only, and only within **5 minutes** of `createdAt`. Sets `deletedForEveryone` + `deletedAt`; every viewer (including the sender) then sees a "This message was deleted." tombstone in place of the real content/media. If the deleted message was pinned, it's automatically unpinned.

**Real-time delivery:** REST + client polling, not WebSockets. Text/image/voice-note messages are the same MongoDB read/write shape as posts and comments, which already scale fine at this app's size. Polling every few seconds is a few seconds slower than push but needs zero new infrastructure; a WebSocket/Socket.io layer can be added later on top of the same `Message` model without changing this API.

**Decisions made building this (flagging in case any need revisiting):**
- Faction-room membership is **not stored** — it's computed live from `user.faction`, so switching factions moves you between faction chats automatically with no join/leave step.
- "Community — General" is a single seeded/find-or-created global room; there's no flow to create additional community rooms.
- Anyone in a conversation can set or clear its pinned message (no admin/moderator concept exists anywhere in this codebase yet).
- The faction room's display name is just the faction's existing `name` (e.g. "Icons") — the mockup's flavor subtitle ("Comic Book Faction") isn't a real per-faction field in `factionModel.js`, so that styling, if wanted, is a frontend label rather than backend data.
- `POST /api/chats/dm` still requires an **exact username** — the fuzzy "search people by name" endpoint for the "+" picker (`GET /api/users/search`) exists now (see the Chats tab table above) but `startDirectMessage` itself is unchanged; the picker is expected to call search first, then `POST /api/chats/dm` with the exact username it found. (This is a different endpoint from followers/following search — see `PROFILE_PAGE_ASSUMPTIONS.md`.)

## Spotlight tab — not started, deferred as requested

Still blocked on a points system that doesn't exist. `User.pointsBalance` exists but nothing increments it — `PROFILE_PAGE_ASSUMPTIONS.md` already flags the points ledger as "intentionally not implemented yet."

Needed later, in order:
1. **What earns points** — quest completion? winning? posting? likes received? Needs an explicit answer before any leaderboard number means anything.
2. **A `PointsTransaction` ledger** rather than incrementing `pointsBalance` directly.
3. **A level formula** — a points-threshold table for "Level 1," "Level 2," etc.
4. **Leaderboard endpoints** — global top-N for the podium, plus per-interest ("realm") boards using the existing `interests[]` field, with each user's rank computed as `countDocuments({ interests: key, pointsBalance: { $gt: user.pointsBalance } }) + 1`.

## Net new surface area (built)

- **Models:** `PostShare`, `PostBookmark`, `Conversation`, `ConversationMember`, `Message`, `MessageReaction`, `Block`; `lastActiveAt`/`privacy` added to `User`; `shareCount`/`bookmarkCount`/`editedAt` added to `Post`; `editedAt`/`deletedForEveryone`/`deletedAt`/`deletedFor`/`forwardedFrom` added to `Message`; `parentComment`/`replyCount` added to `PostComment`.
- **Controllers/routes:** `chatController`/`chatRoutes` (new, now including edit, delete-for-me/delete-for-everyone, seen-by, and forward), share/bookmark/my-bookmarks/comment-threading additions to `postController`/`postRoutes`, `blockController`/`privacyController` for blocking and visibility.
- **Media:** `chatUpload` multer config + `storeChatMedia` reuse the existing Cloudinary pipeline, extended with voice-note audio mimetypes. Forwarding copies the same Cloudinary `media` reference rather than re-uploading.
- **Tests:** `test/smoke.js` covers share/bookmark lifecycle, the full chat flow (community + faction access control, DM creation/idempotency, replies, reactions, pinning, voice notes, unread counts, read receipts, seen-by, forwarding by conversation id and by username), message editing, both delete scopes including the 5-minute delete-for-everyone cutoff, comment threading (reply, one-level-deep enforcement, cascade delete), followers/following search, people search, and privacy/blocking.

## Still deferred

- Spotlight/leaderboard/points/levels (next, per above).
- Hashtag indexing/search.
- Voice/video calling (WebRTC).
- Reporting and mute for chats (blocking itself is implemented — see the Chats tab table above and `PROFILE_PAGE_ASSUMPTIONS.md`).
- Push/WebSocket delivery (currently polling).
