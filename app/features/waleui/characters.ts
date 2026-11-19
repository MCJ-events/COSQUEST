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
  /** hero: a faction hero baked into the app; forge: a Forge character baked into the app (the offline fallback);
   *  catalogue: a published Forge character the catalogue marks playable, fetched at run time (build 31). */
  kind: "hero" | "forge" | "catalogue";
  /** catalogue: the Forge element id (the avatar the server equips; the fight loads its published model and kit). */
  elementId?: string;
};

/**
 * The Forge characters whose rig passed the game's clip gate (game3d/tools/forge_chars/chars.json; fight.gd
 * FORGE_CAST lists the same keys). Build 30: Bram joins the Courier (his garment weights were redone so he passes
 * the gate). Mei and Cat-Boy pass it too but look broken in motion (Mei's hands shred, Cat-Boy's jacket back webs
 * out to his arm), so they are not offered yet (chars.json says why).
 */
export const FORGE_CHARACTERS: Character[] = [
  { key: "forge_courier", name: "Courier", faction: null, kind: "forge" },
  { key: "forge_bram", name: "Bram", faction: "celestials", kind: "forge" },
];

export const CHARACTERS: Character[] = [
  ...FACTION_HEROES.map((h): Character => ({ key: h.key, name: h.name, faction: h.faction, kind: "hero" })),
  ...FORGE_CHARACTERS,
];

const KEY = /^[a-z][a-z0-9_]{1,40}$/;
/** A catalogue character's key: "forge:" and its element id. */
export const CATALOGUE_PREFIX = "forge:";
const CATALOGUE_KEY = /^forge:[0-9a-f-]{8,40}$/;

/**
 * Build 31 (Subomi: a character made in the Forge shows up in the app with no app build). What the picker needs from
 * a Forge catalogue entry (features/game/forgeWorld.ts ForgeEntry). "Playable" is the catalogue's own flag,
 * gameplay.avatar (the server sets it for role "hero": costquest-backend forge.py _gameplay), the same rule as the
 * server's equip route, so whatever the picker offers can really be worn and fought as.
 */
export type CatalogueCharacterEntry = {
  id: string;
  name: string;
  type: string;
  gameplay?: { avatar?: boolean | null; role?: string | null } | null;
};

/** The published characters the catalogue marks playable, by name; a name the baked roster has stays baked. */
export function catalogueCharacters(entries: readonly CatalogueCharacterEntry[], baked: readonly Character[] = CHARACTERS): Character[] {
  const taken = new Set(baked.map((c) => c.name.toLowerCase()));
  return entries
    .filter((e) => e.type === "character" && e.gameplay?.avatar === true && !taken.has(e.name.toLowerCase()))
    .slice()
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((e): Character => ({ key: CATALOGUE_PREFIX + e.id, name: e.name, faction: null, kind: "catalogue", elementId: e.id }));
}

/** The whole roster: the baked characters (always there, offline too), then the catalogue's playable ones. */
export function rosterWith(entries: readonly CatalogueCharacterEntry[]): Character[] {
  return [...CHARACTERS, ...catalogueCharacters(entries)];
}

export function characterByKey(key: string | null | undefined, roster: readonly Character[] = CHARACTERS): Character | null {
  if (!key || !(KEY.test(key) || CATALOGUE_KEY.test(key))) return null;
  return roster.find((c) => c.key === key) ?? null;
}

/**
 * The stored pick, or null when there is none or it cannot be a character: a baked key this build has, or a
 * catalogue key (kept even before the catalogue has loaded; playerCharacter falls back while it is unknown).
 */
export function parsePick(raw: string | null | undefined): string | null {
  const k = (raw ?? "").trim();
  if (CATALOGUE_KEY.test(k)) return k;
  return characterByKey(k)?.key ?? null;
}

/** The Forge element a pick wears as the player's avatar, or null for a baked pick or none. */
export function pickedElement(pick: string | null | undefined): string | null {
  return pick && CATALOGUE_KEY.test(pick) ? pick.slice(CATALOGUE_PREFIX.length) : null;
}

/** Who the player is: their pick when it is in the roster, else their faction's hero, else nobody. */
export function playerCharacter(
  pick: string | null | undefined,
  faction: string | { id?: string | null } | null | undefined,
  roster: readonly Character[] = CHARACTERS,
): Character | null {
  const picked = characterByKey(pick ?? null, roster);
  if (picked) return picked;
  const h = heroForFaction(faction);
  return h ? { key: h.key, name: h.name, faction: h.faction, kind: "hero" } : null;
}

/**
 * The fight config keys for the pick: a baked character's key (fight.gd _hero_pick). Nothing for no pick, and
 * nothing for a catalogue character: that one is the player's worn Forge avatar, which the fight already loads with
 * its fight kit (features/game3d/characters.ts fightCast), like any Forge download.
 */
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
