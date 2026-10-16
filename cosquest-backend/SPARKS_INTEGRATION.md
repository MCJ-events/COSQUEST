# Sparks integration (backend)

This backend can now run Sparks on the real Sparks module, `@cosquest/sparks-backend` (version in `vendor/`), instead of the stand-in keyword engine in `src/utils/sparks.js`.

**Turning it on.** Merging this changes nothing by default: `SPARKS_ENGINE` defaults to `legacy`, so the app keeps today's keyword Sparks. The real Sparks detects topics on members' phones through the SDK, so switch to `SPARKS_ENGINE=module` once the Expo app ships the SDK (or once the server fallback worker runs for chats without a capable phone). Everything in this document describes `module` mode. Switching back is the same variable.

What the module does: the trigger gate (3+ messages from 2+ people within 2 minutes), leasing AI jobs to members' phones (detect a topic, sort a message into a Spark, summarize, role pings, call scribe and outline), HPKE encryption of every job input to one phone, Spark state (create, attach, dormancy, revival with seams, merge, pin, delete) and calls. All AI runs on the phones through the Sparks SDK; the backend never sees a model. The module touches our database and sockets only through `src/sparks/`.

Upstream guides (cosquest-sparks repo): `docs/guides/BACKEND_INTEGRATION.md` (the contract this follows), `docs/DATA_CONTRACT.md` (every wire message), `docs/guides/APP_INTEGRATION.md` (the app side).

## 1. What changed

| Where | What |
|---|---|
| `vendor/cosquest-sparks-backend-1.2.1.tgz`, `package.json` | The module, as a `file:` dependency. ESM, Node 20+ |
| `src/sparks/index.js` | The one place it is loaded (`await import(...)` from CommonJS), at startup after Mongo and Socket.IO are up. Socket channel, message hook, manual start, engine switch |
| `src/sparks/mongoStore.js` | `MongoSparksStore`: all ~45 `SparksStore` methods on MongoDB |
| `src/sparks/ports.js`, `members.js` | Socket delivery, membership, admins, history visibility, role pings. Module 1.2 ports: `isMember` (a real member missing from a capped Community/faction list is still a member) and `canReadMany` (one query per job instead of one per message) |
| `src/sparks/rest.js`, `compat.js` | The existing Spark REST endpoints and socket events, served by the module in their old shapes |
| `src/sparks/calls.js` | Call hooks (from `callController.broadcastCallUpdate`) and `GET /api/calls/:callId/outline` |
| `src/models/Message.js` | New fields `seq`, `sparkId`, `sparkRevivalIndex`, `sparkHintState` (existing fields untouched); a pre-save hook assigns `seq` |
| `src/models/MessageSeqCounter.js` | Per-conversation counter (`message_seq_counters`), one atomic `$inc` per message |
| `src/controllers/chatController.js`, `chatExtrasController.js` | Every message insert (send, album, forward) calls the module, in every chat type including DMs. Messages now carry `seq` |
| `src/controllers/sparkController.js` | Dispatches to `src/sparks/rest.js`, or to the old code with `SPARKS_ENGINE=legacy` |
| `src/realtime/socket.js` | Binds each socket to the `sparks` channel |
| `server.js` | `sparks.init()` at startup, `sparks.stop()` on shutdown, `GET /v1/model` |
| `scripts/backfillMessageSeq.js` | `npm run migrate:message-seq`: numbers existing messages |
| `scripts/sparksSmoke.js` | `npm run sparks:smoke`: the real server plus two mock phones |
| `test/sparksStore.js`, `test/sparksModule.js`, `test/helpers/sparksPhone.js` | Store contract tests and the end-to-end test |

### How a Spark happens now

1. A message is saved (`POST /api/chats/:id/messages`, album, forward). The pre-save hook gives it the next `seq` of its chat.
2. `sparks.onMessage(message)` hands it to the module (`onChatMessage`), one message at a time per chat.
2b. (module 1.2.1) A reply to a message that is already in a Spark joins that Spark right here, with no model run and no phone needed (config `replyJoinsSpark`, on by default; it needs `replyToMessageId` on the message row, which `src/sparks/messageRow.js` sends). A reply to a main-chat message is sorted as below.
3. If the author's phone has the model loaded, the module waits up to 20 s for that phone's hint (`message.spark_hint`: which active Spark, if any, the message belongs to). Otherwise another member's phone sorts it (`spark.assign` job).
4. The trigger gate opens a `spark.detect` job when 3+ unsorted messages from 2+ people land within 2 minutes. The job is offered to the best member phone (model loaded, idle, charging, not busy), with its input sealed to that phone's key.
5. The phone answers; the module checks the answer against the rules and creates or revives the Spark.
6. Every member gets `spark.event` on the `sparks` socket event (SDK apps), and everyone viewing the chat gets the old `spark:updated` / `spark:messages` / `spark:deleted` events. The REST endpoints read the same state.

## 2. Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `SPARKS_ENGINE` | `legacy` | `module` switches every Spark endpoint, event and message hook to the real Sparks module; `legacy` (the default) keeps the stand-in engine (section 5) |
| `SPARKS_WORKER` | on | `0` keeps this process from running the module's sweepers (`sparks.start()`: dormancy, summaries, job leases and retries, hint timeouts, call outlines). Exactly one process must run them (section 3) |
| `SPARKS_TIMERS` | production | `demo`: the module's `demoOverrides` (a Spark goes quiet after 75 s instead of 12 minutes). For QA builds only |
| `SPARKS_CONFIG` | none | JSON of config overrides, e.g. `{"exitTimeoutMs":900000}`. Every key is in the module's `dist/config.d.ts` |
| `SPARKS_IMPLICIT_MEMBER_CAP` | 300 | How many engaged members Community and faction rooms report to the module (section 6) |
| `SPARKS_MODEL_MANIFEST_URL` | none | Where `GET /v1/model` redirects: the model manifest the Sparks team publishes. The app's SDK uses `${API}/v1/model` |
| `SPARKS_DEBUG` | off | Logs the module's info lines (job offers) during `npm test` |

`ANTHROPIC_API_KEY` and `SPARKS_AI_MODEL` are only read by the legacy engine.

## 3. Deploying on Render

1. **Node 20 or newer** (the module's requirement). Render's default Node is fine; pin it with `NODE_VERSION=20` (or newer) in the service's environment if the service still pins an older one.
2. **Number the existing messages, once.** In a Render Shell (or locally against the production `MONGODB_URI`): `npm run migrate:message-seq`. It is safe before or after the deploy and safe to run twice. Without it, older messages are simply invisible to Sparks (catch-up history starts at the first new message); nothing breaks.
3. **Deploy.** `npm install` installs the module from `vendor/` (it is committed; there is no registry to reach). On start the logs show `[sparks] module 1.2.1 ready (engine=module, sweepers on)`. The `sparks_*` collections and their indexes, and the two new `messages` indexes, are created at startup.
4. **One sweeper process.** Today the service is one instance, and that instance runs the sweepers: nothing to set. If you scale to more instances (or add a separate worker service), set `SPARKS_WORKER=0` on every instance but one. Running the sweepers twice is not dangerous (job leasing is atomic in Mongo) but wastes work and can open duplicate jobs. More than one web instance also needs the Redis adapter (already wired) so a job offer emitted by one instance reaches a phone connected to another.
5. **Model manifest.** Set `SPARKS_MODEL_MANIFEST_URL` to the manifest URL we give you.

The module keeps a little state in memory per process (the trigger gate's cooldown per chat, recent envelope ids, live call engagement). With one instance that is exact; with several, an occasional duplicate detect job can open, which the idempotency keys and result checks make harmless.

## 4. Upgrading the module

Now: we hand you a new tarball.

```sh
cd cosquest-backend
git rm vendor/cosquest-sparks-backend-1.2.1.tgz
cp ~/Downloads/cosquest-sparks-backend-1.3.0.tgz vendor/
npm install ./vendor/cosquest-sparks-backend-1.3.0.tgz   # rewrites the file: entry and package-lock.json
npm test && npm run sparks:smoke
```

The adapter is deliberately thin (the module's own rules are not copied anywhere here), so a new version drops in. Read its `CHANGELOG.md` for new optional store fields or ports; `src/sparks/mongoStore.js` stores rows as plain documents, so new optional row fields are kept without code changes.

Later: the module is published as a private npm package on GitHub Packages (as `@ubmids/sparks-backend`, installed under its usual name with an npm alias: `"@cosquest/sparks-backend": "npm:@ubmids/sparks-backend@^1.2.1"`, so no code changes). Then `vendor/` goes away, `.npmrc` gets `@ubmids:registry=https://npm.pkg.github.com` plus a read token (a Render secret), and Dependabot or Renovate opens a pull request for every release, which your CI runs `npm test` on.

## 5. Rolling back

Set `SPARKS_ENGINE=legacy` and restart. Then:

- Every Spark endpoint, the old socket events and the message hook use the stand-in engine again, exactly as before this branch (keyword detection, no DMs, optional Claude summaries).
- Sparks made by the stand-in before the switch come back as they were (they were never touched: they live in the `sparks` collection; the module uses `sparks_sparks`). Message markers switch with the engine.
- Sparks made by the module stay in `sparks_*` and reappear when you switch back.
- The `sparks` socket channel answers every frame with `{ error: 'sparks unavailable' }`; SDK phones stay connected and simply get no Spark events.
- `seq` keeps being assigned (harmless).

To roll back the code instead, revert this branch's commits; the new Message fields and `sparks_*` collections can stay or be dropped.

## 6. Compatibility: the app's existing Spark API

URLs, request bodies, status codes and response shapes are unchanged. What the data means now:

| Old field (`GET .../sparks`, `spark:updated`) | Now comes from |
|---|---|
| `id` | the module's `sparkId`, a string like `spk_3f2a9c1b0d4e` (no longer an ObjectId: the app must treat it as opaque, which it already does in URLs) |
| `conversationId` | `chatId` |
| `subject` | the model's subject (2 to 6 words, at most 48 characters) or the member's |
| `summary` | the running summary written on a phone; `''` until the first one (after 5 messages or 90 s) |
| `summarizedByAi` | true once a summary exists |
| `keywords` | the subject's words (the module keeps no keyword list) |
| `active` | `state === 'active'`; quiet (`dormant`) after 12 minutes without messages. Pinned Sparks never go quiet |
| `pinned` | `pinned` |
| `revived` | `revivalIndex > 0` |
| `eras` | the Spark's sessions, one per life: `[{ index, startedAt }]` |
| `messageCount`, `participantCount` | counted from the messages tagged with it (deleted ones excluded) |
| `createdBy`, `startedByBot` | the member who started it, or null for the bot |
| `lastActivityAt`, `createdAt` | `lastMessageAt`, `createdAt` |
| (new) `state`, `revivalIndex`, `seams`, `summaryStale`, `participantIds`, `version`, `mergedInto` | extra module data; ignore or use |

| Old message field | Now |
|---|---|
| `spark: { id, era, postedInSpark }` | `id` = `message.sparkId`, `era` = `message.sparkRevivalIndex` (the Spark's life when the message joined), `postedInSpark` unchanged |
| (new) `seq` | the per-chat sequence number; the app passes it to the SDK |

Panel (`GET .../sparks/:sparkId`): `seams` are the labelled breaks (`[{ beforeMessageId, label }]`, e.g. "5 weeks later"); the quiet folds are in `spark.seams` with `kind: 'fold'`.

Socket events: `spark:updated`, `spark:messages` and `spark:deleted` keep their payloads and fire on the same changes (created, joined, summary, quiet, pinned, revived; deleted and merged as `spark:deleted`, merged with `mergedInto`).

New routes: `GET /api/chats/:id/sparks/native` (the module's own Spark objects, for web clients), `GET /api/chats/:id/sparks/members` (members as Sparks sees them, for the app's `sdk.sparks.setMembers`), `GET /api/calls/:callId/outline`, `GET /v1/model`.

## 7. Differences from the stand-in

| Topic | Stand-in | Module |
|---|---|---|
| **Who detects** | The server, by shared keywords, instantly | Members' phones running the Sparks model. **No phone with the model online = no automatic Sparks** (a detect job waits up to 60 s for one, then lapses). Until the app ships the SDK, only manual starts and panel replies make Sparks. The module has an opt-in server fallback worker (cosquest-sparks `docs/guides/SERVER_WORKER.md`) if that gap matters; it is off by default because it means a server reads chat text |
| Chats | Community, faction, groups | Also **DMs** |
| Follow-up messages | Joined an active Spark that shares a subject word | Sorted by the author's phone (hint) or another member's phone (`spark.assign`) |
| Quiet after | 15 min, computed at read time | 12 min (`exitTimeoutMs`), set by the sweeper and broadcast |
| Revival | A new keyword cluster matching an old Spark | The model's `revive` verdict, a panel reply into a quiet Spark, or a manual "add to it"; each revival gets a seam (fold, or a label for long gaps) stored once |
| Summaries | Built in on every 3 messages, Claude if `ANTHROPIC_API_KEY` | On a phone, every 5 messages or 90 s; empty before the first. No server-side AI, no API key |
| Renaming | Claude could rename bot Sparks | Subjects do not change |
| Duplicate check on manual start | Keyword overlap >= 0.5 | Trigram similarity of subjects >= 0.35 (the module's no-model check); `force: true` skips it as before |
| Subject length | REST 2 to 60 | Same validation; stored up to 48 characters |
| Merge | Kept each message's era; carried `pinned` over; never revived | Moved messages take the target's current revival index; `pinned` is not carried; a quiet target with newer messages becomes active |
| Who manages | Group owners and admins | Same, plus both people in a DM |
| Role pings | Not built | Members whose expertise label the model picks get a mention notification ("A Spark needs Front-end: ...") once per Spark life |
| Calls | Nothing | Consented on-device transcription, live topic colours, post-call outline (needs the SDK's speech files on the phones) |
| Ids | ObjectId | `spk_...` strings |

## 8. Membership as the module sees it

`src/sparks/members.js` mirrors the REST access rules:

- **DM**: the two participants, both admins.
- **Group**: explicit members (owner, admin, member); faction groups also their faction. Owners and admins are admins. Banned people are out.
- **Community and faction rooms** (implicit membership, potentially everyone): the module needs a concrete member list (it goes into AI jobs and decides which phones may work), so these rooms report their *engaged* members: people who opened the room or wrote in it in the last 30 days, most recent first, up to `SPARKS_IMPLICIT_MEMBER_CAP` (300). Nobody is an admin there. Everyone can still read Sparks over REST and the room's socket events; the cap only limits who is sent the `sparks` protocol messages and whose phone may work for that room.
- **Roles** for role pings: the user's expertise label exactly as `expertiseModel.js` spells it ("Quest coordination", "Front-end", "Back-end", "Design", "Community", "Costume crafting", "Photography", "Events"). Readable, one spelling, exact match. Renaming a label in `expertiseModel.js` renames the role.
- **History visibility** (`canRead`): the same access rule as `GET /messages`, minus messages the user deleted "for me". Every message sealed into a job for a phone passes through it.

## 9. Data

New collections: `sparks_devices`, `sparks_outcomes` (2-day TTL), `sparks_sparks`, `sparks_sessions`, `sparks_seams`, `sparks_pings`, `sparks_jobs` (finished jobs kept 7 days, input cleared when done), `sparks_calls`, `sparks_segments`, `sparks_topics`, `sparks_outlines`, `sparks_consents` (append-only), `message_seq_counters`. New `messages` indexes: unique `(conversation, seq)` and `(sparkId, seq)`, both partial (old rows without the fields are not indexed).

Call transcripts (`sparks_segments`) and outlines are kept until you delete them; decide a retention period before calls go live.

## 10. Testing

- `npm test`: everything as before, plus `test/sparksStore.js` (the atomic job methods under concurrency, consent rules, seq assignment and backfill) and `test/sparksModule.js` (the real server, two mock-SDK phones over Socket.IO with real HPKE: device registration, a Spark in a group and in a DM, the old REST and socket API, admin pin refused for members). The stand-in's own suite (`test/sparks.js`) runs with `SPARKS_ENGINE=legacy` and the module suites with `SPARKS_ENGINE=module`, so both paths stay tested.
- `npm run sparks:smoke`: starts `node server.js` against throwaway databases and prints a Spark appearing in a group and in a DM.
- On devices: the checklist in cosquest-sparks `docs/guides/APP_INTEGRATION.md` §12.

## 11. What the Expo app needs next

1. Install the SDK (`@cosquest/sparks-sdk`) in a development build (`expo-dev-client`; Expo Go cannot load it), with `expo-build-properties` for Android `minSdkVersion` 26 and iOS 16.
2. Copy `examples/expo-chat/sparks.js` and follow the Sparks section of `examples/expo-chat/README.md`: one SDK per login with a Socket.IO transport on the `sparks` event, every rendered message (DMs included) fed to `sdk.sparks.ingest`, `setMembers` when a chat opens, the game state, the model download on Wi-Fi.
3. Keep using the REST Spark API for screens; the `useSparks` hook there gives live SDK Sparks when the SDK is running.
4. Full app guide: cosquest-sparks `docs/guides/APP_INTEGRATION.md`.

## 12. Sparks bot posts (module 1.3)

The module can now post in the chat as the "Sparks bot". Two posts exist:

- **Role pings** ("Relevant expertise: Front-end and Back-end."): after a Spark is created or revived, a phone picks the roles it needs. At or above `rolePingMinConfidence` (0.75) the people are notified at once (a mention notification, as before); between `rolePingSuggestMinConfidence` (0.5) and that, the ping is a **suggestion** that waits for an admin. One post per Spark per life lists both.
- **Earlier context** ("Earlier context: Route preview"): when a Spark is created or revived, a phone looks for a related earlier discussion (another, quiet Spark) and the post quotes up to 3 of its messages that every member can read. When no phone can look (jobs lapse after 2 minutes), the module's own subject match (trigram similarity of Spark subjects, no message text compared) is the fallback. At most one post per Spark life, never the same earlier Spark twice.

What this backend does with them:

| Where | What |
|---|---|
| `src/models/Message.js` | New kind `sparks_bot` (no user `sender`) and field `sparksBot` (the module's post). `seq` as for every message |
| `src/sparks/botPosts.js` | `ports.postBotMessage` (save + `message:new` + `chat:preview`) and `ports.updateBotMessage` (save + `message:edited`); per-reader filtering of earlier-context quotes |
| `src/sparks/messageRow.js` | A `sparks_bot` message reaches the module as kind `system` from `sparks-bot` with its `bot` post, so the module never treats it as conversation |
| `src/controllers/chatController.js` | Serialized with `sparksBot` and a Sparks bot `sender` (`isBot: true`); `GET /messages`, `GET /messages/:id` and the jump-to context drop quotes the viewer cannot read; bot posts cannot be edited or forwarded |
| `src/sparks/rest.js` | `POST /api/chats/:conversationId/sparks/bot-posts/:messageId/role-pings/decide` `{ role, decision: 'approve' \| 'dismiss' }`, admins only |

Config (through `SPARKS_CONFIG`): `rolePingMinConfidence` (auto, 0.75), `rolePingSuggestMinConfidence` (0.5; set it to 0.75 or more for no suggestions), `botPosts` (true; false turns every bot post off), `earlierContext` (true), `earlierContextMinScore` (0.9), `earlierContextLexicalMinScore` (0.6; above 1 turns the server fallback off), `earlierContextQuoteMax` (3). For every ping to wait for an admin: `{"rolePingMinConfidence":1.01}`.

Role pings and the phone search need phones running the Sparks SDK (the jobs run on them); until the app ships it, only the earlier-context subject fallback can post. Earlier context runs only on SDK 1.2.5 or newer (`jobMinSdkVersion`).

Vendoring: `vendor/cosquest-sparks-backend-1.2.3.tgz` on this branch is a development build of the module with these changes (same version number). Before merging, replace it with the released tarball and run `npm install ./vendor/<released>.tgz` (section 4), then `npm test`.

## 13. Known gaps

- Ranks: `src/sparks/members.js` gives each member their faction rank (`rank`, the ladder name in lower case, e.g. "staff sergeant") and `index.js` sets the module's `ranks` to the ladder, but only once `src/utils/ranks.js` exists (branch `wale-pages-backend`, `GET /api/ranks`). Until that branch is merged, rank targets in voice commands ("calling all sergeants") match nobody; role targets (expertise labels) work. Targeted calls ring (section 13). Section 14 has the details.
- Manual starts over REST use the module's own `backend.startSpark` (1.2). Before 1.2 they went through a stand-in device per user (`web-<userId>`); any such rows left in `sparks_devices` are harmless and unused.
- Edits and voice-note transcripts that arrive after sending are not re-sent to phones; the module reads the current text whenever it builds a job.

## 13. Module 1.3: Manage Sparks, search inside a Spark, targeted calls

Built against the cosquest-sparks `admin-search` branch (module changes listed under "Unreleased" in its CHANGELOG). App-facing shapes: cosquest-sparks `docs/APP_SPEC_admin_search.md`; summary in API_GUIDE.md (Sparks).

| Where | What |
|---|---|
| `src/sparks/admin.js` | M31: proposed merges (list, accept, dismiss), merging several Sparks at once (`POST .../sparks/merge`), `notifyAdmins` (socket `spark:merge_suggested` + bell) for `ports.onMergeSuggested` |
| `src/sparks/search.js` | M16 limited to one Spark: `GET .../sparks/:sparkId/search` and the in-Spark jump-to-message context. Uses the module's `sparkHistory` (eras, follows merges) and `readableSeqs` (canReadMany) |
| `src/sparks/targetedCalls.js` | `ports.onTargetedCall` rings the targets into the leader's call (or starts one); `ports.commandMembers` (the call's DM plus the groups the leader runs); `GET /api/calls/:callId/command-context` |
| `src/controllers/callController.js` | `inviteToCall`'s body is now `inviteUsers(callId, inviter, { userIds, usernames })`, shared with targeted calls (same checks, same response); new `startCallFor` (a DM call without an HTTP request) |
| `src/sparks/mongoStore.js` | `sparks_merge_suggestions` (unique `pairKey`: a pair is proposed once, ever) and the four optional store methods |
| `test/sparksAdminSearch.js` | 44 checks: proposals live to admins, 403s, accept/dismiss/409, multi-merge all-or-nothing, in-Spark search by era and through a merged id, a command ringing two people with the blocked and busy skipped, batches, a new call when the leader left |

**Vendoring.** These routes need module 1.3 (`admin.mergeMany`, `admin.mergeSuggestions`, `sparkHistory`, `readableSeqs`). With the vendored 1.2.3 they answer `501` and `test/sparksAdminSearch.js` reports the admin and search part as skipped; targeted calls work with 1.2.3 but reach only the call's own DM (1.2.3 ignores `commandMembers`). When the release is cut: replace `vendor/cosquest-sparks-backend-1.2.3.tgz` with the new tarball as in section 4 and run `npm test` (811 checks with it).

## 14. Sparks in voice chats, the full transcript, sharing the outline

Built against the cosquest-sparks `voice-room-sparks` branch (module changes under "Unreleased" in its CHANGELOG). App-facing spec: cosquest-sparks `docs/APP_SPEC_call_extras.md`; endpoints in API_GUIDE.md (Sparks).

**Voice chats are Sparks calls.** Before, only DM calls (`Call`, `callController`) reached the module; Community and faction voice chats (`VoiceRoom`, `voiceRoomController`) did not, so consent, transcription, live topics and outlines did nothing there. `src/sparks/voiceRooms.js` now mirrors each voice chat into the module's call layer the way `calls.js` mirrors calls:

| Voice chat | Sparks call |
|---|---|
| `VoiceRoom._id` (one document per session: it closes when the last person leaves) | call id |
| `conversation` (the Community or faction room) | `chatId` |
| `members` | attendees (`everAttended` keeps everyone who was ever in it) |
| started / members changed / closed | `onCallStarted` / `onCallMembership` / `onCallEnded` |

- **Batched.** `sync()` runs from the controller's coalesced `voice:updated` send (`sendVoiceUpdate`): at most one per interval per voice chat (`CALL_BROADCAST_*`), always the latest member list. In `voiceRooms.js` one sync runs at a time per voice chat and a newer one replaces any waiting one. In the test, 30 people joining at once reached the module as one membership update, and 60 joins and leaves as 3. Someone who joined and left inside one interval is still recorded as having attended (the update's "left" list).
- **Privacy** is the module's, unchanged: a segment is stored and relayed only if the speaker's latest notice decision for that call (or a standing "always") is "accepted".
- **Stale voice chats.** A voice chat whose people all vanished was only closed when someone next opened it. A sweep (every minute, on processes that sync voice chats, not with `SPARKS_WORKER=0`) refreshes voice chats that are live Sparks calls, so the Sparks call ends and its outline is written.
- **Voice commands** do not apply: nobody is an admin of a Community or faction room, so `ports.canIssueTargetedCall` is false; `GET /api/calls/:voiceRoomId/command-context` answers `{ canIssue: false }`.
- **Admins.** The outline and transcript rule (OPEN_QUESTIONS Q9) is "attended, or an admin of the chat"; Community and faction rooms have no admins, so there it is the people who were in the voice chat.

**Full transcript.** `GET /api/calls/:callId/transcript?cursor=&limit=` (a call id or a voice chat id) uses the module's `backend.transcript` (final lines in call order, speaker, start and end, the topic each fell under, the topic markers; keyset paging) and adds `kind` and `speakers` (name and avatar per speaker on the page). Same access as the outline. Paging uses the new optional store method `segmentsPage` (index `sparks_segments (callId, startMs, segmentId)`).

**Share the outline.** `POST /api/calls/:callId/outline/share` uses the module's `backend.shareOutline`, which posts through `ports.postBotMessage` (section 12): a `sparks_bot` message whose `sparksBot` is `{ kind: "call_outline", callId, callKind, headline, title, summary, startedAt, endedAt, topics, speakerIds, sharedBy, sharedAt }`. Why a bot post rather than a normal message with an outline attachment: the 1.3 path already stores, numbers, delivers (`message:new`, chat preview), serializes and protects it (cannot be edited or forwarded) with no change here; the module never treats a bot post as conversation, so the outline's text is not fed back into Spark detection, sorting or summaries; and the app renders it in the bot-post slot it already has, with a typed shape from the SDK. A user message would be detected and sorted into Sparks like any other text. Once per call: the module claims the share on the `sparks_calls` row with the new optional store method `claimOutlineShare` (one atomic update, so two requests on two instances post once), and sharing again returns the same message. If the shared message is deleted, it can be shared again. Who: people who were on it and are in the chat (someone added to a DM call from outside cannot post into that DM), and chat admins.

| Where | What |
|---|---|
| `src/sparks/voiceRooms.js` | New: the voice chat mirror, its batching and the stale sweep |
| `src/controllers/voiceRoomController.js` | `sendVoiceUpdate` calls `voiceRooms.sync`; exports `refreshVoiceRoom` for the sweep |
| `src/sparks/calls.js`, `src/routes/callRoutes.js` | `GET /api/calls/:callId/transcript`, `POST /api/calls/:callId/outline/share` |
| `src/sparks/targetedCalls.js` | `command-context` for a voice chat: `{ canIssue: false }` instead of 404 |
| `src/sparks/mongoStore.js` | `segmentsPage`, `claimOutlineShare`, one index |
| `src/sparks/members.js`, `src/sparks/index.js` | Ranks, when `src/utils/ranks.js` exists (below) |
| `test/sparksVoiceRooms.js`, `test/helpers/sparksPhone.js` | 36 checks (37 with ranks): a faction voice chat end to end with mock-SDK phones (consent, segments, relay, batched membership, outline by phones, transcript paging and access, share and idempotency, the sweep) and the two store methods under concurrency. The phone helper now speaks `call.consent` / `call.segment` and runs outline jobs |

**Ranks** ("calling all sergeants"). The module matches a rank target against `ChatMember.rank`, lower-cased, by position in its config `ranks` (default `private, corporal, sergeant, lieutenant, captain, omega`, not CosQuest's ladder). Branch `wale-pages-backend` adds the ladder (`src/utils/ranks.js`, `GET /api/ranks`, `rankOverride` on User) and shows ranks on message senders, but does not touch `src/sparks/members.js`, so on its own the module would still see no ranks. This branch closes that gap without depending on it: `members.js` selects `pointsBalance rankOverride` and, when `src/utils/ranks.js` is present, sets `rank` to the rank's name in lower case; `index.js` then sets the module's `ranks` to the ladder's names in the same spelling (before `SPARKS_CONFIG`, which can still override), and `command-context` returns them for the SDK. Verified by copying that branch's `src/utils/ranks.js` in locally (not committed): a member with 1,600 points is listed as "sergeant" at the ladder's sergeant position. After both branches are merged nothing else is needed for rank targets to resolve. Two limits remain, by design: commands need an admin (Q7), so they work in DM calls by leaders who run groups (reaching those groups' members), not in Community or faction voice chats; and `RANKS_JSON` names are what people must say ("staff sergeant").

**Vendoring.** The transcript and share routes need a module with `transcript()` and `shareOutline()` (after 1.3.0). With the vendored 1.3.0 they answer `501` and `test/sparksVoiceRooms.js` reports those checks as skipped; the voice chat wiring works with 1.3.0. Developed against a local build (`pnpm pack` in cosquest-sparks `packages/sparks-backend`, `npm install --no-save <tgz>`; not committed). When the release is cut: replace `vendor/cosquest-sparks-backend-1.3.0.tgz` with the new tarball as in section 4 and run `npm test`.


## 14. Module 1.3.1: live summary of the current topic in calls

Built against the cosquest-sparks `live-topic-summary` branch (CHANGELOG "Unreleased"; app side: cosquest-sparks `docs/APP_SPEC_live_summary.md`). While a call runs, the scribe phone writes a 1 to 2 sentence summary of the current topic; the module checks it, stores the latest per topic and sends `call.topic_summary` to the call's attendees over the existing `sparks` channel (`ports.broadcastToCall`), and to someone joining mid-call after the topics so far (`ports.sendToUsers`). No new port, route or socket event is needed here.

| Where | What |
|---|---|
| `src/sparks/mongoStore.js` | `sparks_topic_summaries` (one row per call and topic, `_id` = `callId:topicId`) and the two optional store methods `saveTopicSummary` / `topicSummaries`, so summaries survive a restart and are shared between instances. Without them the module keeps them in memory |
| `test/sparksStore.js` | 4 checks: latest version per topic, first-summarized order, rows as written, calls not mixed |

Config (module defaults; override with the `SPARKS_CONFIG` env JSON, e.g. `{"liveTopicSummary":false}`): `liveTopicSummary` true (false: topics only, as before), `liveTopicSummaryEveryMs` 30,000, `liveTopicSummaryMinLines` 3, `liveTopicSummaryMaxChars` 280.

**Vendoring.** The store methods are unused until the module with live summaries is vendored (the vendored 1.3.0 never calls them, and sends nothing new). When that release is cut: replace the tarball as in section 4 and run `npm test`.

## 15. Module 1.3.2: adaptive deadlines for slow phones

Budget Android phones run the lite model many times slower than an iPhone, and `spark.detect` hit its fixed 60 s deadline on every job (Dammy's tests, 15 and 16 Oct). The module now remembers how long each phone needs per job type and stretches that phone's deadline when it offers it such a job (its time x 1.3 + 5 s, never past `deadlineMaxMs`: detect and assign 4 min). Fast phones keep the usual deadlines. Nothing to change here: the timings live on the device row (`jobMs`) and the job row (`offeredAt`), which `mongoStore.js` already stores as given (`$set` of the patch). A `SPARKS_CONFIG` `deadlineMs` override still works and is the floor. SDK 1.2.7 (app PR on EngrSammy/Cosquest) is the phone side: a faster engine and a detect job that sends its subject when the duplicate check cannot finish in time.
