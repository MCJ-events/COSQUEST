// build 28 (forge-env-28): the point's Forge world piece for the 3D fight, as files on this phone, through the
// same Forge cache as the fighters (forgeWorldDevice ensureFile: one download per version, checked against its
// sha256). Glue, not unit tested; the choices are pure (fightEnv.ts). Never throws and never waits long: a piece
// that is missing, unpublished or slow is simply not in the fight, which is then exactly build 27's.
import { forgeWorld, ensureFile } from "@/features/game/forgeWorldDevice";
import type { LookTier } from "@/features/game/lookTier";
import { gameStore } from "@/features/game/runtime";

import { localPath } from "./fight3d";
import { envFightsOn, fightEnvConfig, fightEnvFiles, type FightEnvConfig, pointPiece } from "./fightEnv";

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

/** The fight config's env_* keys for this point on this tier, or null (flag off, no piece, nothing downloaded). */
export async function fightEnv(point: unknown, tier: LookTier, waitMs = 6000): Promise<FightEnvConfig | null> {
  if (!point || !envFightsOn(gameStore.get().me)) return null;
  const entry = pointPiece(point, forgeWorld.get().entries, true);
  if (!entry) return null;
  const files = fightEnvFiles(entry, tier);
  const work = Promise.all([files.glb ? ensureFile(entry, files.glb) : Promise.resolve(null), files.thumb ? ensureFile(entry, files.thumb) : Promise.resolve(null)]);
  const [glb, thumb] = await within(work, waitMs, [null, null] as (string | null)[]);
  return fightEnvConfig(entry, { glb: localPath(glb), thumb: localPath(thumb) });
}
