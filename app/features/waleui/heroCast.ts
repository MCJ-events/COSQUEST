// The six faction heroes (realism, 12 Nov 2026): the hyper-real characters that stand in for the
// player on the mid and high tiers until the player has a Forge character of their own.
//   - the fight: Godot picks the hero from the fight config's "faction" (game3d/fight.gd
//     HERO_BY_FACTION; the low tier keeps the built-in cast);
//   - Wale's screens: the home hero slot, the weapon page and the customiser preview show the
//     faction hero's picture (components/waleui/heroArt.ts; build 29: its 2D art, or the character the
//     player picked, features/waleui/characters.ts).
// Keys are the hero folders of the asset track and the names of the models in
// game3d/cast/heroes. Pure (tested in features/waleui/__tests__/heroCast.test.ts).

export type FactionHero = { key: string; name: string; faction: string };

export const FACTION_HEROES: FactionHero[] = [
  { key: "ascendants_zuri", name: "Zuri", faction: "ascendants" },
  { key: "controllers_tavo", name: "Tavo", faction: "controllers" },
  { key: "icons_imani", name: "Imani", faction: "icons" },
  { key: "everborn_oren", name: "Oren", faction: "everborns" },
  { key: "celestials_lyra", name: "Lyra", faction: "celestials" },
  { key: "blockbusters_kofi", name: "Kofi", faction: "blockbusters" },
];

/** The faction id out of what the stores hold: an id, an object with an id, or nothing. */
export function factionId(f: string | { id?: string | null } | null | undefined): string | null {
  if (!f) return null;
  const id = typeof f === "string" ? f : (f.id ?? null);
  return id ? id.toLowerCase() : null;
}

/** The player's faction hero; null when the faction is not known (the placeholder stays). */
export function heroForFaction(f: string | { id?: string | null } | null | undefined): FactionHero | null {
  const id = factionId(f);
  if (!id) return null;
  // the server has said both "everborn" and "everborns"
  return FACTION_HEROES.find((h) => h.faction === id || h.faction === `${id}s` || `${h.faction}s` === id) ?? null;
}
