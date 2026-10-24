// The three characters of a 3D fight as GLB files on this phone (cq 061),
// through cq 056's Forge cache (forgeWorldDevice): each model downloaded once
// per version and checked against its sha256. Glue, not unit tested; the
// choices themselves are pure (fight3d.ts pickCast, fightLod).
//
//   hero   the Forge avatar the player wears
//   ally   another published hero
//   enemy  the point's Guardian (a boss for a raid): the character a duel
//          start named, else the one the server would name for this point
//
// Anything missing (no Forge, offline, a download that fails or is slow) is
// an empty path, and Godot stands a mannequin in its place.
import { type ForgeEntry, forgeWorldOf, pickGlb } from "@/features/game/forgeWorld";
import { DEVICE_CLASS, ensureFile, forgeWorld, refreshCatalogue } from "@/features/game/forgeWorldDevice";
import { gameStore } from "@/features/game/runtime";

import { fightLod, pickCast } from "./fight3d";

export type CastMember = { path: string | null; name: string | null; id: string | null };
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

async function fileOf(entry: ForgeEntry | null, lod: number): Promise<string | null> {
  if (!entry) return null;
  const f = pickGlb(entry, lod);
  return f ? ensureFile(entry, f) : null;
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
  lodOverride: number | null;
  waitMs?: number;
}): Promise<Cast> {
  const wait = opts.waitMs ?? 15000;
  await within(refreshCatalogue(), Math.min(wait, 5000), undefined);
  const s = forgeWorld.get();
  const avatarId = s.inventory?.equipped.avatar ?? forgeWorldOf(gameStore.get().me).equipped.avatar;
  const { hero, ally, enemy } = pickCast(s.entries, { avatarId, enemyId: opts.enemyId, role: opts.role, key: opts.pointId });
  const lod = fightLod(DEVICE_CLASS, opts.lodOverride);
  const [heroPath, allyPath, enemyPath] = await within(Promise.all([fileOf(hero, lod), fileOf(ally, lod), fileOf(enemy, lod)]), wait, [null, null, null] as (string | null)[]);
  const player = gameStore.playerName?.() || null;
  return {
    hero: { path: heroPath, name: player ?? hero?.name ?? null, id: hero?.id ?? null },
    ally: { path: allyPath, name: ally?.name ?? null, id: ally?.id ?? null },
    enemy: { path: enemyPath, name: opts.enemyName ?? enemy?.name ?? null, id: enemy?.id ?? null },
    lod,
  };
}
