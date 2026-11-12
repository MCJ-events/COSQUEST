// The fight's look tier (realism, 11 Nov 2026): how much of the "real" character look this phone
// gets. Mirrors the landscape flag's RAM rule (features/game/landscape.ts): the same 5 GiB line
// for the high tier. Godot reads it as the fight config's "tier" (game3d/arena.gd TIER_LOOK):
//   high  6 GB phones and up (5 GiB reported): real shading, skin, the street's reflections, real
//         shadows, the grade, the hero and the Guardian at their most detailed, full render scale
//   mid   4 GB phones (3.3 GiB reported and up): real shading with the simple skin term, no post pass
//   low   everything else, and whenever the memory is not known: the look as it was (build 21)
// A config with no "tier" is the low tier in Godot, so an older app build changes nothing.
// Pure (no react-native) so node tests it.

import { LANDSCAPE_MIN_RAM_BYTES } from "./landscape.ts";

const GIB = 1024 * 1024 * 1024;
/** The 6 GB class: the landscape flag's line. */
export const LOOK_HIGH_MIN_RAM_BYTES = LANDSCAPE_MIN_RAM_BYTES;
/** The 4 GB class: a 4 GB phone reports about 3.6 GiB, a 3 GB one about 2.8. */
export const LOOK_MID_MIN_RAM_BYTES = 3.3 * GIB;

export type LookTier = "high" | "mid" | "low";

export type LookTierInput = {
  /** Physical memory the native module reports; 0, null or undefined = not known. */
  physicalMemory: number | null | undefined;
  /** EXPO_PUBLIC_LOOK_TIER: "high", "mid" or "low" for every phone ("0" = low), else the RAM rule. */
  env?: string | null;
};

export type LookTierDecision = { tier: LookTier; reason: "env" | "ram" | "ram-unknown" };

export function lookTierDecision(input: LookTierInput): LookTierDecision {
  if (input.env === "high" || input.env === "mid" || input.env === "low") return { tier: input.env, reason: "env" };
  if (input.env === "0") return { tier: "low", reason: "env" };
  const ram = input.physicalMemory ?? 0;
  if (!(ram > 0)) return { tier: "low", reason: "ram-unknown" }; // unknown: the safe side
  if (ram >= LOOK_HIGH_MIN_RAM_BYTES) return { tier: "high", reason: "ram" };
  return { tier: ram >= LOOK_MID_MIN_RAM_BYTES ? "mid" : "low", reason: "ram" };
}
