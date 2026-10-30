// The 3D fight in Godot (cq 061, "Godot G0"): the rules on the React Native
// side, as pure functions (no react-native, no files), so node can test them.
// The device half is engine.ts (the Godot instance), characters.ts (the
// Forge GLBs on disk) and components/game/Fight3D.tsx (the screen).
//
// The bridge contract with the Godot project (game3d/, autoload /root/Bridge):
//   bridge.set_result_callback(cb)   cb(json) once per fight, on the Godot thread
//   bridge.start_fight(json)         a Fight3DConfig as JSON
//   bridge.get_status()              JSON, {state: "loading" | "fighting" | ...}
//   bridge.end_fight()               stop the fight, keep the engine
// Result JSON: {outcome: "win" | "lose" | "timeout" | "quit", damage_dealt,
// damage_taken, time_s, hits, skill_uses, enemy_hp_left, hero_hp_left, mode}.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import type { RewardSummary } from "../../components/game/Reward.tsx";
import type { ForgeEntry } from "../game/forgeWorld.ts";
import type { RoamStanding } from "../game/wire.ts";

// ---------- switches ----------

/** What the Godot scene builds: everything, the arena only, or the characters only (for measuring). */
export type Fight3DMode = "full" | "arena" | "chars";
export const FIGHT3D_MODES: readonly Fight3DMode[] = ["full", "arena", "chars"];

export function parseMode(raw: unknown): Fight3DMode | null {
  return typeof raw === "string" && (FIGHT3D_MODES as readonly string[]).includes(raw) ? (raw as Fight3DMode) : null;
}

export type Fight3DFlags = {
  /** EXPO_PUBLIC_GAME3D=1, on a platform that can run it (iOS, Android 10+). */
  on: boolean;
  /**
   * Keep one engine for the app's life (pause/resume between fights), the
   * default; EXPO_PUBLIC_GODOT_KEEP=0 destroys it on close instead. Destroying
   * leaked ~7 MB of native heap per fight on the emulator, and re-creating the
   * engine in one process crashed once a GDExtension (3D Tiles) was loaded.
   */
  keep: boolean;
  /** EXPO_PUBLIC_GAME3D_AUTOSTART=<mode>: open the fight as soon as the game is up (test builds). */
  autostart: Fight3DMode | null;
  /** EXPO_PUBLIC_GAME3D_CYCLE=N: open and close the fight N times (the leak test), 0 = off. */
  cycle: number;
  /** EXPO_PUBLIC_GAME3D_CYCLE_MS: how long each open lasts once fighting, and the gap after a close. */
  cycleMs: number;
  /** EXPO_PUBLIC_GAME3D_AUTOPLAY=1: the hero fights by itself (measurements). */
  autoplay: boolean;
  /** EXPO_PUBLIC_GAME3D_TILES_URL: map tiles for the arena floor (optional). */
  tilesUrl: string;
  /** EXPO_PUBLIC_GAME3D_LOD=0|1|2: the characters' LOD, else by device class (fightLod). */
  lod: number | null;
};

export type Fight3DEnv = {
  EXPO_PUBLIC_GAME3D?: string;
  EXPO_PUBLIC_GODOT_KEEP?: string;
  EXPO_PUBLIC_GAME3D_AUTOSTART?: string;
  EXPO_PUBLIC_GAME3D_CYCLE?: string;
  EXPO_PUBLIC_GAME3D_CYCLE_MS?: string;
  EXPO_PUBLIC_GAME3D_AUTOPLAY?: string;
  EXPO_PUBLIC_GAME3D_TILES_URL?: string;
  EXPO_PUBLIC_GAME3D_LOD?: string;
};

/** The Godot host draws through SurfaceControl, which is Android 10 (API 29) and up. */
export const ANDROID_MIN_API = 29;

function intIn(raw: string | undefined, lo: number, hi: number, fallback: number): number {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isInteger(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}

export function fight3dFlags(env: Fight3DEnv, platform: { os: string; version: number | string }): Fight3DFlags {
  const supported = platform.os === "ios" || (platform.os === "android" && Number(platform.version) >= ANDROID_MIN_API);
  const on = env.EXPO_PUBLIC_GAME3D === "1" && supported;
  const lod = intIn(env.EXPO_PUBLIC_GAME3D_LOD, 0, 2, -1);
  return {
    on,
    keep: env.EXPO_PUBLIC_GODOT_KEEP !== "0",
    autostart: on ? parseMode(env.EXPO_PUBLIC_GAME3D_AUTOSTART) : null,
    cycle: on ? intIn(env.EXPO_PUBLIC_GAME3D_CYCLE, 0, 1000, 0) : 0,
    cycleMs: intIn(env.EXPO_PUBLIC_GAME3D_CYCLE_MS, 500, 600_000, 8000),
    autoplay: env.EXPO_PUBLIC_GAME3D_AUTOPLAY === "1",
    tilesUrl: (env.EXPO_PUBLIC_GAME3D_TILES_URL ?? "").trim(),
    lod: lod < 0 ? null : lod,
  };
}

/** A test run asked for by the dev link (cosquest://fight3d?mode=arena&cycle=10&ms=8000&autoplay=1). */
export type Fight3DRun = { mode: Fight3DMode; cycle: number; cycleMs: number; autoplay: boolean };

export function runFromParams(q: Record<string, string | string[] | undefined>, flags: Fight3DFlags): Fight3DRun {
  const one = (k: string) => {
    const v = q[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const auto = one("autoplay");
  return {
    mode: parseMode(one("mode")) ?? flags.autostart ?? "full",
    cycle: intIn(one("cycle"), 0, 1000, flags.cycle),
    cycleMs: intIn(one("ms"), 500, 600_000, flags.cycleMs),
    autoplay: auto === undefined ? flags.autoplay || intIn(one("cycle"), 0, 1000, flags.cycle) > 0 : auto === "1" || auto === "true",
  };
}

/**
 * The test link's look switches (cosquest://fight3d?look=post, look=glow,grade, look=-bloom):
 * Godot's `look` config keys (arena.gd LOOK_DEFAULTS), comma-separated, a leading "-" for off.
 * The opt-in post stack (glow + grade) is measured on a device this way. Unknown words are dropped.
 */
export function lookFromParam(raw: string | undefined): Record<string, boolean> | null {
  const out: Record<string, boolean> = {};
  for (const w of (raw ?? "").split(",")) {
    const m = /^(-?)([a-z_]{2,20})$/.exec(w.trim());
    if (m) out[m[2]] = m[1] !== "-";
  }
  return Object.keys(out).length ? out : null;
}

// ---------- the characters ----------

/** The characters' LOD in the fight: 1 on low and mid phones (and the emulator), 0 on high ones. */
export function fightLod(cls: "low" | "mid" | "high", override: number | null): number {
  if (override !== null) return override;
  return cls === "high" ? 0 : 1;
}

/**
 * The index the game server uses to give a fight its opponent character
 * (costquest-backend app/roam_forge.py opponent_character): the published
 * characters of the role ordered by id, picked by
 * int(sha256("forge-opponent|<role>|<key>")[:12 hex]) mod their count. The
 * same pick here means the 3D fight shows the Guardian the versus card would.
 */
export function opponentIndex(role: string, key: string, count: number): number {
  if (count <= 0) return -1;
  const hex = bytesToHex(sha256(utf8ToBytes(["forge-opponent", role, key].join("|")))).slice(0, 12);
  return parseInt(hex, 16) % count;
}

type CharacterPick = Pick<ForgeEntry, "id" | "name" | "type" | "gameplay">;

export function pickOpponent<T extends CharacterPick>(entries: readonly T[], role: "guardian" | "boss", key: string): T | null {
  const list = entries.filter((e) => e.type === "character" && e.gameplay.role === role).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const i = opponentIndex(role, key, list.length);
  return i < 0 ? null : list[i];
}

/** Another hero to fight beside you: the first wearable hero by name that is not yours. */
export function pickAlly<T extends CharacterPick>(entries: readonly T[], heroId: string | null): T | null {
  const heroes = entries
    .filter((e) => e.type === "character" && e.id !== heroId && (e.gameplay.avatar === true || e.gameplay.role === "hero"))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return heroes[0] ?? null;
}

/**
 * The hero the player wears, for the fight: the bag's answer once it has
 * loaded (even "none", after Take off), else /me's block. The same rule as
 * the HUD chip and the profile (forgeWorldDevice useEquipped), so the fight
 * casts the face the map shows (cq 076).
 */
export function wornAvatarId(
  inventory: { equipped: { avatar: string | null } } | null | undefined,
  me: { equipped: { avatar: string | null } },
): string | null {
  return inventory ? inventory.equipped.avatar : me.equipped.avatar;
}

/**
 * The three characters of a fight: your worn avatar, an ally hero, and the
 * opponent (the server's own pick when a duel start named one, else the same
 * pick the server would make for this point). With no avatar worn (a new
 * player, or a worn one that was unpublished) you fight as the first
 * wearable hero by name, never as Godot's placeholder capsule (cq 076).
 */
export function pickCast<T extends CharacterPick>(
  entries: readonly T[],
  opts: { avatarId: string | null; enemyId?: string | null; role: "guardian" | "boss"; key: string | null },
): { hero: T | null; ally: T | null; enemy: T | null } {
  const byId = (id: string | null | undefined) => (id ? (entries.find((e) => e.id === id && e.type === "character") ?? null) : null);
  const hero = byId(opts.avatarId) ?? pickAlly(entries, null);
  const enemy = byId(opts.enemyId) ?? (opts.key ? pickOpponent(entries, opts.role, opts.key) : null);
  return { hero, ally: pickAlly(entries, hero?.id ?? null), enemy };
}

/**
 * An absolute file system path for Godot from a file:// URI (the Forge cache
 * hands out URIs). Anything that is not a local file is "" (Godot then
 * draws its mannequin).
 */
export function localPath(uri: string | null | undefined): string {
  if (!uri) return "";
  let p = uri;
  if (/^file:\/\//i.test(p)) p = p.replace(/^file:\/\//i, "");
  else if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return "";
  if (!p.startsWith("/")) return "";
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

// ---------- what goes to Godot ----------

export type Fight3DConfig = {
  hero_glb: string;
  ally_glb: string;
  enemy_glb: string;
  hero_name: string;
  ally_name: string;
  enemy_name: string;
  duration_s: number;
  players_text: string;
  point_name: string;
  mode: Fight3DMode;
  tiles_url?: string;
  tiles_lat?: number;
  tiles_lon?: number;
  tiles_alt?: number;
  tiles_ground?: boolean;
  tiles_sse?: number;
  tiles_origin_type?: number;
  tiles_rot_x?: number;
  seed: number;
  autoplay: boolean;
  /** The app's Reduce motion setting (cq 013): a quarter of the camera shake, no zoom punch. Sent only when on. */
  reduce_motion?: boolean;
};

export const FIGHT_SECONDS = 45;

export function buildFightConfig(input: {
  hero: { path: string | null; name: string | null };
  ally: { path: string | null; name: string | null };
  enemy: { path: string | null; name: string | null };
  pointName: string;
  mode: Fight3DMode;
  seed: number;
  autoplay: boolean;
  tilesUrl?: string | null;
  durationS?: number;
  playersText?: string;
  reduceMotion?: boolean;
}): Fight3DConfig {
  const config: Fight3DConfig = {
    hero_glb: localPath(input.hero.path),
    ally_glb: localPath(input.ally.path),
    enemy_glb: localPath(input.enemy.path),
    hero_name: input.hero.name?.trim() || "You",
    ally_name: input.ally.name?.trim() || "Ally",
    enemy_name: input.enemy.name?.trim() || "Guardian",
    duration_s: input.durationS ?? FIGHT_SECONDS,
    players_text: input.playersText ?? "2/3 players",
    point_name: input.pointName,
    mode: input.mode,
    seed: Math.trunc(Math.abs(input.seed)) % 2147483647,
    autoplay: input.autoplay,
  };
  if (input.tilesUrl) Object.assign(config, tilesFields(input.tilesUrl));
  if (input.reduceMotion) config.reduce_motion = true;
  return config;
}

/**
 * The tiles layer's config from a tileset URL that may end in
 * "#lat,lon,alt[,ground[,sse[,origin[,rotx]]]]": where the arena stands on the tileset (the
 * georeference origin); ground 0 keeps the arena's own floor (a tileset that
 * is a landmark beside the fight, not the ground); sse is Cesium's maximum
 * screen space error (detail); origin 1 is Cesium's True Origin (engine
 * coordinates are ECEF, for tilesets with no georeference); rotx turns the
 * tileset node about X (degrees, default 90: ECEF Z-up to Godot Y-up). The fragment never reaches the server.
 */
type TilesKeys = "tiles_url" | "tiles_lat" | "tiles_lon" | "tiles_alt" | "tiles_ground" | "tiles_sse" | "tiles_origin_type" | "tiles_rot_x";
export function tilesFields(url: string): Pick<Fight3DConfig, TilesKeys> {
  const [base, frag] = url.trim().split("#", 2);
  const out: Pick<Fight3DConfig, TilesKeys> = { tiles_url: base };
  const n = (frag ?? "").split(",").map((v) => Number(v));
  if (n.length >= 2 && n.every((v) => Number.isFinite(v)) && Math.abs(n[0]) <= 90 && Math.abs(n[1]) <= 180) {
    out.tiles_lat = n[0];
    out.tiles_lon = n[1];
    out.tiles_alt = n.length >= 3 ? n[2] : 0;
    if (n.length >= 4) out.tiles_ground = n[3] !== 0;
    if (n.length >= 5 && n[4] > 0) out.tiles_sse = n[4];
    if (n.length >= 6) out.tiles_origin_type = n[5] === 1 ? 1 : 0;
    if (n.length >= 7) out.tiles_rot_x = n[6];
  }
  return out;
}

/**
 * The arguments Godot starts with, as the library's example app does:
 * Android opens the exported folder in the APK's assets (`--path /game3d`),
 * iOS the pack in the app bundle (`--main-pack <bundle>/game3d.pck`); the GL
 * compatibility renderer (the iOS simulator has no OpenGL ES, so Metal there),
 * and the "embedded" display driver that draws into RTNGodotView.
 */
export function godotArgs(os: string, opts: { bundleDir?: string | null; iosSimulator?: boolean; name?: string } = {}): string[] {
  const name = opts.name ?? "game3d";
  if (os === "android") {
    return ["--path", `/${name}`, "--rendering-driver", "opengl3", "--rendering-method", "gl_compatibility", "--display-driver", "embedded"];
  }
  const dir = localPath(opts.bundleDir).replace(/\/+$/, "");
  const renderer = opts.iosSimulator ? ["--rendering-driver", "metal", "--rendering-method", "mobile"] : ["--rendering-driver", "opengl3", "--rendering-method", "gl_compatibility"];
  return ["--main-pack", `${dir}/${name}.pck`, ...renderer, "--display-driver", "embedded"];
}

// ---------- what comes back ----------

export type Fight3DOutcome = "win" | "lose" | "timeout" | "quit";
export type Fight3DResult = {
  outcome: Fight3DOutcome;
  damage_dealt: number;
  damage_taken: number;
  time_s: number;
  hits: number;
  skill_uses: number;
  enemy_hp_left: number;
  hero_hp_left: number;
  mode: string;
};

const OUTCOMES: readonly Fight3DOutcome[] = ["win", "lose", "timeout", "quit"];
const n0 = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

/** The result JSON from Godot, checked. Null for anything without a known outcome. */
export function parseFightResult(json: unknown): Fight3DResult | null {
  let o: unknown = json;
  if (typeof json === "string") {
    try {
      o = JSON.parse(json);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  const outcome = typeof r.outcome === "string" ? (r.outcome.toLowerCase() as Fight3DOutcome) : null;
  if (!outcome || !OUTCOMES.includes(outcome)) return null;
  return {
    outcome,
    damage_dealt: Math.round(n0(r.damage_dealt)),
    damage_taken: Math.round(n0(r.damage_taken)),
    time_s: Math.round(n0(r.time_s) * 10) / 10,
    hits: Math.round(n0(r.hits)),
    skill_uses: Math.round(n0(r.skill_uses)),
    enemy_hp_left: Math.round(n0(r.enemy_hp_left)),
    hero_hp_left: Math.round(n0(r.hero_hp_left)),
    mode: typeof r.mode === "string" ? r.mode : "",
  };
}

/** bridge.get_status(): its state ("loading", "fighting", "over", ...), or null when unreadable. */
export function parseStatus(json: unknown): { state: string; raw: Record<string, unknown> } | null {
  let o: unknown = json;
  if (typeof json === "string") {
    try {
      o = JSON.parse(json);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const raw = o as Record<string, unknown>;
  return typeof raw.state === "string" ? { state: raw.state, raw } : null;
}

/** The "quit" a fight closed before Godot answered is reported as (the X, Android Back). */
export function quitResult(mode: string, timeS = 0): Fight3DResult {
  return { outcome: "quit", damage_dealt: 0, damage_taken: 0, time_s: timeS, hits: 0, skill_uses: 0, enemy_hp_left: 0, hero_hp_left: 0, mode };
}

const HEADLINES: Record<Fight3DOutcome, string> = {
  win: "Guardian down!",
  lose: "The Guardian held",
  timeout: "Time's up",
  quit: "You left the fight",
};

export const FIGHT3D_NOTE = "That was a 3D practice fight, just for fun. Your XP comes from the regular Fight.";

/**
 * The reward screen for a 3D fight. The game server judges a duel by
 * replaying the 2D sim's inputs (POST /v1/duel/finish), which a Godot fight
 * does not have, so nothing is sent: the screen shows Godot's own numbers,
 * pays nothing, and says so. The level bar stays where it is.
 */
export function rewardFrom3D(r: Fight3DResult, point: { name: string; realm: string }, standing: RoamStanding | null): RewardSummary {
  const s = Math.round(r.time_s);
  return {
    pointName: point.name,
    realm: point.realm,
    win: r.outcome === "win",
    headline: HEADLINES[r.outcome],
    xp: 0,
    coins: 0,
    factionPoints: 0,
    lines: [],
    before: standing,
    after: standing,
    leveledUp: false,
    rankUp: false,
    dailiesCompleted: [],
    extras: [],
    note: FIGHT3D_NOTE,
    practice: true,
    stats: [
      { id: "outcome", label: "Result", value: HEADLINES[r.outcome] },
      { id: "damage-dealt", label: "Damage dealt", value: String(r.damage_dealt) },
      { id: "damage-taken", label: "Damage taken", value: String(r.damage_taken) },
      { id: "time", label: "Time", value: s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s} s` },
    ],
  };
}
