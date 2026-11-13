# brief-features-app: merge notes for build 25

Branch `brief-features-app`, off build-23 (84eeb3e). The app half of the brief features of 13 Nov 2026:
referrals, carnival and costume booth challenges with event staff, and the comic panel puzzle. The
server half is `ubmids/costquest-backend` branch `brief-features-20261113`; its contract is
`BRIEF-FEATURES.md` in that branch.

## Nothing changes while the server flags are off

Every new screen and entry point asks `GET /v1/brief/flags` first (cached for a minute; a server without
the route, or a failed ask, counts as all off). With the flags off, Wale's Home menu is his frame exactly,
and a deep link to a new screen shows "isn't open yet".

| Screen (route) | Shown when | Reached from |
|---|---|---|
| Invite a friend (`/wale/invite?code=`) | `referrals` | Home menu INVITE; `cosquest://referral?code=CODE`; `https://<api>/r/CODE` |
| Events near you, one event (`/wale/event?game=`) | `stations_v2` | Home menu EVENTS; `cosquest://event?game=ID` |
| Booth challenge (`/wale/challenge?game=&station=&code=`) | `stations_v2` and `venue_challenges` | a carnival or costume station in the event; a booth's QR `cosquest://station?game=&station=&code=` |
| Comic panel puzzle (`/wale/puzzle?game=&station=`) | `stations_v2` and `comic_puzzles` | a puzzle station in the event |
| Staff desk (`/wale/staff?game=`) | `stations_v2` and `venue_challenges` | the event's "Event staff" button; "You are staff at" on the Events list (only when the player is staff somewhere) |

These routes are NOT behind `EXPO_PUBLIC_WALE_UI` (a friend's link or a booth QR must open in any build);
only the Home menu rows are, since they live on Wale's Home.

## Files

New:
- `app/features/game/briefFeatures.ts`: the API calls (every route in the contract), flag parsing and cache,
  pure helpers (reward line, station steps, puzzle tap order, countdown, links).
- `app/features/game/__tests__/briefFeatures.test.ts`: 21 tests (routes, signing, queries, off answers,
  flag cache, puzzle order, links through `routeForUrl`).
- `app/components/waleui/brief/briefKit.tsx`: Wale-look flow layout (his gradient, frosted cards, ink and
  pink, Poppins), `useBriefFlags`, `spotNow` (fresh location), `installId` (expo-application vendor id).
- `app/components/waleui/brief/{InviteScreen,EventScreen,ChallengeScreen,PuzzleScreen,StaffScreen}.tsx`
- `app/app/wale/{invite,event,challenge,puzzle,staff}.tsx`

Changed (small, check against build 24):
- `app/components/waleui/HomeScreen.tsx`: two flagged rows under his menu (INVITE, EVENTS); the menu panel
  grows by one row step each, and the tap-to-close area starts below it. **Conflict risk** if build 24
  edits the Home menu: keep `extraMenu()` and the `grow` offsets.
- `app/features/world/links.ts`: `referral`, `station`, `event` and `https://.../r/CODE` routed through
  `routeForBriefLink`. Other links unchanged (tested).
- `app/features/game/client.ts`: `GameError` keeps the server's `detail` object (reason plus fields such as
  `retry_at`, `need`). Additive; message and status unchanged.
- `app/features/game/qr.ts` + its test: the encoder now goes to QR version 7 (122 bytes), because a booth's
  link (`cosquest://station?game=<uuid>&station=<uuid>&code=X`, about 116 bytes) did not fit version 4.
  Versions 5, 6 and 7 match segno 1.6.6 bit for bit (golden hashes in the test, version 7's version
  information included). Friend codes are unchanged (still version 1 or 2).
- `app/app.config.js`: **native string**: the iOS camera text (`NSCameraUsageDescription` and the
  expo-image-picker plugin's `cameraPermission`) now also says "and for challenge photos at CosQuest
  events". Needs the prebuild the build lane does anyway.

No new dependencies (expo-application, expo-clipboard, expo-image-picker, expo-image-manipulator, Share
were all there). `app/node_modules` is a symlink in this worktree and is not committed.

## Checks

`npx tsc --noEmit`: clean. `npm test`: 1100 of 1100 (build 23 had 1077; +21 brief features, +2 QR).
eslint clean on every changed file.

## Not verified without a phone

- Any of the screens on a device: layout, keyboard over the code fields, the camera flow and the photo
  size (resized to 1080 px JPEG 0.6, falling back to 900 and 720 px to stay under 600 KB).
- That the phone's camera app opens `cosquest://station?...` from a booth QR into the app (iOS normally
  offers "Open in CosQuest" for a registered scheme). Typing the code always works.
- `getIosIdForVendorAsync` on a real phone (the server needs `install_id` to redeem a code when
  `require_install_id` is on; the web build sends none and gets "Codes can only be used in the app").
- A scan of the version 7 QR by a real reader (checked against segno only; no decoder on this Mac).

## For the merger

- Merge after build 24's Home edits; the only shared files are listed above.
- Event join uses the existing `joinGame` (rooms.ts) with no faction (the server assigns one) and then
  check-in at the venue. Paid events: the server refuses the join as it already does; this branch adds no
  payment UI.
- Words follow the payment brief: "Costcoin", never "CosCoin"; no reward is mentioned while the server's
  reward is none.
