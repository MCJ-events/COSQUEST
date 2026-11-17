// "Your day": the card's words and the text a player shares. The pure half of
// costquest-ios Warden/RecapSheet.swift (RecapCard). The numbers are the
// server's (me.today); plain data, no Warden story (build 24).
// Pure: no React Native imports (tested in __tests__/recap.test.ts).
import type { RoamMe } from "./wire.ts";

export type Today = NonNullable<RoamMe["today"]>;

/** The card is told only once there is something to tell. */
export function hasDayToTell(me: RoamMe | null | undefined): boolean {
  return (me?.today?.points_played ?? 0) > 0;
}

export function cardSubtitle(level: number, rank: string, faction?: string | null): string {
  return `Level ${level} ${rank}${faction ? ` · ${faction}` : ""}`;
}

export function tiles(t: Today): { value: string; label: string }[] {
  return [
    { value: String(t.points_played), label: "points" },
    { value: String(t.correct), label: "right" },
    { value: String(t.xp), label: "XP" },
  ];
}

export const EMPTY_LINE = "Nothing played yet today. Play a Quest Point to see your day here.";

/** What the system share sheet carries: the numbers and the best stop. */
export function shareText(opts: { name: string; level: number; rank: string; faction?: string | null; today: Today }): string {
  const t = opts.today;
  const lines = [
    `My CostQuest day: ${t.points_played} ${t.points_played === 1 ? "point" : "points"}, ${t.correct} right, ${t.xp} XP.`,
    `${opts.name}, ${cardSubtitle(opts.level, opts.rank, opts.faction)}`,
  ];
  if (t.best_place) lines.push(`Best stop: ${t.best_place}`);
  return lines.join("\n");
}
