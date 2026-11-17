// A player's first minutes without the Warden (build 24, 13 Nov 2026). The
// Warden's first-run conversation (components/game/Onboarding.tsx) is never
// shown any more: Mark wants the Warden to be an impartial announcer, not a
// guide that greets you and asks for your faction. What it used to do happens
// quietly instead:
//   - name: the chat profile's name, saved to the game profile without asking
//     (the server cleans it and, if it can't be shown, picks a name itself:
//     app/names.py for_input; there is no unique-name rule);
//   - faction: chosen on Wale's Faction screen (Home > FACTION), joined through
//     progression with its entry test; never forced before the map;
//   - starter relic: the relics store claims it once the first-shrine
//     tutorial is done (features/game/relics.ts), as for players who started
//     before Relics existed;
//   - location: the phone's own prompt the first time the map is on screen,
//     with the one-line reason below shown on the map until it is answered.
// Pure: no React Native imports (tested in __tests__/firstRun.test.ts).

/** The game server's longest name (app/names.py MAX_LEN). */
export const GAME_NAME_MAX = 20;
/** The game server's shortest name (app/names.py MIN_LEN). */
export const GAME_NAME_MIN = 2;

/** Shown on the map while the phone has not been asked for, or not answered, location. */
export const LOCATION_REASON = "CosQuest uses your location to find Quest Points near you, only while you play.";

/**
 * The name to save to the game profile, or null when there is nothing to do:
 * the game already has a name for this player, or the chat profile has none
 * usable. Whitespace is collapsed and the name cut to the server's length.
 */
export function quietGameName(chatName: string | null | undefined, gameHandle: string | null | undefined): string | null {
  if (gameHandle && gameHandle.trim()) return null;
  const name = (chatName ?? "").replace(/\s+/g, " ").trim().slice(0, GAME_NAME_MAX).trim();
  return name.length >= GAME_NAME_MIN ? name : null;
}

/** Whether to ask the phone for location now: the game is on screen, not parked behind the chat, and signed in. */
export function shouldStartLocation(o: { session: boolean; onScreen: boolean; parked: boolean }): boolean {
  return o.session && o.onScreen && !o.parked;
}

/** The Warden's first-run conversation is retired: nothing a player can do reaches it. */
export const WARDEN_ONBOARDING = false as const;
