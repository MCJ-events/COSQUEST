# MERGE NOTES: warden-announcer-app (for build 25)

Branch `warden-announcer-app`, cut from `build-23` (84eeb3e). Not built, not uploaded.

## What it adds

The Game Warden as the game's announcer and referee (Mark, 13 Nov 2026). The server decides every line
(costquest-backend branch `warden-announcer`, app/warden_announcer.py, approved templates only). The app
shows and speaks them; it never writes one.

| Piece | File | What it does |
|---|---|---|
| Pure part | `app/features/game/announcer.ts` | feed call (signed `GET /v1/warden/feed`, 404 = silent), `AnnouncerBook` (dedupe by id, server clock skew, strip vs ceremony), speech rules, fight lines from `setup.warden`, rules card and countdown, poll timing, a client-side money filter |
| Glue | `app/features/game/announcerRuntime.ts` | polls (60 s on the map, 5 s while a Room is on screen, doubling on failure), silent unless `/v1/roam/me` `features.announcer === true`, a 404 silences it until /me says on again; on-device speech (expo-speech) only; mute pref `game.announcer.muted` (`announcer.setMuted`) |
| Strip | `app/components/game/announcer/AnnouncerStrip.tsx` | one line under the map's top bar (first in the banners column, above LiveBanner), Wale's ink and pink |
| Ceremony card | `app/components/game/announcer/CeremonyCard.tsx` | full screen, once per line, for openings, closes and results (game live, over, settled, final round, winner, season and calendar open and close); tap or 7 s closes it |
| Event rules card | `app/components/game/announcer/EventRulesCard.tsx` | in the Room lobby: title, countdown by the server's clock, the run sheet's rules line (`GET /v1/warden/events/{id}`) |
| Fight lines | `features/game3d/fight3d.ts`, `components/game/Fight3D.tsx` | `fightFromStart().warden` from `setup.warden`; `buildFightConfig` sends `warden_intro`, `warden_win`, `warden_loss` to Godot only when the server gave them; the intro is spoken as the fight opens, the verdict when it ends (win or lose only) |
| Godot | `app/game3d/fight.gd` | the intro banner's subtitle is `warden_intro` when sent (else the old title and landmark); VICTORY's subtitle is `warden_win` when sent (else "<GUARDIAN> DEFEATED"); DEFEATED's is `warden_loss` |

## Rules it keeps (the defaults until Mark answers)

- Voice and text only. On-device speech only (no server voice for these lines).
- Never during a question (Encounter on screen), never in a fight (duel, Room fight, 3D fight) except the
  fight's own intro and verdict, never on a call, never off screen, never when muted. One line at a time,
  each spoken once.
- Never money: a line with a money sign, prize, cash, odds, earn, payout, coins and the like is dropped by
  the phone too, even though the server refuses them first.
- Silent on 404 or `features.announcer` false. Production has the feature off, so a build 25 against
  production shows and says nothing new.
- Handles, not player numbers (server default `CQ_WARDEN_PLAYER_REF=handle`; a refused handle falls back
  to the number).

## Touches to files another lane is changing

`build-24` (the other agent: removing the old Warden onboarding and making the old Warden silent) will touch
GameRoot and maybe the Warden bubble. My edits there are small and separate:

- `components/game/GameRoot.tsx`: two imports, one import of `announcer`, one effect block after the
  `world.setGameFight` effect (setActive, setEvent, setQuiet), `<AnnouncerStrip />` before `<LiveBanner>`,
  and `<CeremonyCard />` before `<CoachOverlay>`. If build 24 deletes the WardenBubble or the old Warden's
  lines, keep these; they do not use `wardenVoice` at all.
- `components/game/RoomScreen.tsx`: one import and `<CeremonyCard />` before joining.
- `components/game/RoomLobby.tsx`: two imports and two components at the top of the ScrollView.
- The old Warden's mute (`useWardenMuted`) is NOT used: the announcer has its own pref, so silencing the
  old Warden in build 24 does not silence the referee. If Mark wants one mute for both, point
  `announcerRuntime.ts` at whatever build 24 keeps.

## Needs a Godot pack re-export

`app/game3d/fight.gd` changed (the three banner subtitles). The app's JS side works with the old pack (Godot
ignores unknown config keys), so the lines simply do not show in the fight until the pack is re-exported.
Re-export on the farm as for build 22, and run the Godot tests there (not run here: no Godot on this Mac).

## Not done, on purpose

- The venue socket's `{"t":"announce"}` and `{"t":"announce_cancel"}` are not wired into `roomsRuntime`
  (the 5 s feed poll at a Room covers it). `announcer.cancel(id)` is ready for it.
- No settings toggle UI for the mute yet (`announcer.setMuted` exists); where it goes depends on build 24's
  settings.
- Layout checked by reading only: the strip and rules card want a look in the simulator against staging
  (`announcer` is on there) before the build.

## Checks

- `npm test`: 1092 pass, 0 fail (build 23 had 1077; +14 announcer, +1 fight lines).
- `npx tsc --noEmit -p .`: clean. eslint on every changed file: clean.
