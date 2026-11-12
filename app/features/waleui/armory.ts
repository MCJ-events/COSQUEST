// Wale's Armory ("weapons" frame) and weapon page ("Speedshot mobile detail"),
// filled with the REAL faction weapon ladder instead of the mock-up names in
// the Figma (Speedshot, Hornbow...: he confirmed on 11 Nov they are mock-ups).
//
// The ladder comes from the game server (/v1/progression/me and /config,
// features/game/progression.ts). When the server does not answer, or the
// player has no faction yet, the bundled snapshot of the seed is shown and
// every weapon reads as not owned except the starter.
//
// Two of his fields have nothing behind them in the data model, so they are
// derived or marked as placeholders here, in one place:
//   - "Complexity n/5": derived from the tier (ten tiers folded into five).
//   - "Health 20 000" and "Upgrade cores": no server field. Shown as "Not set" and
//     as empty slots, flagged `placeholder`.
// Wale, 11 Nov: the attack buttons never change with the weapon, so the page
// shows the one fixed attack panel for every weapon.
//
// Pure (tested in features/waleui/__tests__/armory.test.ts).
import type { LadderWeapon, ProgMe, ProgWeapon, WeaponState } from "../game/progression.ts";
import { SNAPSHOT_FACTIONS, SNAPSHOT_WEAPONS } from "./ladderSnapshot.ts";

export type ArmoryWeapon = {
  id: string;
  name: string;
  tier: number;
  tierLabel: string;
  state: WeaponState;
  /** The line under the name on a card. */
  status: string;
  /** His type line on the weapon page ("RANGED DAMAGE" in the mock-up). We have no weapon class, so it is the tier. */
  typeLine: string;
  tagline: string;
  /** 1..5 */
  complexity: number;
  equipped: boolean;
};

export type Armory = {
  factionId: string;
  factionName: string;
  /** "server" = this player's own ladder. "snapshot" = the bundled seed copy (offline, or no faction yet). */
  source: "server" | "snapshot";
  owned: ArmoryWeapon[];
  notOwned: ArmoryWeapon[];
  total: number;
};

/** Ten tiers (0..9) folded into his five complexity pips. */
export function complexityForTier(tier: number): number {
  return Math.max(1, Math.min(5, Math.floor(Math.max(0, tier) / 2) + 1));
}

export function statusText(state: WeaponState, w: { unlocks_at_rank?: number | null }): string {
  if (state === "owned") return "OWNED";
  if (state === "available") return "READY TO UNLOCK";
  return w.unlocks_at_rank ? `UNLOCKS AT RANK ${w.unlocks_at_rank}` : "NOT OWNED";
}

function shape(w: ProgWeapon & { state: WeaponState; unlocks_at_rank?: number | null }, equippedId: string | null): ArmoryWeapon {
  const label = (w.tier_label ?? "").trim() || `Tier ${w.tier}`;
  return {
    id: w.id,
    name: w.name,
    tier: w.tier,
    tierLabel: label,
    state: w.state,
    status: statusText(w.state, w),
    typeLine: `${label} · TIER ${w.tier + 1}`.toUpperCase(),
    tagline: (w.description ?? "").trim(),
    complexity: complexityForTier(w.tier),
    equipped: w.id === equippedId,
  };
}

/** The weapon the player holds: the highest tier they own (the ladder has no separate "equipped" field). */
export function equippedWeaponId(ladder: { id: string; tier: number; state: WeaponState }[]): string | null {
  const owned = ladder.filter((w) => w.state === "owned").sort((a, b) => b.tier - a.tier);
  return owned[0]?.id ?? null;
}

export function factionName(id: string): string {
  return SNAPSHOT_FACTIONS.find((f) => f.id === id)?.name ?? id;
}

/** The snapshot ladder of one faction: the starter owned, the rest locked. */
export function snapshotLadder(factionId: string): LadderWeapon[] {
  const list = SNAPSHOT_WEAPONS.filter((w) => w.faction === factionId);
  return list.map((w) => ({ ...w, state: w.starter ? ("owned" as const) : ("locked" as const), unlocks_at_rank: null }));
}

/**
 * The Armory for this player. `me` is the server's answer or null; `fallbackFaction`
 * is the faction to show from the snapshot when the server gives no ladder
 * (the chat profile's faction, else the first faction).
 */
export function buildArmory(me: Pick<ProgMe, "faction" | "faction_name" | "ladder"> | null | undefined, fallbackFaction?: string | null): Armory {
  const serverLadder = me?.ladder && me.ladder.length > 0 ? me.ladder : null;
  const known = (id: string | null | undefined) => !!id && SNAPSHOT_FACTIONS.some((f) => f.id === id);
  const factionId = serverLadder ? (me?.faction ?? serverLadder[0].faction) : known(me?.faction) ? (me!.faction as string) : known(fallbackFaction) ? (fallbackFaction as string) : SNAPSHOT_FACTIONS[0].id;
  const ladder = (serverLadder ?? snapshotLadder(factionId)).slice().sort((a, b) => a.tier - b.tier);
  const eq = equippedWeaponId(ladder);
  const all = ladder.map((w) => shape(w, eq));
  return {
    factionId,
    factionName: (serverLadder && me?.faction_name) || factionName(factionId),
    source: serverLadder ? "server" : "snapshot",
    owned: all.filter((w) => w.state === "owned"),
    notOwned: all.filter((w) => w.state !== "owned"),
    total: all.length,
  };
}

export function findWeapon(a: Armory, id: string | null | undefined): ArmoryWeapon | null {
  return [...a.owned, ...a.notOwned].find((w) => w.id === id) ?? a.owned[a.owned.length - 1] ?? a.notOwned[0] ?? null;
}

/** "2 owned · 14 weapons" */
export function armoryFooter(a: Armory): string {
  return `${a.owned.length} owned · ${a.total} weapons`;
}

/** "2 weapons" / "1 weapon" */
export function countLabel(n: number): string {
  return `${n} weapon${n === 1 ? "" : "s"}`;
}

/** "14 220" (his frames group thousands with a space). */
export function spaced(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "0";
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** 0..1 for an XP bar; never NaN. */
export function xpRatio(have: number | null | undefined, need: number | null | undefined): number {
  if (!have || !need || need <= 0) return 0;
  return Math.max(0, Math.min(1, have / need));
}
