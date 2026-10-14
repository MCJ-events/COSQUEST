// The Forge catalogue: the weapons the Forge portal has published, shown in
// the Relicdex next to the player's Relics. costquest-ios Net/ForgeCatalogue.swift
// (wire, tolerant decoding) and Features/ForgeFeature.swift (ForgeCatalogueModel,
// ForgeLook).
//
// Read only, as on iOS: GET v1/catalogue is public and unsigned
// (costquest-backend app/forge.py `catalogue`), and the server has no route
// for a player to acquire, equip or trade a Forge weapon. A Forge weapon is
// labelled as such and shown with its stats; nothing is granted.
//
// Not ported: the lod0 GLB download, its sha256 check and the on-disk cache
// (they only fed iOS's turning 3D preview). The screens draw the weapon in
// 2D, or the server's own thumbnail of it when the build made one.
// Pure: the client is passed in (tested in __tests__/forge.test.ts).
import { GameError, type GameClient } from "./client.ts";

export type ForgeStats = { damage?: number | null; range_m?: number | null; cooldown_s?: number | null };
export type ForgeFile = { file: string; lod?: number | null; bytes?: number | null; sha256?: string | null; url: string };
export type ForgeThumbnail = { file: string; sha256?: string | null; url: string };

export type ForgeElement = {
  id: string;
  /** weapon | character | environment */
  type: string;
  name: string;
  version: number;
  realm?: string | null;
  /** common | rare | epic | legendary */
  rarity?: string | null;
  role?: string | null;
  rigged?: boolean | null;
  published_at?: string | null;
  stats?: ForgeStats | null;
  files: ForgeFile[];
  thumbnail?: ForgeThumbnail | null;
};

/** Where the catalogue came from (ForgeCatalogueStore.Source, without the disk cache). */
export type ForgeSource = "network" | "memory" | "unavailable" | "none";

const optStr = (v: unknown): string | null => (typeof v === "string" ? v : null);
const optNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * One element, or null. id, type, name and version are required; everything
 * else is optional and tolerant: one odd field in a new server build must not
 * empty the whole catalogue.
 */
export function parseForgeElement(raw: unknown): ForgeElement | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.type !== "string" || typeof r.name !== "string") return null;
  if (typeof r.version !== "number" || !Number.isInteger(r.version)) return null;
  const s = r.stats && typeof r.stats === "object" ? (r.stats as Record<string, unknown>) : null;
  const files = (Array.isArray(r.files) ? r.files : []).flatMap((f): ForgeFile[] => {
    if (!f || typeof f !== "object") return [];
    const x = f as Record<string, unknown>;
    if (typeof x.file !== "string" || typeof x.url !== "string") return [];
    return [{ file: x.file, url: x.url, lod: optNum(x.lod), bytes: optNum(x.bytes), sha256: optStr(x.sha256) }];
  });
  const t = r.thumbnail && typeof r.thumbnail === "object" ? (r.thumbnail as Record<string, unknown>) : null;
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    version: r.version,
    realm: optStr(r.realm),
    rarity: optStr(r.rarity),
    role: optStr(r.role),
    rigged: typeof r.rigged === "boolean" ? r.rigged : null,
    published_at: optStr(r.published_at),
    stats: s ? { damage: optNum(s.damage), range_m: optNum(s.range_m), cooldown_s: optNum(s.cooldown_s) } : null,
    files,
    thumbnail: t && typeof t.file === "string" && typeof t.url === "string" ? { file: t.file, url: t.url, sha256: optStr(t.sha256) } : null,
  };
}

/** The catalogue body, element by element, dropping the ones that do not parse. */
export function parseForgeCatalogue(raw: unknown): ForgeElement[] {
  const elements = raw && typeof raw === "object" ? (raw as { elements?: unknown }).elements : null;
  if (!Array.isArray(elements)) throw new GameError("decoding", "The server sent something unexpected.");
  return elements.map(parseForgeElement).filter((e): e is ForgeElement => e !== null);
}

const RARITY_ORDER = ["legendary", "epic", "rare", "common"];
const rank = (r: string | null | undefined) => {
  const i = RARITY_ORDER.indexOf(r ?? "");
  return i < 0 ? 9 : i;
};

/** The weapons, rarest first, then by name (ForgeCatalogueModel.refresh). */
export function forgeWeapons(elements: ForgeElement[]): ForgeElement[] {
  return elements
    .filter((e) => e.type === "weapon")
    .sort((a, b) => rank(a.rarity) - rank(b.rarity) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * The Forge has no weapon kind yet, so the silhouette is read from the name,
 * the way a player would (ForgeLook.kind).
 */
export function forgeKind(name: string): string {
  const n = name.toLowerCase();
  const words: [string, string][] = [
    ["axe", "axe"],
    ["cleaver", "axe"],
    ["bow", "bow"],
    ["staff", "staff"],
    ["wand", "staff"],
    ["hammer", "hammer"],
    ["mace", "hammer"],
    ["gauntlet", "gauntlet"],
    ["fist", "gauntlet"],
  ];
  for (const [word, kind] of words) if (n.includes(word)) return kind;
  return "blade";
}

/** 15 → "15", 2.5 → "2.5", nothing → "—" (ForgeLook.number). */
export function forgeNumber(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return Math.round(v) === v ? String(v) : v.toFixed(1);
}

/** The thumbnail's absolute URL (the server answers ?w=128|256|512|768 as WebP), or null. */
export function forgeThumbnailUrl(baseUrl: string, el: ForgeElement, width?: 128 | 256 | 512 | 768): string | null {
  const url = el.thumbnail?.url;
  if (!url) return null;
  const abs = /^https?:\/\//.test(url) ? url : `${baseUrl.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
  return width ? `${abs}${abs.includes("?") ? "&" : "?"}w=${width}` : abs;
}

/**
 * The published weapons. A server from before the Forge answers 404: no
 * Forge section, not an error worth a word.
 */
export async function fetchForgeCatalogue(client: GameClient): Promise<{ weapons: ForgeElement[]; source: ForgeSource }> {
  try {
    const raw = await client.request<unknown>("GET", "v1/catalogue", { query: { type: "weapon" } });
    return { weapons: forgeWeapons(parseForgeCatalogue(raw)), source: "network" };
  } catch (error) {
    if (error instanceof GameError && error.status === 404) return { weapons: [], source: "unavailable" };
    throw error;
  }
}

export type ForgeState = { weapons: ForgeElement[]; source: ForgeSource | null; loading: boolean };

/** The server's own max-age is a minute: a refresh inside it is skipped. */
export const FORGE_REFRESH_MS = 60_000;

/**
 * The catalogue for the screens (ForgeCatalogueModel). Cheap to call often.
 * Never throws: a screen that cannot get the catalogue keeps the last one it
 * had this session, or shows no Forge section.
 */
export function createForgeStore(deps: { client: GameClient; now?: () => number }) {
  const now = deps.now ?? (() => Date.now());
  let state: ForgeState = { weapons: [], source: null, loading: false };
  let last = -Infinity;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<ForgeState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  return {
    get: () => state,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    weapon: (id: string) => state.weapons.find((w) => w.id === id) ?? null,
    async refresh(force = false): Promise<void> {
      if (state.loading) return;
      if (!force && now() - last < FORGE_REFRESH_MS) return;
      set({ loading: true });
      try {
        const got = await fetchForgeCatalogue(deps.client);
        last = now();
        set({ weapons: got.weapons, source: got.source });
      } catch {
        set({ source: state.weapons.length ? "memory" : "none" });
      } finally {
        set({ loading: false });
      }
    },
  };
}

export type ForgeStore = ReturnType<typeof createForgeStore>;
