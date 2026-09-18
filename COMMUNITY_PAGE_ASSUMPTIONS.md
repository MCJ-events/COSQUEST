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
| 💬 comment count | `POST /api/posts/:postId/comments` |
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

**Message editing and deletion:** editing stamps `editedAt` on the message (kept forever, not just until the next change) so the client can show "(edited)." Deletion has two scopes, both **soft** — the `Message` row is never removed from the database, only flagged, so content stays recoverable/auditable there even once hidden from the API:
- `scope=me` (default): adds the caller to the message's `deletedFor` list. Hidden from that person's own message list from then on, any time after sending, with no effect on anyone else's view.
- `scope=everyone`: sender-only, and only within **5 minutes** of `createdAt`. Sets `deletedForEveryone` + `deletedAt`; every viewer (including the sender) then sees a "This message was deleted." tombstone in place of the real content/media. If the deleted message was pinned, it's automatically unpinned.

**Real-time delivery:** REST + client polling, not WebSockets. Text/image/voice-note messages are the same MongoDB read/write shape as posts and comments, which already scale fine at this app's size. Polling every few seconds is a few seconds slower than push but needs zero new infrastructure; a WebSocket/Socket.io layer can be added later on top of the same `Message` model without changing this API.

**Decisions made building this (flagging in case any need revisiting):**
- Faction-room membership is **not stored** — it's computed live from `user.faction`, so switching factions moves you between faction chats automatically with no join/leave step.
- "Community — General" is a single seeded/find-or-created global room; there's no flow to create additional community rooms.
- Anyone in a conversation can set or clear its pinned message (no admin/moderator concept exists anywhere in this codebase yet).
- The faction room's display name is just the faction's existing `name` (e.g. "Icons") — the mockup's flavor subtitle ("Comic Book Faction") isn't a real per-faction field in `factionModel.js`, so that styling, if wanted, is a frontend label rather than backend data.
- DM search still only works by **exact username** (`POST /api/chats/dm`) — a fuzzy "search people by name" endpoint for the "+" picker does not exist yet and would need to be added when the picker is built.

## Spotlight tab — not started, deferred as requested

Still blocked on a points system that doesn't exist. `User.pointsBalance` exists but nothing increments it — `PROFILE_PAGE_ASSUMPTIONS.md` already flags the points ledger as "intentionally not implemented yet."

Needed later, in order:
1. **What earns points** — quest completion? winning? posting? likes received? Needs an explicit answer before any leaderboard number means anything.
2. **A `PointsTransaction` ledger** rather than incrementing `pointsBalance` directly.
3. **A level formula** — a points-threshold table for "Level 1," "Level 2," etc.
4. **Leaderboard endpoints** — global top-N for the podium, plus per-interest ("realm") boards using the existing `interests[]` field, with each user's rank computed as `countDocuments({ interests: key, pointsBalance: { $gt: user.pointsBalance } }) + 1`.

## Net new surface area (built)

- **Models:** `PostShare`, `PostBookmark`, `Conversation`, `ConversationMember`, `Message`, `MessageReaction`; `lastActiveAt` added to `User`; `shareCount`/`bookmarkCount`/`editedAt` added to `Post`; `editedAt`/`deletedForEveryone`/`deletedAt`/`deletedFor` added to `Message`.
- **Controllers/routes:** `chatController`/`chatRoutes` (new, now including edit and delete-for-me/delete-for-everyone), share/bookmark/my-bookmarks additions to `postController`/`postRoutes`.
- **Media:** `chatUpload` multer config + `storeChatMedia` reuse the existing Cloudinary pipeline, extended with voice-note audio mimetypes.
- **Tests:** `test/smoke.js` covers share/bookmark lifecycle, the full chat flow (community + faction access control, DM creation/idempotency, replies, reactions, pinning, voice notes, unread counts, read receipts), message editing, and both delete scopes including the 5-minute delete-for-everyone cutoff.

## Still deferred

- Spotlight/leaderboard/points/levels (next, per above).
- Hashtag indexing/search.
- Voice/video calling (WebRTC).
- Any moderation: block/report/mute for chats, consistent with the existing moderation deferral in `PROFILE_PAGE_ASSUMPTIONS.md`.
- Fuzzy user search for the DM "+" picker.
- Push/WebSocket delivery (currently polling).
