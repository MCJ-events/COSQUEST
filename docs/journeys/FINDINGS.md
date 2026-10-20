# CosQuest journeys: findings

Task cq 054, 2026-10-20. Android emulator (API 35, x86_64), release build of
`merged-app-sync`, against local backends:

- chat: `MCJ-events/COSQUEST` main 8a218aa with its `merged-app` branch merged
  in locally (main alone has no game-invite route, see F-01), in-memory Mongo
  and Redis, seeded by `e2e/seed/chat-local.js`;
- game: `ubmids/costquest-backend` integration branch (what staging runs),
  local Postgres, seeded points at Trafalgar Square;
- calls: a local LiveKit dev server.

Severity: **Blocker** (a journey cannot be finished), **High** (wrong or
broken in a way most people hit), **Medium** (wrong but there is a way
round), **Low** (polish, copy, consistency).

Owner: **app** (the merged Expo app), **chat backend** (MCJ-events/COSQUEST),
**game backend** (ubmids/costquest-backend), **Sparks** (SDK/module),
**design** (needs a product decision).

Status: **fixed** (commit on `merged-app-sync`), **open**.

| ID | Sev | Owner | Where | What | Status |
|----|-----|-------|-------|------|--------|
| F-01 | High | chat backend | `POST /api/chats/:id/game-invites` | The route the merged app uses for game invite cards and "share to chat" exists only on MCJ-events/COSQUEST `merged-app` (d7d72e9), not on `main` (8a218aa). Against main every invite or shared result fails with 404. Merging `merged-app` into main locally needed 7 small conflict resolutions (all unions: `Message.kind` enum, `messageRow`, `chatController` serializer, `gameController`, `gameRoutes`, test runner, API guide); the backend suite then passes 1008/1008. | open |
| F-02 | High | app | Cosquest tab (`app/(tabs)/home.tsx`) | The first tab, where sign-in, the splash and "leave group" land, was the Expo starter screen: React logo, "Welcome to the Cosquest", "Edit app/(tabs)/index.tsx to see changes". Same in the team's chat app. Now: the map-pin tab opens the game (it is the game's icon) and `/home` redirects to the chats. | fixed |
| F-03 | High | app / design | Live tab (`app/(tabs)/live.tsx`) | Also the Expo starter screen. Replaced with an honest page pointing to voice chats and calls (chats) and Quest Hours and raids (game) until a Live design exists. | fixed (stop-gap) |
| F-04 | Blocker | app | Sign-up, profile picture step | Continue did nothing visible: the step needs a photo AND an avatar, and the "Upload a profile picture" error renders at the top of the screen, off screen once you have scrolled the 100-avatar grid down to Continue. Fixed: the error now also shows next to Continue. | fixed |
| F-05 | Medium | design | Sign-up, profile picture step | The subtitle says "take a photo **or** pick an avatar" but a photo is required (added on purpose in 3c01fbc, "upload profile picture validation"). Either the copy or the rule should change; left as the team wrote it. | open (needs decision) |
| F-06 | Medium | app | Sign-up, profile picture step | Continue sits under a grid of 100 avatars: you must scroll past all of them to move on. A pinned Continue would help. | open |
| F-07 | Medium | app (a11y) | `components/Field.tsx` (every onboarding form) | Text inputs had no accessible name (TalkBack read "edit box"), and the show/hide password eye had no label. Now named after their label, with a testID. | fixed |
| F-08 | High | design | Factions | Two faction systems: chat onboarding asks for one of 6 (Ascendants, Icons, Controllers, Blockbusters, Everborn, Celestials) and the game asks again on first open with 5 different ones (Anime, Marvel, DC, Movies, Gaming). A new player picks a side twice, with different names. | open (needs decision) |
| F-09 | Low | app | Sign-up vs sign-in | Sign-up offers Google and Apple; sign-in offers only Google. On Android, Apple sign-in is offered on sign-up only. | open |
| F-10 | Low | design | Create profile | Gender is Male or Female only, no other option and no "prefer not to say". | open (needs decision) |
| F-11 | Low | app (lint) | team chat code | `npm run lint` reports 15 errors, all in the team's chat files: 14 unescaped apostrophes, and `useRoomContext`/`useStageMode` called conditionally in `components/calls/CallSession.tsx:811` (rules-of-hooks: can crash if the condition flips between renders). Left as the team wrote them. | open |
