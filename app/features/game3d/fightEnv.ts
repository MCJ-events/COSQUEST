// build 28 (forge-env-28): a point's Forge world piece (catalogue type "environment") beyond the Encounter.
// Since build 21 a point the server dresses (costquest-backend app/roam_forge.py annotate: point.forge.environment,
// about half of all points) shows its piece in the Encounter of a question point only. With the server's flag
// forge_env_fights on (/me features.forge_world.env_fights), the same piece also
//   - marks the point's pin on the map (a small picture of it),
//   - stands in the point card and in a fight point's briefing,
//   - stands in the 3D fight as set dressing (game3d/env_piece.gd), at the far end or the left side of the fight.
// The flag is the server's: an old server sends no key and nothing changes. Pure (no react-native) so node tests it;
// the device half is fightEnvDevice.ts, the pictures components/game/ForgeEnvBits.tsx.
import type { LookTier } from "../game/lookTier.ts";
import { type ForgeEntry, type ForgeFileRef, pickGlb, pointForge } from "../game/forgeWorld.ts";

/** The server's switch: /me features.forge_world.env_fights, true only when the server says so. */
export function envFightsOn(me: { features?: Record<string, unknown> | null } | null | undefined): boolean {
  const fw = me?.features?.forge_world;
  return !!fw && typeof fw === "object" && !Array.isArray(fw) && (fw as Record<string, unknown>).env_fights === true;
}

type PieceEntry = Pick<ForgeEntry, "id" | "type" | "name" | "version" | "lods" | "thumbnail" | "height_m" | "gameplay">;

/**
 * The world piece a point is dressed with, when the flag is on and the catalogue on this phone has it as a published
 * environment. Null otherwise (the point keeps its look of build 27).
 */
export function pointPiece<T extends PieceEntry>(point: unknown, entries: readonly T[], on: boolean): T | null {
  if (!on) return null;
  const ref = pointForge(point).environment;
  if (!ref) return null;
  return entries.find((e) => e.id === ref.element_id && e.type === "environment") ?? null;
}

/**
 * The LOD the fight loads per look tier: the piece stands 12 to 25 m from the camera, a hundred or two pixels tall,
 * so the high tier's LOD 1 (about 7.5 k triangles, 512 px textures on today's pieces) is plenty and the mid tier
 * takes LOD 2 (about 2 k, 256 px). The low tier loads no model: Godot stands the thumbnail up as one card.
 */
export function fightEnvLod(tier: LookTier): number | null {
  return tier === "high" ? 1 : tier === "mid" ? 2 : null;
}

/** What the fight downloads for the piece on this tier: the GLB (none on the low tier) and the thumbnail. */
export function fightEnvFiles(entry: Pick<ForgeEntry, "lods" | "thumbnail">, tier: LookTier): { glb: (ForgeFileRef & { lod: number }) | null; thumb: ForgeFileRef | null } {
  const lod = fightEnvLod(tier);
  const t = entry.thumbnail;
  const thumb = t && typeof t.url === "string" && t.url ? { file: t.file || t.url.split("/").pop() || "thumb.png", url: t.url, sha256: t.sha256 ?? null } : null;
  return { glb: lod === null ? null : pickGlb(entry, lod), thumb };
}

export type FightEnvConfig = {
  env_glb?: string;
  env_thumb?: string;
  env_name: string;
  env_placement: string;
  env_height_m?: number;
};

/**
 * The fight config's keys (env_piece.gd) from the files on this phone (absolute paths, "" when missing). Null when
 * there is nothing to stand up, so the config is exactly build 27's.
 */
export function fightEnvConfig(entry: Pick<ForgeEntry, "name" | "height_m" | "gameplay">, files: { glb: string; thumb: string }): FightEnvConfig | null {
  if (!files.glb && !files.thumb) return null;
  const out: FightEnvConfig = { env_name: entry.name, env_placement: entry.gameplay.placement || "ground" };
  if (files.glb) out.env_glb = files.glb;
  if (files.thumb) out.env_thumb = files.thumb;
  if (typeof entry.height_m === "number" && Number.isFinite(entry.height_m) && entry.height_m > 0) out.env_height_m = entry.height_m;
  return out;
}

/** The line under a point's name: where the piece stands. */
export function pieceLine(name: string, fight: boolean): string {
  return fight ? `${name} stands at this fight` : `${name} stands here`;
}
