// Who the player is (build 29, Subomi, 18 Nov 2026): the player can pick the character they are, from the six
// faction heroes and the Forge characters. Gameplay plays that character's 3D model (the fight config's
// "hero_pick", game3d/fight.gd _hero_pick; mid and high look tiers, like the faction heroes); the places that show
// the player as a picture (Wale's Home hero slot, the weapon page, the profile, the character picker, the share
// card) show the character's 2D art (components/waleui/characterArt.ts), never a render of the 3D model.
// No pick means the faction hero, as before. The pick is kept on the phone like the player's looks
// (components/waleui/characterStore.ts). Pure (tested in __tests__/characters.test.ts).
import { FACTION_HEROES, heroForFaction } from "./heroCast.ts";

export type Character = {
  key: string;
  name: string;
  /** The faction the character belongs to, or null for a Forge character of no faction. */
  faction: string | null;
  kind: "hero" | "forge";
};

/**
 * The Forge characters whose rig passed the game's clip gate (game3d/tools/forge_chars/chars.json; fight.gd
 * FORGE_CAST lists the same keys). Bram, Mei and Cat-Boy are made but not playable yet: their rigs tear in the
 * clips, so they are not offered.
 */
export const FORGE_CHARACTERS: Character[] = [{ key: "forge_courier", name: "Courier", faction: null, kind: "forge" }];

export const CHARACTERS: Character[] = [
  ...FACTION_HEROES.map((h): Character => ({ key: h.key, name: h.name, faction: h.faction, kind: "hero" })),
  ...FORGE_CHARACTERS,
];

const KEY = /^[a-z][a-z0-9_]{1,40}$/;

export function characterByKey(key: string | null | undefined): Character | null {
  if (!key || !KEY.test(key)) return null;
  return CHARACTERS.find((c) => c.key === key) ?? null;
}

/** The stored pick, or null when there is none or it names a character this build does not have. */
export function parsePick(raw: string | null | undefined): string | null {
  const k = (raw ?? "").trim();
  return characterByKey(k)?.key ?? null;
}

/** Who the player is: their pick when it is a character this build has, else their faction's hero, else nobody. */
export function playerCharacter(pick: string | null | undefined, faction: string | { id?: string | null } | null | undefined): Character | null {
  const picked = characterByKey(pick ?? null);
  if (picked) return picked;
  const h = heroForFaction(faction);
  return h ? { key: h.key, name: h.name, faction: h.faction, kind: "hero" } : null;
}

/** The fight config keys for the pick (only when the player picked someone; no pick leaves the faction rule). */
export function pickConfig(pick: string | null | undefined): { hero_pick: string } | Record<string, never> {
  const c = characterByKey(pick ?? null);
  return c ? { hero_pick: c.key } : {};
}

/** The line under the name: the character's faction, or what a Forge character is. */
export function characterLine(c: Character): string {
  if (!c.faction) return "Forge character";
  const f = c.faction.replace(/s$/, "");
  return `${f.charAt(0).toUpperCase()}${f.slice(1)}s`;
}

/** The line that goes with the share card. */
export function shareLine(c: Character, url: string | null): string {
  return `I play as ${c.name} in CosQuest.${url ? ` ${url}` : ""}`;
}
