// The three characters of a 3D fight as GLB files on this phone (cq 061),
// through cq 056's Forge cache (forgeWorldDevice): each model downloaded once
// per version and checked against its sha256. Glue, not unit tested; the
// choices themselves are pure (fight3d.ts pickCast, fightLod).
//
//   hero   the Forge avatar the player wears
//   ally   a squadded-up friend's worn hero (setup.ally), else another
//          published hero
//   enemy  the point's Guardian (a boss for a raid): the character a duel
//          start named (for a Siege, the holder's own worn hero with the
//          weapon they equipped), else the one the server would name here
//
// Anything missing (no Forge, offline, a download that fails or is slow) is
// an empty path, and Godot stands a mannequin in its place.
//
// build 28: a fighter whose character has a fight kit (fightKit.ts) also gets
// the kit's clip library (`anim`, the path of its anim.json, anim.glb beside
// it) and, when the kit carries the rigged model, that model as its `path`.
// A kit that fails to download, or whose model does, is dropped whole: the
// fighter loads its published model and plays as before.
import { type ForgeEntry, forgeWorldOf, pickGlb } from "@/features/game/forgeWorld";
import { File, Paths } from "expo-file-system";

import { DEVICE_CLASS, ensureFile, figureUrl, forgeWorld, refreshCatalogue, refreshInventory, thumbUrl } from "@/features/game/forgeWorldDevice";
import { gameStore } from "@/features/game/runtime";

import { fightLod, localPath, pickCast, wornAvatarId } from "./fight3d";
import { type FightKit, fetchFightKit, fighterFiles, kitFolder, kitMemo } from "./fightKit";
import { fightWeapons, heldInputs } from "./heldDevice";

/**
 * `weaponId`: the Forge weapon this fighter holds (a Siege holder's own equipped one), else its own.
 * `anim`: build 28, the fight kit's anim.json on this phone (anim.glb beside it), when the character has one.
 */
export type CastMember = { path: string | null; name: string | null; id: string | null; weaponId?: string | null; anim?: string | null; kit?: string | null };
export type Cast = { hero: CastMember; ally: CastMember; enemy: CastMember; lod: number };

function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

const kits = kitMemo();

/** The character's fight kit: the catalogue's `fight`, else the kit route (asked once per version and session). */
async function kitOf(entry: ForgeEntry): Promise<FightKit | null> {
  if (entry.type !== "character") return null;
  if (entry.fight) return entry.fight;
  const known = kits.get(entry.id, entry.version);
  if (known !== undefined) return known;
  const kit = await fetchFightKit(gameStore.client, entry.id, entry.version);
  kits.set(entry.id, entry.version, kit);
  return kit;
}

type FighterFiles = { path: string | null; anim: string | null; kit: string | null };

async function fileOf(entry: ForgeEntry | null, lod: number): Promise<FighterFiles> {
  if (!entry) return { path: null, anim: null, kit: null };
  const published = pickGlb(entry, lod);
  const kit = await kitOf(entry).catch(() => null);
  const plan = fighterFiles(published, kit, lod);
  if (kit && plan.anim && plan.model) {
    const sub = kitFolder(kit);
    const [model, json, glb] = await Promise.all([
      ensureFile(entry, plan.model, plan.fromKit ? sub : undefined),
      ensureFile(entry, plan.anim.json, sub),
      ensureFile(entry, plan.anim.glb, sub),
    ]);
    if (model && json && glb) return { path: model, anim: json, kit: kit.kit };
  }
  // No kit, or any part of it missing: the published model alone, as before build 28.
  return { path: published ? await ensureFile(entry, published) : null, anim: null, kit: null };
}

/**
 * The cast and their files. Waits at most `waitMs` for the catalogue and the
 * downloads (they are usually cached already: the versus card, the bag and
 * the avatar use the same files).
 */
export async function fightCast(opts: {
  pointId: string | null;
  role: "guardian" | "boss";
  enemyId?: string | null;
  enemyName?: string | null;
  /** A friend squadded up in person: their worn hero and their name over it. */
  ally?: { id: string | null; name: string } | null;
  /** The Forge weapon the opponent holds (a Siege holder's own equipped one). */
  enemyWeaponId?: string | null;
  lodOverride: number | null;
  waitMs?: number;
}): Promise<Cast> {
  const wait = opts.waitMs ?? 15000;
  // The catalogue and the bag, both fresh: the hero you wear now (a Wear a
  // moment ago, or on another phone) is the one you fight as.
  await within(Promise.all([refreshCatalogue(), refreshInventory()]), Math.min(wait, 5000), undefined);
  const s = forgeWorld.get();
  const avatarId = wornAvatarId(s.inventory, forgeWorldOf(gameStore.get().me));
  const { hero, ally, enemy } = pickCast(s.entries, { avatarId, enemyId: opts.enemyId, allyId: opts.ally?.id, role: opts.role, key: opts.pointId });
  const lod = fightLod(DEVICE_CLASS, opts.lodOverride);
  const none: FighterFiles = { path: null, anim: null, kit: null };
  const [h, a, e] = await within(Promise.all([fileOf(hero, lod), fileOf(ally, lod), fileOf(enemy, lod)]), wait, [none, none, none]);
  const player = gameStore.playerName?.() || null;
  return {
    hero: { path: h.path, anim: h.anim, kit: h.kit, name: player ?? hero?.name ?? null, id: hero?.id ?? null },
    ally: { path: a.path, anim: a.anim, kit: a.kit, name: opts.ally?.name ?? ally?.name ?? null, id: ally?.id ?? null },
    enemy: { path: e.path, anim: e.anim, kit: e.kit, name: opts.enemyName ?? enemy?.name ?? null, id: enemy?.id ?? null, weaponId: opts.enemyWeaponId ?? null },
    lod,
  };
}

/**
 * Weapons in hand (cq 234): each fighter's <role>_weapon / <role>_offhand for
 * the Godot config ({glb, class, bone, matrix}, see app/game3d/fight.gd). The
 * hero holds the player's choice; the ally and the Guardian their own. Never
 * throws and never waits long: a fighter with nothing here fights
 * empty-handed, as before.
 */
export async function castWeapons(cast: Cast, waitMs = 4000): Promise<Record<string, unknown>> {
  const work = (async () => {
    const inputs = await heldInputs();
    const s = forgeWorld.get();
    const equipped = s.inventory?.equipped.weapon ?? forgeWorldOf(gameStore.get().me).equipped.weapon;
    const out: Record<string, unknown> = {};
    for (const role of ["hero", "ally", "enemy"] as const) {
      const m = cast[role];
      // A Siege holder's hero holds the weapon they equipped, as the player's own does.
      const theirs = role === "enemy" && m.weaponId ? m.weaponId : null;
      const w = await fightWeapons(forgeWorld.entry(m.id), m.path, role === "hero" || !!theirs, theirs ? { equipped: theirs, linkOn: inputs.linkOn, localPick: null } : { equipped, ...inputs }).catch(
        () => ({}) as Awaited<ReturnType<typeof fightWeapons>>,
      );
      if (w.main) out[`${role}_weapon`] = { ...w.main, glb: localPath(w.main.glb) };
      if (w.offhand) out[`${role}_offhand`] = { ...w.offhand, glb: localPath(w.offhand.glb) };
    }
    return out;
  })();
  return within(work, waitMs, {});
}

/**
 * Build 31: each Forge fighter's 2D art for the fight's VS card and VICTORY card (fight-look-31: fight.gd _fl_art reads
 * "<role>_art", a picture file, for a character the pck does not carry): the catalogue's full figure, else its bust
 * (for the playable Forge characters that is their turnaround art), as a WebP in the cache, once per version. Never
 * throws and never waits long: a fighter with nothing here gets its baked portrait, or its name only, as before.
 */
export async function castArt(cast: Cast, waitMs = 3000): Promise<Record<string, string>> {
  const work = (async () => {
    const out: Record<string, string> = {};
    for (const role of ["hero", "ally", "enemy"] as const) {
      const entry = forgeWorld.entry(cast[role].id);
      if (!entry || entry.type !== "character") continue;
      const url = figureUrl(entry, 512) ?? thumbUrl(entry, 512);
      if (!url) continue;
      try {
        const dest = new File(Paths.cache, `forge-art-${entry.id}-v${entry.version}.webp`);
        const uri = dest.exists && dest.size > 0 ? dest.uri : (await File.downloadFileAsync(url, dest, { idempotent: true })).uri;
        const p = localPath(uri);
        if (p) out[`${role}_art`] = p;
      } catch {
        // no picture: the card falls back
      }
    }
    return out;
  })();
  return within(work, waitMs, {});
}
