// What the Ranks screen reveals when a rank promotion or a weapon lands, and
// when each beat of the reveal plays. Pure (no react-native) so node tests it;
// components/game/RewardReveal.tsx draws it.
import type { Promotion } from "./progression.ts";
import { toRoman } from "./roman.ts";

export type RevealKind = "rank" | "weapon";

export type RevealCard = {
  kind: RevealKind;
  /** The small line above the name: "PROMOTED", "WEAPON UNLOCKED". */
  kicker: string;
  /** The rank or weapon name, the line that pops. */
  title: string;
  /** A quieter line under the name (rank number, weapon tier), or null. */
  detail: string | null;
  /** What VoiceOver / TalkBack says as it lands. */
  announce: string;
  /** A rank card's rank number: the reveal shows its badge (RankBadge) instead of an icon. */
  rank?: number;
};

/** The promotion to show: the highest rank reached (several can land at once), or null when none. */
export function topPromotion(promoted: Promotion[] | null | undefined): Promotion | null {
  let best: Promotion | null = null;
  for (const p of promoted ?? []) {
    if (!p || !p.name) continue;
    if (!best || p.to > best.to) best = p;
  }
  return best;
}

/** The rank card for a promotion list, or null when nobody was promoted. */
export function rankReveal(promoted: Promotion[] | null | undefined): RevealCard | null {
  const p = topPromotion(promoted);
  if (!p) return null;
  // Two ranks can land at once (a claim clears two sets of gates): say how far.
  const start = Math.min(...(promoted ?? []).filter((x) => x && x.name).map((x) => x.from));
  const steps = p.to - start;
  return {
    kind: "rank",
    kicker: "PROMOTED",
    title: p.name,
    detail: steps > 1 ? `Rank ${toRoman(p.to)} · up ${steps} ranks` : `Rank ${toRoman(p.to)}`,
    announce: `Promoted to ${p.name}, rank ${p.to}.`,
    rank: p.to,
  };
}

/** The weapon card after a buy or claim. A repeat buy (already owned) reveals nothing. */
export function weaponReveal(
  weapon: { name: string; tier: number; tier_label?: string | null },
  result: { repeat?: boolean; price_cc?: number | null } = {},
): RevealCard | null {
  if (result.repeat || !weapon.name) return null;
  const tier = weapon.tier_label ? `T${weapon.tier} ${weapon.tier_label}` : `T${weapon.tier}`;
  return {
    kind: "weapon",
    kicker: "WEAPON UNLOCKED",
    title: weapon.name,
    detail: tier,
    announce: `${weapon.name} is yours.`,
  };
}

/** The plain notice that stays after a buy or claim (what the screen said before the reveal). */
export function weaponNotice(weaponName: string, promoted: Promotion[] | null | undefined): string {
  const p = topPromotion(promoted);
  return `${weaponName} is yours.${p ? ` Promoted to ${p.name}!` : ""}`;
}

export type RevealTimeline = {
  /** The card scales and fades in. */
  cardMs: number;
  /** The glow behind the badge blooms, then eases back to a soft halo. */
  glowAt: number;
  glowMs: number;
  /** The badge pops in; the haptic tick lands with it. */
  popAt: number;
  /** The title rises in. */
  titleAt: number;
  /** The shine sweeps across the card once. */
  shineAt: number;
  shineMs: number;
  /** Everything has settled into the static card. */
  doneAt: number;
};

/** The beats of one reveal (about 1.5 s). Reduce Motion: everything is at 0, the final card at once. */
export function revealTimeline(reduceMotion: boolean): RevealTimeline {
  if (reduceMotion) return { cardMs: 0, glowAt: 0, glowMs: 0, popAt: 0, titleAt: 0, shineAt: 0, shineMs: 0, doneAt: 0 };
  return { cardMs: 320, glowAt: 120, glowMs: 900, popAt: 220, titleAt: 380, shineAt: 700, shineMs: 650, doneAt: 1500 };
}
