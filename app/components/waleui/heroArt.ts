// The player's character as Wale's screens show it: the home hero slot, its round avatar and the weapon page.
// Build 29 (Subomi, 18 Nov 2026): the character the player picked (characterStore.ts), else their faction hero,
// shown as its 2D art (characterArt.ts: the concept front view, cut out), not a render of the 3D model. Builds 23
// to 28 showed renders from game3d/tools/portrait.gd; those files are gone.
import { useGame } from "@/features/game/runtime";
import { type Character, playerCharacter } from "@/features/waleui/characters";
import { useAppSelector } from "@/store/hooks";

import { type CharacterArt, characterArt } from "./characterArt";
import { usePickedCharacter } from "./characterStore";

export type HeroArt = { full: number; bust: number };

/** The full figure and the head-and-shoulders picture for a character key (null when it has no art). */
export function heroArt(key: string | null | undefined): HeroArt | null {
  const a = characterArt(key);
  return a ? { full: a.card, bust: a.portrait } : null;
}

/** The player's faction, from the game's "me", else the chat profile. */
export function usePlayerFaction(): string | null {
  const gameFaction = useGame((s) => s.me?.faction ?? null);
  const chatFaction = useAppSelector((s) => ((s.user.user ?? s.auth.user) as { faction?: string | { id?: string } | null } | null)?.faction ?? null);
  return gameFaction ?? (typeof chatFaction === "string" ? chatFaction : (chatFaction?.id ?? null));
}

/** Who the player is (their pick, else their faction hero) and that character's art; null when unknown. */
export function usePlayerCharacter(): (Character & CharacterArt) | null {
  const pick = usePickedCharacter();
  const c = playerCharacter(pick, usePlayerFaction());
  const art = characterArt(c?.key);
  return c && art ? { ...c, ...art } : null;
}

/** Wale's screens' shape (Home, Weapons): the player's character with "full" and "bust" pictures. */
export function useFactionHero(): (Character & HeroArt) | null {
  const c = usePlayerCharacter();
  return c ? { ...c, full: c.card, bust: c.portrait } : null;
}
