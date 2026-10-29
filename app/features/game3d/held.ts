// Which weapon a character holds (cq 234), and the app's own default set.
//
// Every character on screen holds a weapon: in the 3D fight, the Forge bag,
// the Wear list, the versus card and the avatar. Where it comes from:
//   - the player's own avatar holds the weapon the player equipped, when the
//     Forge catalogue link is on (the server's `forge_world` feature AND this
//     build's EXPO_PUBLIC_FORGE_CATALOGUE=1) and that weapon is a real one;
//   - else its own weapon: the cast's from app/game3d/data/attach.json (the
//     deck's own where the deck shows one), a sword for anyone else.
// The default set is bundled with the app (app/assets/weapons/, the same
// files as the Forge packs imported into the catalogue), so a fresh install
// with an empty or placeholder-only catalogue still shows real weapons.
// With the link off, the catalogue screens behave exactly as before
// (the bag lists what the server says is owned, nothing filtered).
//
// Pure: tested in __tests__/held.test.ts. The files are heldDevice.ts.
import type { ForgeEntry } from "../game/forgeWorld.ts";

import { type AttachManifest, characterKey, type GripClass, gripClassOf } from "./attach.ts";

/** The app flag (EXPO_PUBLIC_FORGE_CATALOGUE): "1", "true" or "on". */
export function catalogueFlag(raw: string | undefined | null): boolean {
  return ["1", "true", "on", "yes"].includes(String(raw ?? "").trim().toLowerCase());
}

/** The link is on when both say so: this build's flag and the server's feature. */
export function catalogueOn(appFlag: boolean, serverOn: boolean): boolean {
  return appFlag && serverOn;
}

/**
 * A placeholder weapon: one file served as every LOD (the pack check's
 * "placeholder LODs" warning), or no thumbnail and a tiny model (the
 * untextured Ember Blade v1 is 9.7 KB with no texture). Hidden when the link
 * is on: Mark should never meet a grey blade.
 */
export function isPlaceholderWeapon(e: Pick<ForgeEntry, "type" | "lods" | "thumbnail">): boolean {
  if (e.type !== "weapon") return false;
  const glbs = e.lods.map((l) => l.glb).filter((g): g is NonNullable<typeof g> => !!g);
  if (!glbs.length) return true;
  const shas = new Set(glbs.map((g) => g.sha256 ?? g.file));
  if (glbs.length > 1 && shas.size === 1) return true;
  const smallest = Math.min(...glbs.map((g) => g.bytes ?? Infinity));
  return !e.thumbnail && smallest < 16 * 1024;
}

/** The catalogue's weapons the game uses: everything published but the placeholders. */
export function realWeapons<T extends Pick<ForgeEntry, "type" | "lods" | "thumbnail">>(entries: readonly T[]): T[] {
  return entries.filter((e) => e.type === "weapon" && !isPlaceholderWeapon(e));
}

/** A default weapon's catalogue twin: the same pack imported into the Forge (same name). */
export function catalogueTwin<T extends Pick<ForgeEntry, "type" | "name">>(entries: readonly T[], name: string): T | null {
  return entries.find((e) => e.type === "weapon" && e.name === name) ?? null;
}

export type Held = {
  /** default: a bundled weapon (slug); catalogue: a Forge entry */
  source: "default" | "catalogue";
  slug: string | null;
  entry: ForgeEntry | null;
  name: string;
  cls: GripClass;
};
export type HeldPair = { main: Held | null; offhand: Held | null };

const ONE_HANDED: GripClass[] = ["sword", "dagger", "axe"];

function bundled(m: AttachManifest, slug: string | null | undefined): Held | null {
  const w = slug ? m.weapons[slug] : null;
  return w && slug ? { source: "default", slug, entry: null, name: w.name, cls: w.grip } : null;
}

/** The character's own weapon (no player choice): the manifest's default, a sword for a character it doesn't know. */
export function ownWeapon(m: AttachManifest, characterName: string | null | undefined): Held | null {
  const c = m.characters[characterKey(characterName)];
  if (c) return bundled(m, c.default_weapon);
  return bundled(m, "knight_sword");
}

/**
 * What a character holds. `mine`: it is the player's avatar, so the player's
 * choice counts: the equipped Forge weapon (link on, a real weapon), else a
 * default weapon held from the bag's starter set (`localPick`), else its own.
 * A shield goes in the off hand, with the character's own one-handed weapon
 * (or a sword) in the main hand.
 */
export function heldFor(
  m: AttachManifest,
  input: { characterName: string | null | undefined; mine: boolean; equipped: ForgeEntry | null; linkOn: boolean; localPick?: string | null },
): HeldPair {
  let pick: Held | null = null;
  if (input.mine && input.linkOn && input.equipped && input.equipped.type === "weapon" && !isPlaceholderWeapon(input.equipped)) {
    const e = input.equipped;
    pick = { source: "catalogue", slug: null, entry: e, name: e.name, cls: gripClassOf(e.name, e.gameplay?.kind ?? null) };
  } else if (input.mine && input.localPick) {
    pick = bundled(m, input.localPick);
  }
  const own = ownWeapon(m, input.characterName);
  if (!pick) {
    if (own?.cls === "shield") return { main: bundled(m, "knight_sword"), offhand: own };
    return { main: own, offhand: null };
  }
  if (pick.cls === "shield") {
    const main = own && ONE_HANDED.includes(own.cls) ? own : bundled(m, "knight_sword");
    return { main, offhand: pick };
  }
  return { main: pick, offhand: null };
}

/** The starter set as the bag lists it: every bundled weapon, in the manifest's order. */
export function starterSet(m: AttachManifest): { slug: string; name: string; cls: GripClass }[] {
  return Object.entries(m.weapons).map(([slug, w]) => ({ slug, name: w.name, cls: w.grip }));
}
