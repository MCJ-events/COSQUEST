// The home map's colours by the hour: the town is lit for the time you are
// playing in. costquest-ios Map/TimeOfDay.swift (dawn 5-8, day 8-17, dusk
// 17-20, night) and the Roam board's colours (Map/WorldView.swift
// Palette.meadow worldStyle, meadowDusk, meadowNight), flattened for the 2D
// map: the 3D board's light grade is multiplied into the colours, and a
// building is its roof seen from above with its wall showing below it.
//
// The player can fix the hour (Profile, "Time in town": UI/Preferences.swift
// WorldClock), so nobody has to wait until 8pm to see the town at night.
//
// Pure (features/game/__tests__/mapStyle.test.ts).

export type TimeOfDay = "dawn" | "day" | "dusk" | "night";

/** Preferences.WorldClock: "real" follows the phone's clock. */
export type WorldClock = "real" | "morning" | "noon" | "dusk" | "night";

export const WORLD_CLOCKS: { id: WorldClock; label: string; hour: number | null }[] = [
  { id: "real", label: "Follow the clock", hour: null },
  { id: "morning", label: "Morning", hour: 8 },
  { id: "noon", label: "Midday", hour: 13 },
  { id: "dusk", label: "Dusk", hour: 18.4 },
  { id: "night", label: "Night", hour: 22 },
];

export function isWorldClock(v: unknown): v is WorldClock {
  return WORLD_CLOCKS.some((c) => c.id === v);
}

/** TimeOfDay.now: the hour's bucket. */
export function timeOfDay(hour: number): TimeOfDay {
  const h = Math.floor(((hour % 24) + 24) % 24);
  if (h >= 5 && h < 8) return "dawn";
  if (h >= 8 && h < 17) return "day";
  if (h >= 17 && h < 20) return "dusk";
  return "night";
}

/** Preferences.effectiveHour: the fixed hour, or the phone's. */
export function effectiveHour(clock: WorldClock, now: Date): number {
  const fixed = WORLD_CLOCKS.find((c) => c.id === clock)?.hour ?? null;
  return fixed ?? now.getHours() + now.getMinutes() / 60;
}

export type MapStyle = {
  hour: TimeOfDay;
  land: string;
  grid: string;
  green: string;
  water: string;
  paved: string;
  road: string;
  roadMajor: string;
  path: string;
  casing: string;
  rail: string;
  roof: string;
  roofEdge: string;
  wall: string;
  /** Lit windows after dark (meadowNight.windows); null by day. */
  windows: string | null;
  /** The attribution and other small print over the map. */
  ink: string;
};

type RGB = [number, number, number];

const hex = (n: number): RGB => [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as RGB;
const css = ([r, g, b]: RGB) =>
  `#${[r, g, b]
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
const times = (c: RGB, k: RGB): RGB => [c[0] * k[0], c[1] * k[1], c[2] * k[2]];

/** TimeOfDay.grade: the light's tint, multiplied into every colour on the ground. */
const GRADE: Record<TimeOfDay, RGB> = {
  dawn: [0.94, 0.9, 0.86],
  day: [0.9, 0.9, 0.88],
  dusk: [1.0, 0.95, 0.92],
  night: [0.97, 0.98, 1.0],
};

/** The board's own colours: meadow by day (and dawn), meadowDusk, meadowNight. */
const BOARD: Record<"day" | "dusk" | "night", Record<Exclude<keyof MapStyle, "hour" | "windows" | "ink" | "grid">, number>> = {
  day: {
    land: 0xd2dfae,
    green: 0xa9d67e,
    water: 0x6ec1e4,
    paved: 0xe0d7bf,
    road: 0xfffbf0,
    roadMajor: 0xfff1cf,
    path: 0xf7f0de,
    casing: 0xb9a983,
    rail: 0xc4bdb3,
    roof: 0xefddbe,
    roofEdge: 0xdcc39c,
    wall: 0xc9a77c,
  },
  dusk: {
    land: 0x6a6384,
    green: 0x5e8f63,
    water: 0x4e86bc,
    paved: 0x7b7290,
    road: 0xf4dfc0,
    roadMajor: 0xffd7a1,
    path: 0xd6c4b9,
    casing: 0x463e5e,
    rail: 0x807592,
    roof: 0xedb99b,
    roofEdge: 0xffe2cc,
    wall: 0x675a80,
  },
  night: {
    land: 0x232b47,
    green: 0x2f6152,
    water: 0x2a5f93,
    paved: 0x2f3858,
    road: 0xc7ae7e,
    roadMajor: 0xe3c58e,
    path: 0x8d93bc,
    casing: 0x1b2140,
    rail: 0x59607f,
    roof: 0x6f789f,
    roofEdge: 0xc3ccff,
    wall: 0x303656,
  },
};

/** The map's colours for an hour of the day. */
export function mapStyle(hour: number): MapStyle {
  const t = timeOfDay(hour);
  const board = BOARD[t === "dawn" ? "day" : t];
  const grade = GRADE[t];
  const c = (k: keyof typeof board) => css(times(hex(board[k]), grade));
  const dark = t === "dusk" || t === "night";
  return {
    hour: t,
    land: c("land"),
    grid: css(times(hex(board.land), [0.93, 0.93, 0.93])),
    green: c("green"),
    water: c("water"),
    paved: c("paved"),
    road: c("road"),
    roadMajor: c("roadMajor"),
    path: c("path"),
    casing: c("casing"),
    rail: c("rail"),
    roof: c("roof"),
    roofEdge: c("roofEdge"),
    wall: c("wall"),
    windows: dark ? "#FFD37A" : null,
    ink: dark ? "rgba(255,255,255,0.7)" : "rgba(30,58,76,0.55)",
  };
}
