# Projects and scheduled calls

## Repository audit

The repository already had group membership, chat and document attachments, two Spark engines, instant DM/group calling, and group voice rooms. It did not have project records, project subjects/files, or scheduled meeting records. Those are now implemented in the backend, with Expo integration screens under `examples/expo-chat`.

The full mobile application is not in this repository. These screens must be mounted in that app, and its existing Spark composer/panel and LiveKit call screen supplied through the callbacks described below. Native rendering, device permissions, production Cloudinary uploads and actual media connections still need verification in the app.

## Flow and fields

Group → Projects → project → subject → files and related Sparks. A project also lists upcoming calls. Calls can link to a project, subject and/or existing group Spark.

| Screen/action | Fields and behavior |
| --- | --- |
| New project | Required name; optional description, location, target date, initial subjects. Shared with the existing group. |
| Projects overview | Active/archived tabs, literal name search, subject/file/Spark counts, pagination. |
| Project details | Subject creation, project files, linked Sparks, upcoming calls, archive/restore. Metadata can also be edited through the API. |
| Subject | Name/description, its files, related Sparks, optional file attached to a Spark link. |
| Upload | A visible file selector and separate Upload button. PDF, Word, Excel, PowerPoint, text, CSV, JPEG, PNG, WEBP or GIF; 25 MiB per file. Multiple documents can be uploaded sequentially. |
| Schedule call | Required topic and future date/time/time zone; optional description, project/subject/Spark, invitees; duration; repeat and number of occurrences. |
| Meeting access | Host camera starts on/off; participant cameras allowed/not allowed; invited members/all group members; waiting room; generated passcode. |
| Calls overview | Upcoming, past and cancelled lists; schedule and meet-now actions; pagination. |
| Call details | Invitation link/passcode, share/copy, participants and RSVP, host edits, waiting-room admission, calendar export, cancel. |

Useful project arrangements include event planning (route, costumes, supplies), group work (brief, references, deliverables), and community activities (venue, volunteers, budget). Subjects are flexible folders; a Spark remains a discussion in the existing group.

## Permissions

- Current group members can create/read projects, add subjects/files, link Sparks and schedule meetings. Existing group access rules also apply to faction groups and archived groups.
- Project creator and group admins can edit metadata or archive/restore. Uploaders can remove their own files; creator/admins can remove any project file.
- Archived projects remain readable. Restore before adding subjects/files/Sparks or scheduling a linked call.
- Project, subject, file and Spark references are checked against their parent group/project. Spark IDs are opaque strings; both engines are supported and the engine is recorded with the link.
- Only the meeting host edits/cancels or admits waiting participants. Invited users RSVP. Every join checks current group membership again.
- A group member who is not invited to an invited-only call can see the group planning card but cannot retrieve its invitation/passcode, export its calendar entry, or join. Sharing a link does not bypass group membership.

## API

All routes below start with `/api` and require a completed, authenticated account (`Authorization: Bearer …`). IDs in URLs must be URL encoded.

| Method | Route | Purpose |
| --- | --- | --- |
| GET/POST | `/groups/:groupId/projects` | List/create projects. GET: `status=active\|archived`, `q`, `offset`. |
| GET/PATCH | `/projects/:projectId` | Details or metadata/archive update. |
| POST | `/projects/:projectId/subjects` | `{ "name": "Route & meetup", "description": "…" }`. |
| GET | `/projects/:projectId/files` | `subjectId`, `sort=newest\|oldest\|name`, `offset`. |
| POST | `/projects/:projectId/files` | Upload to the project. Multipart field **`file`**. |
| POST | `/projects/:projectId/subjects/:subjectId/files` | Upload to a subject. Multipart field **`file`**. |
| DELETE | `/projects/:projectId/files/:fileId` | Remove a file and clear attachment pointers from Spark links. |
| POST | `/projects/:projectId/sparks` | Link/update `{ sparkId, subjectId?, fileId? }`. An attached file must be in the selected subject (or at project level when no subject is selected). |
| GET/POST | `/groups/:groupId/scheduled-calls` | List/create calls. GET: `view=upcoming\|past\|cancelled`, `offset`. |
| POST | `/groups/:groupId/meet-now` | Same creation fields, with current start time and no repeat. |
| GET/PATCH | `/scheduled-calls/:callId` | Details or host edit of one upcoming occurrence. |
| POST | `/scheduled-calls/:callId/rsvp` | `{ "response": "accepted" }` or `declined`. |
| POST | `/scheduled-calls/:callId/cancel` | Cancel one occurrence and notify participants. |
| GET | `/scheduled-calls/:callId/calendar.ics` | Authenticated calendar download for one occurrence, with a ten-minute alarm. |
| GET | `/call-invitations/:code` | Resolve a shared invitation after login. |
| POST | `/scheduled-calls/:callId/join` | `{ "passcode": "123456" }`; host does not need a passcode. |
| POST | `/scheduled-calls/:callId/admission/:userId` | Host sets `{ "status": "admitted" }` or `denied`. |

Project creation:

```json
{
  "name": "Next CosQuest",
  "description": "Plan our Saturday meetup",
  "location": "Chicano Park",
  "dueAt": "2026-11-07",
  "subjects": [{ "name": "Route & meetup" }, { "name": "Costumes" }]
}
```

Scheduling (replace IDs and date with real group data and a future date):

```json
{
  "topic": "CosQuest planning call",
  "description": "Confirm the route and supplies",
  "date": "2026-11-06",
  "startTime": "18:00",
  "timeZone": "Africa/Lagos",
  "durationMinutes": 30,
  "repeat": "weekly",
  "occurrences": 4,
  "participantIds": [],
  "hostVideo": true,
  "participantVideo": false,
  "whoCanJoin": "invited",
  "waitingRoom": true
}
```

Each linked Spark in `GET /projects/:projectId` (`sparks[]`) carries `latestMessage` for the subject card's preview line ("Maya: Yes! Meet by the mural at 10?"): `{ id, senderId, senderName, kind, text, createdAt }`, or `null` when the Spark has no messages yet. Messages deleted for everyone, deleted by this viewer for themselves, Sparks bot posts and call entries are skipped. `text` is empty for non-text kinds (`image`, `file`...), which the app labels by `kind`.

Optional context: `projectId`, `subjectId`, `sparkId`. A subject needs its project. These may be set to null to unlink. A call's Spark must belong to the group; it need not already be linked to the project.

Provide either `date` + `startTime` (local wall time in `timeZone`) or `startsAt` (ISO timestamp with an explicit UTC offset). Duration is 5–480 minutes. First scheduling date is within one year. `none`, `daily`, and `weekly` repeats materialize 1–52 independent occurrences with a shared `seriesId`. Weekly/daily calls retain wall time across daylight-saving changes. Nonexistent local times are rejected. For an ambiguous repeated hour, supply `startsAt` with the intended offset. Editing/cancellation/calendar export affect one occurrence; whole-series editing/export is not implemented. Editing time resets RSVPs and the reminder.

Lists return up to 50 records and `nextOffset`. Project details preview up to 500 files and 10 upcoming calls; use the paginated file/call lists for the rest. Projects support up to 100 subjects and 500 Spark links; calls support up to 100 explicit invitees.

`join` opens ten minutes before start and closes at the scheduled end. Waiting users receive HTTP 202 `{ status: "waiting", callId }`, without a media token. Once admitted they retry join to receive `{ status: "ready", token, livekitUrl, roomName, videoEnabled }`. Tokens last up to five minutes and camera publishing is denied when participant video is disabled. `hostVideo` controls the host camera's initial state, not permission to turn it on later.

Cancelling prevents new join tokens and notifies clients. This scheduling layer does not forcibly end an already-connected LiveKit session or revoke an already-issued token. The host app should disconnect on cancellation/end; comprehensive live moderation and media webhooks are separate from scheduling. Existing DM/voice-room calls and their Sparks transcript/outline lifecycle remain independent; new scheduled calls currently link existing group Sparks and do not create call transcripts automatically.

## Upload and notification services

Uploads reuse existing Cloudinary configuration and media cleanup. Images use image assets; documents use raw assets. The API authorizes access to file metadata, while hosted URLs use the repository's existing shareable-media behavior; they are not authenticated document-download links. No production storage service was invoked during testing.

Meeting invitations, updates, cancellations and ten-minute reminders create in-app notifications with `scheduledCallId`. Expo push uses existing device registration and `eventReminders` preferences. `notification:new`, `scheduled-call:updated`, `scheduled-call:waiting` and `scheduled-call:admission` events support live UI refresh. Project changes emit `project:updated` with `projectId`.

The reminder worker starts with the backend and scans every 30 seconds. It only sends upcoming reminders (missed reminders are not sent after start). Notification delivery keys prevent repeat insertion across workers. Set `MEETING_REMINDERS_WORKER=0` on instances that should not scan. Calendar alarms also work independently after import.

Set the existing `APP_WEB_URL` to the app's HTTPS entry point to produce `/call/:code` links; otherwise invitations use `cosquest://call/:code`. The mobile/web host app must handle that route, authenticate the viewer, call `resolveInvite(code)`, then open the returned call detail screen. Backend invitation resolution does not require a public page exposing meeting information.

## Expo integration

Copy `projectsCallsApi.js` and `ProjectsAndCalls.js` with the existing attachment helpers into the actual Expo app. Use that app's Expo-compatible versions of `expo-file-system`, `expo-image-picker`, `expo-image-manipulator`, `expo-document-picker`, `expo-clipboard` and `expo-sharing`. This repository's example folder is not a runnable Expo project.

```js
const api = useMemo(() => createProjectsCallsApi({ baseUrl, getToken }), [baseUrl, getToken]);

// JSX in the consuming app:
<ProjectsAndCalls
  key={groupId}
  api={api}
  groupId={groupId}
  onOpenSpark={(sparkId, conversationId) => openExistingSparkPanel(conversationId, sparkId)}
  onStartSpark={context => openExistingSparkComposer(context)}
  onJoin={(connection, meeting) => openExistingLiveKitScreen(connection, meeting)}
/>
```

`onStartSpark` receives `{ projectId, conversationId, subjectId, fileId, onLinked }`. Use the existing chat composer/message picker to supply a seed `messageId` and Spark subject, then call `api.startProjectSpark({ ...context, messageId, subject })`. Existing Spark duplicate-choice behavior remains in effect. After linking, call `context.onLinked()`. If creation succeeds but linking fails, the thrown error's `createdSpark` identifies the Spark to relink with `api.linkSpark`; do not create a second Spark.

`ProjectForm`, `ProjectUploadField`, `ScheduleCallForm`, and `ScheduledCallDetail` are also exported individually for an existing navigator. Mount each with a key for the current project/group/call so pending state does not move between contexts. The example uses editable date/time/time-zone fields and API validation; native date/time pickers can replace those fields in the host app. File selection cancellation and failed upload retain the screen state. File selection is single-file with a separate confirm/upload action.

The detail screen can share/copy invitations, export `.ics` through native sharing, poll admission/RSVP, and pass a validated connection to the app's LiveKit screen. Its join/Spark actions require the callbacks above. No stub call connection is presented as a working media session.

## Tests

`npm run test:planning` starts temporary MongoDB and tests real HTTP routes. It covers required fields, membership, search, subjects, uploads and limits, archive/restore, file ownership, cross-group/context rejection, both Spark engines, scheduling validation, invitations, RSVP, calendar data, repetition and DST, host edits/cancellation, admission/token camera grants, removed members and reminder deduplication.

The same suite is included in `npm test` alongside the existing backend regression tests. Media storage and Expo pushes use the repository's existing test behavior; LiveKit JWTs are real signed test tokens, but no live media service is contacted.

Verified on October 23, 2026: focused suite **13 passed, 0 failed**; full backend suite **995 passed, 0 failed**. New backend/client JavaScript syntax checks and Git whitespace checks passed. The Expo screens have not been rendered or run on a mobile device here.

## Reference image

The cleaned reference is saved at `docs/design/projects-calls-reference.png`. The built-in imagegen tool edited the two supplied images into one readable six-screen reference board; the original screenshots remain the source of truth for small labels.

Prompt used: “Edit the two attached UI reference images to make a single high-resolution, clear reference board, arranged as two rows of three full phone screens: Projects overview, Project detail, Subject files; Calls upcoming, Schedule a call, Call details. Preserve all six original screens, information, controls, navigation and text faithfully, including document upload field, related Sparks, scheduling settings and participants. Increase clarity, legibility and contrast, crisp navy text, white cards, light cyan gradients and pink buttons matching originals. Keep all screens uncropped with ample spacing and readable labels. This is a cleanup of existing references, not a redesign. Do not invent features or replace source content.”
