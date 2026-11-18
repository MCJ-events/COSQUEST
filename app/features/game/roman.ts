// Rank numbers as Roman numerals (Mark, 8 Nov, on Wale's badges: "if the numbers
// stay, make them Roman numerals"). Pure, so node tests it. Screen readers get the
// plain number (rankSpoken): VoiceOver reads "IV" as letters.

const NUMERALS: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

/** 4 -> "IV". Whole numbers 1 to 3999; anything else comes back as plain digits ("0", "?" for none). */
export function toRoman(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "?";
  const v = Math.trunc(n);
  if (v < 1 || v > 3999) return String(v);
  let left = v;
  let out = "";
  for (const [value, glyph] of NUMERALS) {
    while (left >= value) {
      out += glyph;
      left -= value;
    }
  }
  return out;
}

/** "RANK IV OF X" (the RankHub kicker). */
export function rankOf(rank: number | null | undefined, total: number): string {
  return `RANK ${toRoman(rank ?? 1)} OF ${toRoman(total)}`;
}

/** What a screen reader says for a rank: "rank 4 of 10". */
export function rankSpoken(rank: number | null | undefined, total?: number): string {
  return total ? `rank ${rank ?? 1} of ${total}` : `rank ${rank ?? 1}`;
}

/**
 * The metal of each rank's badge, after Wale's set (59323): bronze Initiate, steel
 * Disciple, blue Awakened, gold Elite, red and gold Champion, gunmetal and gold
 * Commander, purple and gold Sovereign, ice Transcendent, crimson Omega, white gold
 * Eternal. `rim` is the frame, `face` the plate inside, `glow` the numeral tab's light.
 */
export type BadgeMetal = { rim: string; rimDark: string; face: string; glow: string };

const METALS: BadgeMetal[] = [
  { rim: "#B07A4A", rimDark: "#5E3A1E", face: "#2A221C", glow: "#F2A35A" }, // I Initiate
  { rim: "#A9B1BA", rimDark: "#4D545C", face: "#22262B", glow: "#7FC8FF" }, // II Disciple
  { rim: "#4F86C9", rimDark: "#1C3558", face: "#132034", glow: "#7FD4FF" }, // III Awakened
  { rim: "#E2B243", rimDark: "#7A5A12", face: "#272219", glow: "#FFD86B" }, // IV Elite
  { rim: "#E2B243", rimDark: "#8E1F1F", face: "#3A1414", glow: "#FFD86B" }, // V Champion
  { rim: "#D9A93C", rimDark: "#3A3D42", face: "#25272B", glow: "#FFD86B" }, // VI Commander
  { rim: "#E2B243", rimDark: "#4B2378", face: "#2B1846", glow: "#C38CFF" }, // VII Sovereign
  { rim: "#CFE3F2", rimDark: "#5C7A92", face: "#18283A", glow: "#8FE3FF" }, // VIII Transcendent
  { rim: "#D9475E", rimDark: "#5A1426", face: "#2E0E1A", glow: "#FF6F8E" }, // IX Omega
  { rim: "#F3DE9A", rimDark: "#B9A16A", face: "#2E2716", glow: "#FFF1B8" }, // X Eternal
];

/** The badge metal for a rank (1 to 10; out of range clamps to the nearest). */
export function badgeMetal(rank: number | null | undefined): BadgeMetal {
  const i = Math.min(METALS.length, Math.max(1, Math.trunc(rank ?? 1) || 1)) - 1;
  return METALS[i];
}
