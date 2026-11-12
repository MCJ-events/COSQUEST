// The fight's motion tier (realism round 2, 12 Nov 2026): how much of the motion work this phone
// gets. The same RAM lines as the look tier (features/game/lookTier.ts on the look branch) and the
// landscape flag (features/game/landscape.ts):
//   high  6 GB phones and up (5 GiB reported): motion realism and foot locking
//   mid   4 GB phones (3.3 GiB reported and up): motion realism, no foot locking (until a phone
//         proves its cost)
//   low   everything else, and whenever the memory is not known: build 21's motion, to the frame
// Godot reads the result as the fight config's "motion_realism" and "foot_ik" (game3d/fight.gd). A
// config with neither key is the low tier, so an older app build changes nothing.
// Pure (no react-native) so node tests it.

import { LANDSCAPE_MIN_RAM_BYTES } from "./landscape.ts";

const GIB = 1024 * 1024 * 1024;
/** The 6 GB class: the landscape flag's line. */
export const MOTION_HIGH_MIN_RAM_BYTES = LANDSCAPE_MIN_RAM_BYTES;
/** The 4 GB class: a 4 GB phone reports about 3.6 GiB, a 3 GB one about 2.8. */
export const MOTION_MID_MIN_RAM_BYTES = 3.3 * GIB;

export type MotionTier = "high" | "mid" | "low";

export type MotionTierInput = {
  /** Physical memory the native module reports; 0, null or undefined = not known. */
  physicalMemory: number | null | undefined;
  /** EXPO_PUBLIC_MOTION_TIER: "high", "mid" or "low" for every phone ("0" = low), else the RAM rule. */
  env?: string | null;
};

export type MotionTierDecision = {
  tier: MotionTier;
  reason: "env" | "ram" | "ram-unknown";
  /** The keys to merge into the fight config: none on the low tier. */
  config: { motion_realism?: true; foot_ik?: true };
};

function configFor(tier: MotionTier): MotionTierDecision["config"] {
  if (tier === "high") return { motion_realism: true, foot_ik: true };
  if (tier === "mid") return { motion_realism: true };
  return {};
}

export function motionTierDecision(input: MotionTierInput): MotionTierDecision {
  if (input.env === "high" || input.env === "mid" || input.env === "low") return { tier: input.env, reason: "env", config: configFor(input.env) };
  if (input.env === "0") return { tier: "low", reason: "env", config: {} };
  const ram = input.physicalMemory ?? 0;
  if (!(ram > 0)) return { tier: "low", reason: "ram-unknown", config: {} }; // unknown: the safe side
  const tier: MotionTier = ram >= MOTION_HIGH_MIN_RAM_BYTES ? "high" : ram >= MOTION_MID_MIN_RAM_BYTES ? "mid" : "low";
  return { tier, reason: "ram", config: configFor(tier) };
}
