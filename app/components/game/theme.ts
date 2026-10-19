// The game's look, from costquest-ios UI/GameKit.swift (GamePalette) and
// Roam/RoamStyle.swift, so the React Native game reads as the same game.
import { FONTS } from "@/constants/fonts";

const rgb = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;

export const GP = {
  sky: rgb(0.49, 0.76, 0.89),
  skyDeep: rgb(0.17, 0.6, 0.84),
  grass: rgb(0.49, 0.76, 0.4),
  sun: rgb(0.95, 0.6, 0.18),
  sunDeep: rgb(0.82, 0.47, 0.06),
  navy: rgb(0.12, 0.23, 0.3),
  navyEdge: rgb(0.07, 0.15, 0.2),
  cream: rgb(0.95, 0.97, 0.98),
  berry: rgb(0.85, 0.22, 0.25),
  mint: rgb(0.24, 0.75, 0.54),
  ink: rgb(0.12, 0.23, 0.3),
  ice: rgb(0.78, 0.88, 0.92),
  slate: rgb(0.55, 0.7, 0.77),
  mist: rgb(0.36, 0.48, 0.55),
  track: rgb(0.83, 0.87, 0.89),
  rare: rgb(0.6, 0.38, 0.97),
} as const;

/** The four answer colours: "the blue one" means the same to every player. */
export const CHOICE_COLORS = [rgb(0.16, 0.45, 0.93), rgb(0.93, 0.27, 0.36), rgb(0.96, 0.62, 0.13), rgb(0.2, 0.72, 0.45)];

export function realmColor(realm: string | null | undefined): string {
  switch (realm) {
    case "anime":
      return rgb(1, 0.36, 0.6);
    case "marvel":
      return rgb(0.89, 0.21, 0.21);
    case "dc":
      return rgb(0.16, 0.45, 0.93);
    case "movies":
      return rgb(0.96, 0.62, 0.13);
    case "gaming":
      return rgb(0.2, 0.78, 0.45);
    default:
      return GP.skyDeep;
  }
}

/** Ionicons for the realm marks (the SF Symbols on iOS). */
export function realmIcon(realm: string | null | undefined): "sparkles" | "shield-half" | "flash" | "film" | "game-controller" | "flag" {
  switch (realm) {
    case "anime":
      return "sparkles";
    case "marvel":
      return "shield-half";
    case "dc":
      return "flash";
    case "movies":
      return "film";
    case "gaming":
      return "game-controller";
    default:
      return "flag";
  }
}

export function tierColor(tier: string): string {
  return tier === "epic" ? GP.sun : tier === "rare" ? GP.rare : GP.sky;
}

export function challengeName(kind: string): string {
  switch (kind) {
    case "trivia":
      return "Trivia";
    case "rebus":
      return "Emoji rebus";
    case "sequence":
      return "Sequence";
    case "blitz":
      return "Blitz";
    case "duel":
      return "Guardian Duel";
    default:
      return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}

export function difficultyName(tier: string): string {
  return tier === "epic" ? "Hard" : tier === "rare" ? "Medium" : tier === "starter" ? "Easy" : "Normal";
}

/**
 * A darker edge for the chunky game buttons (GamePalette.edge(of:)):
 * the same hue, saturation x1.1, brightness x0.68 (HSB).
 * `by` scales the brightness instead (the older flat edges).
 */
export function edgeOf(hex: string, by = 0.68): string {
  const n = parseInt(hex.slice(1, 7), 16);
  if (!Number.isFinite(n)) return hex;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const s = max === 0 ? 0 : Math.min(1, (d / max) * 1.1);
  const v = max * by;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [R, G, B] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][((i % 6) + 6) % 6];
  return `#${[R, G, B].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The game's type (GameKit.swift GameFont, loaded from ./fonts.ts):
 * display = Lilita One, the rest Fredoka by weight. `app*` are the chat
 * app's Poppins, for the few places the game shows the app's own words.
 */
export const GF = {
  display: "CQ-LilitaOne",
  bold: "CQ-Fredoka-Bold",
  body: "CQ-Fredoka-SemiBold",
  regular: "CQ-Fredoka-Medium",
  appBold: FONTS.bold,
  appRegular: FONTS.regular,
} as const;
