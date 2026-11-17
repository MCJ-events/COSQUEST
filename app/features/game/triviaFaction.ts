// Trivia for your faction (17 Nov 2026, Mark TG 47999): your Daily trivia score goes to your faction, a live
// faction leaderboard (today, this week, the season), and the online psychoanimus meter: when many of a
// faction's players answer the day's trivia, the meter fills and unlocks a reward. In the app only, never on the
// web /play page (factionTriviaShown). The server owns every number (ubmids/costquest-backend
// app/trivia_faction.py, flags trivia_faction and trivia_psychoanimus); this is the pure half: wire shapes, the
// calls, and what each screen says. Off on the server = 404 = nothing drawn.
import type { GameClient } from "./client";
import type { ShareCard } from "./triviaVisual";

export type FactionPeriod = "today" | "week" | "season";
export const FACTION_PERIODS: { id: FactionPeriod; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "season", label: "Season" },
];

export type FactionRow = { faction: string; name: string; total: number; players: number; place: number };
export type FactionBoard = {
  period: FactionPeriod;
  from: string | null;
  to: string | null;
  season: { id: string; name: string } | null;
  factions: FactionRow[];
  you: { faction: string | null; name: string | null; contributed: number; needs_faction: boolean } | null;
  card_url?: string | null;
  note?: string;
};

export type MeterTier = { id: string; at: number; label: string; detail: string; xp: number; story_slot: string | null; unlocked: boolean };
export type FactionMeter = {
  faction: string;
  name: string;
  participants: number;
  value: number;
  max: number;
  fill: number;
  tiers: MeterTier[];
  next: { id: string; at: number; label: string; players_needed: number } | null;
};
export type Psychoanimus = {
  day: string;
  weight_online: number;
  weight_in_person: number;
  note: string;
  meters: FactionMeter[];
  you: { faction: string | null; played_today: boolean; claimed: string[]; claimable: string[]; needs_faction: boolean } | null;
};
export type ClaimResult = Psychoanimus & { paid: { id: string; label: string; xp: number; story_slot: string | null }[]; xp: number };

/** Faction trivia lives in the app only: the web /play page is the public, faction-free door. */
export function factionTriviaShown(os: string): boolean {
  return os === "ios" || os === "android";
}

export async function triviaFactions(client: GameClient, period: FactionPeriod, deviceKey?: string | null): Promise<FactionBoard> {
  const query: Record<string, string> = { period };
  if (deviceKey) query.device_key = deviceKey;
  return client.request<FactionBoard>("GET", "v1/trivia/factions", { query });
}

export async function triviaPsychoanimus(client: GameClient, deviceKey?: string | null): Promise<Psychoanimus> {
  return client.request<Psychoanimus>("GET", "v1/trivia/psychoanimus", { query: deviceKey ? { device_key: deviceKey } : {} });
}

export async function claimPsychoanimus(client: GameClient): Promise<ClaimResult> {
  return client.request<ClaimResult>("POST", "v1/trivia/psychoanimus/claim", { body: { device_key: client.deviceKey() }, signed: true });
}

/** "1,234 pts · 12 players" for a faction row. */
export function factionLine(r: Pick<FactionRow, "total" | "players">): string {
  const n = r.players;
  return `${r.total.toLocaleString("en-US")} pts · ${n.toLocaleString("en-US")} ${n === 1 ? "player" : "players"}`;
}

/** What the panel says about you: pick a faction, or what you added to yours. */
export function youLine(b: Pick<FactionBoard, "you" | "period">): string | null {
  const y = b.you;
  if (!y) return null;
  if (y.needs_faction || !y.faction) return "Pick a faction and your trivia score counts for it.";
  const when = b.period === "today" ? "today" : b.period === "week" ? "this week" : "this season";
  return y.contributed > 0
    ? `You added ${y.contributed.toLocaleString("en-US")} pts to ${y.name ?? "your faction"} ${when}.`
    : `Play today's trivia to add to ${y.name ?? "your faction"}.`;
}

/** The faction board as a share card (only when the server draws one). */
export function factionShareCard(b: Pick<FactionBoard, "card_url" | "period" | "to" | "you" | "factions">, link: string): ShareCard | null {
  if (!b.card_url) return null;
  const lead = b.factions[0];
  const mine = b.you?.faction ? b.factions.find((f) => f.faction === b.you?.faction) : null;
  const when = b.period === "today" ? "today" : b.period === "week" ? "this week" : "this season";
  const text = mine
    ? `${mine.name} is #${mine.place} in CosQuest trivia ${when}. Play for your faction.`
    : lead && lead.total > 0
      ? `${lead.name} leads CosQuest trivia ${when}. Play for your faction.`
      : `The CosQuest faction trivia board. Play for your faction.`;
  return { id: `factions-${b.period}-${b.to ?? "now"}`, url: link, image_url: b.card_url, text };
}

/** The meter's line under the bar: what is open, or how many more players open the next reward. */
export function meterLine(m: Pick<FactionMeter, "next" | "tiers" | "participants">): string {
  const open = m.tiers.filter((t) => t.unlocked).length;
  const played = `${m.participants.toLocaleString("en-US")} ${m.participants === 1 ? "player" : "players"} today`;
  if (!m.next) return `${played} · every reward open`;
  const more = m.next.players_needed;
  return `${played} · ${more.toLocaleString("en-US")} more for ${m.next.label.toLowerCase()}${open ? ` (${open} open)` : ""}`;
}

/** Online counts less than in person; the line that says by how much. */
export function weightLine(p: Pick<Psychoanimus, "weight_online" | "weight_in_person">): string {
  if (!(p.weight_in_person > 0)) return "";
  const share = Math.round((p.weight_online / p.weight_in_person) * 100);
  return `Playing online fills it at ${share}% of being there in person.`;
}

/** Your faction's meter, else none. */
export function myMeter(p: Pick<Psychoanimus, "meters" | "you">): FactionMeter | null {
  const f = p.you?.faction;
  return f ? p.meters.find((m) => m.faction === f) ?? null : null;
}

/** The claim button: shown when you played today and a reward is open and unclaimed. */
export function claimLabel(p: Pick<Psychoanimus, "you" | "meters">): string | null {
  const y = p.you;
  if (!y || y.needs_faction || !y.played_today || y.claimable.length === 0) return null;
  const m = myMeter(p);
  const xp = (m?.tiers ?? []).filter((t) => y.claimable.includes(t.id)).reduce((s, t) => s + t.xp, 0);
  return xp > 0 ? `Claim +${xp} XP` : "Claim";
}
