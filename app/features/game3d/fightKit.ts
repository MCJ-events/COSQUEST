// Fight kits (build 28, 13 Nov 2026): a Forge character's fight clip library served
// with the character, so a character made in the Forge fights with real moves
// without a new app build. Server: costquest-backend app/forge_fightkit.py
// (catalogue key `fight`, GET v1/catalogue/fightkits/<id>/<version>); farm builder:
// app/game3d/tools/anim/fightkit_build.sh. Godot registers the library at run time
// (anim_library.gd register_kit, config "<role>_anim") and checks it against the
// model's skeleton; anything missing or wrong and the fighter plays as before.
//
//   anim.glb + anim.json   the library and what Godot needs to register it
//   lods (optional)        the rigged model, when the published version is static:
//                          the library fits THESE files' skeleton, so the fight loads
//                          them instead of the published file
//
// Presentation only: the rules and the seeded record never read a model or a clip.
// Pure: no files, no network (the client is passed in). Tested in
// __tests__/fightKit.test.ts; the device glue is characters.ts.
import type { GameClient } from "../game/client.ts";
import type { ForgeFileRef } from "../game/forgeWorld.ts";

export const FIGHT_KIT_V = 1;

export type FightKit = {
  v: number;
  /** 16 hex: the kit's id, part of every file's url and of its cache folder */
  kit: string;
  key: string | null;
  anim: { glb: ForgeFileRef; json: ForgeFileRef };
  lods: { lod: number; glb: ForgeFileRef }[];
};

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function ref(v: unknown, want: string): ForgeFileRef | null {
  const o = obj(v);
  const url = o ? str(o.url) : null;
  if (!o || !url) return null;
  const file = str(o.file) ?? url.split("/").pop() ?? "";
  // Only the names a kit can have: the file lands under this name in the cache.
  if (file !== want) return null;
  return { file, url, bytes: num(o.bytes), sha256: str(o.sha256) };
}

/** A kit as the server sends it (catalogue `fight`, or the kit route), or null for anything this build can't use. */
export function parseFightKit(raw: unknown): FightKit | null {
  const o = obj(raw);
  if (!o || o.v !== FIGHT_KIT_V) return null;
  const kit = str(o.kit);
  if (!kit || !/^[0-9a-f]{16}$/.test(kit)) return null;
  const a = obj(o.anim);
  const glb = ref(a?.glb, "anim.glb");
  const json = ref(a?.json, "anim.json");
  if (!glb || !json || !glb.sha256 || !json.sha256) return null;
  const lods = (Array.isArray(o.lods) ? o.lods : []).flatMap((l): { lod: number; glb: ForgeFileRef }[] => {
    const lo = obj(l);
    const lod = lo ? num(lo.lod) : null;
    if (lod === null || lod < 0 || lod > 2 || !Number.isInteger(lod)) return [];
    const g = ref(lo?.glb, `lod${lod}.glb`);
    return g && g.sha256 ? [{ lod, glb: g }] : [];
  });
  return { v: FIGHT_KIT_V, kit, key: str(o.key), anim: { glb, json }, lods: lods.sort((x, y) => x.lod - y.lod) };
}

/** The kit's model for the fight's LOD (the same rule as pickGlb: that LOD or the next lighter, else the lightest heavier). */
export function kitModel(kit: Pick<FightKit, "lods">, lod: number): (ForgeFileRef & { lod: number }) | null {
  if (!kit.lods.length) return null;
  const lighter = kit.lods.filter((l) => l.lod >= lod).sort((a, b) => a.lod - b.lod)[0];
  const pick = lighter ?? [...kit.lods].sort((a, b) => b.lod - a.lod)[0];
  return { ...pick.glb, lod: pick.lod };
}

/** The cache folder of a kit's files, under the element's version folder: a new kit is a new folder. */
export function kitFolder(kit: Pick<FightKit, "kit">): string {
  return `fight-${kit.kit}`;
}

/**
 * What a fighter loads, given its published model and its kit:
 *   model  the file to download for the body (the kit's rigged LOD, else the published one)
 *   anim   the library's two files, or none (no kit: the fighter plays as before)
 */
export function fighterFiles<F extends ForgeFileRef>(
  published: F | null,
  kit: FightKit | null,
  lod: number,
): { model: (F | (ForgeFileRef & { lod: number })) | null; fromKit: boolean; anim: FightKit["anim"] | null } {
  if (!kit) return { model: published, fromKit: false, anim: null };
  const own = kitModel(kit, lod);
  if (own) return { model: own, fromKit: true, anim: kit.anim };
  // A kit without models fits the published (rigged) files.
  return { model: published, fromKit: false, anim: published ? kit.anim : null };
}

/** How long a "no kit" answer from the kit route is believed before asking again. */
export const NO_KIT_RETRY_MS = 10 * 60_000;

/** GET v1/catalogue/fightkits/<id>/<version>: the kit, or null (404: none, or the server's switch is off). */
export async function fetchFightKit(client: GameClient, id: string, version: number): Promise<FightKit | null> {
  try {
    return parseFightKit(await client.request<unknown>("GET", `v1/catalogue/fightkits/${encodeURIComponent(id)}/${Math.trunc(version)}`));
  } catch {
    return null;
  }
}

/**
 * A per-session memory of kits by id@version: a kit once seen is kept; "none" is asked
 * again after NO_KIT_RETRY_MS (a kit is attached minutes after a publish).
 */
export function kitMemo(now: () => number = Date.now) {
  const seen = new Map<string, { kit: FightKit | null; at: number }>();
  return {
    get(id: string, version: number): FightKit | null | undefined {
      const s = seen.get(`${id}@${version}`);
      if (!s) return undefined;
      if (s.kit === null && now() - s.at >= NO_KIT_RETRY_MS) return undefined;
      return s.kit;
    },
    set(id: string, version: number, kit: FightKit | null) {
      seen.set(`${id}@${version}`, { kit, at: now() });
    },
  };
}
