// The reward ceremony's numbers and timing as pure functions (no react-native,
// so node can test them). costquest-ios Roam/RewardView.swift (play()).

/** The bar's fraction of its level (Standing.progress): full at the top level. */
export function standingProgress(s: { into_level: number; level_span: number; max_level: boolean } | null | undefined): number {
  if (!s) return 0;
  if (s.max_level) return 1;
  const p = s.into_level / Math.max(1, s.level_span);
  return Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
}

const LINE_START_MS = 250;
const LINE_EVERY_MS = 280;
const XP_STEPS = 20;
const XP_STEP_MS = 30;
const LEVEL_FILL_MS = 500;
const LEVEL_HOLD_MS = 550;
const SETTLE_MS = 600;

export type CeremonyTimeline = {
  /** When each reward line appears (one tap sound each). */
  lineAt: number[];
  /** The XP counter: twenty steps of 30 ms, each a whole number. */
  xp: { atMs: number; value: number }[];
  /** The XP has counted: extras (the Relic) land now. */
  xpDoneAt: number;
  /** Level-up only: the bar eases to full, then the level changes and the overlay shows. */
  level: { fillAt: number; fillMs: number; popAt: number } | null;
  /** The bar settles on the new progress (a level-up settles behind the overlay). */
  settleAt: number;
  settleMs: number;
};

/** RewardView.play(): a quarter second, a line every 280 ms, XP in 20 x 30 ms, then the bar. */
export function ceremonyTimeline(lineCount: number, xp: number, leveledUp: boolean): CeremonyTimeline {
  const lines = Math.max(0, Math.floor(lineCount));
  const lineAt = Array.from({ length: lines }, (_, i) => LINE_START_MS + LINE_EVERY_MS * i);
  const countStart = LINE_START_MS + LINE_EVERY_MS * lines;
  const total = Math.max(0, Math.floor(xp));
  const steps = Array.from({ length: XP_STEPS }, (_, i) => ({
    atMs: countStart + XP_STEP_MS * i,
    value: Math.floor((total * (i + 1)) / XP_STEPS),
  }));
  const xpDoneAt = countStart + XP_STEP_MS * XP_STEPS;
  const popAt = xpDoneAt + LEVEL_HOLD_MS;
  return {
    lineAt,
    xp: steps,
    xpDoneAt,
    level: leveledUp ? { fillAt: xpDoneAt, fillMs: LEVEL_FILL_MS, popAt } : null,
    settleAt: leveledUp ? popAt : xpDoneAt,
    settleMs: SETTLE_MS,
  };
}

/** One reward line's amount: "+N XP" (Swift never shows coins), or the faction points when a line is only that. */
export function lineAmount(l: { xp: number; factionPoints: number }): string {
  if (l.xp > 0 || l.factionPoints <= 0) return `+${l.xp} XP`;
  return `+${l.factionPoints} FP`;
}

/** "+N for your faction". */
export function factionLine(points: number): string | null {
  return points > 0 ? `+${points} for your faction` : null;
}

export type DailyInfo = { id: string; title: string; reward?: { xp: number; coins: number } };
export type DailyDone<T extends DailyInfo = DailyInfo> = { id: string; title: string; daily: T | null };

/** The dailies a verdict completed, by title (RoamHomeView.celebrate: the daily's title, else "Daily quest"). */
export function dailiesDone<T extends DailyInfo>(ids: readonly string[], dailies: readonly T[] | null | undefined): DailyDone<T>[] {
  return ids.map((id) => {
    const daily = dailies?.find((d) => d.id === id) ?? null;
    return { id, title: daily?.title || "Daily quest", daily };
  });
}

/**
 * Ionicons name for the server's SF Symbol (x.icon), by the symbol's stem and
 * then by the extra's kind. The caller checks the name exists in the glyph map.
 */
export function ioniconForSymbol(symbol: string | null | undefined, kind: string): string {
  const stem = (symbol ?? "").replace(/\.(fill|circle|square)$/g, "").replace(/\.(fill|circle|square)$/g, "");
  const table: Record<string, string> = {
    sparkles: "sparkles",
    star: "star",
    "rectangle.stack": "albums",
    "square.stack": "albums",
    "square.grid.2x2": "albums",
    ticket: "ticket",
    gift: "gift",
    diamond: "diamond",
    flame: "flame",
    bag: "bag",
    shield: "shield",
    map: "map",
    bolt: "flash",
    trophy: "trophy",
    rosette: "ribbon",
    seal: "ribbon",
    medal: "medal",
    crown: "ribbon",
    heart: "heart",
    flag: "flag",
    figure: "walk",
    "figure.walk": "walk",
    clock: "time",
    key: "key",
    leaf: "leaf",
    book: "book",
    camera: "camera",
    lock: "lock-open",
  };
  if (table[stem]) return table[stem];
  return kind === "relic" ? "diamond" : kind === "codex" ? "albums" : kind === "stamps" ? "ribbon" : "sparkles";
}
