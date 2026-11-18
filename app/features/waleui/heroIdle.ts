// The Home hero idles in place (Wale, team group, 13 Nov: the character "is supposed to be on motionary and kind of
// moving on a spot"). A subtle idle on the hero art: the chest rises and falls (breathing) and the body sways a little
// from foot to foot, both pivoting at the feet so the feet stay planted, at the rhythm of the fight's own idle
// (game3d/combat_animator.gd "breathe": a 3.8 s breath, a 7.4 s weight shift). Low-memory phones (under the motion
// tier's mid line, or memory unknown) and Reduce motion keep the still picture. Pure (no react-native) so node tests it;
// components/waleui/HeroIdle.tsx draws it.

import { MOTION_MID_MIN_RAM_BYTES } from "../game/motionTier.ts";

export const HERO_IDLE = {
  /** One breath (ms) and how much taller the body gets at the top of it (share of its height). */
  breathMs: 3800,
  breathScale: 0.012,
  /** One weight shift, left foot to right and back (ms), and the sway at its widest (degrees about the feet). */
  shiftMs: 7400,
  shiftDeg: 0.6,
};

export type HeroIdleInput = {
  /** Physical memory the native module reports; 0, null or undefined = not known. */
  physicalMemory: number | null | undefined;
  /** The phone's Reduce motion setting. */
  reduceMotion: boolean;
};

/** True when the Home hero idles; false = the still picture. */
export function heroIdleOn(input: HeroIdleInput): boolean {
  if (input.reduceMotion) return false;
  const ram = input.physicalMemory ?? 0;
  return ram >= MOTION_MID_MIN_RAM_BYTES; // unknown memory: still, the safe side (as the motion tier)
}

/** The idle at time t (ms): the body's vertical scale and its sway in degrees, both about the feet. */
export function heroIdleAt(t: number): { scaleY: number; rotateDeg: number } {
  const b = Math.sin((2 * Math.PI * t) / HERO_IDLE.breathMs);
  const s = Math.sin((2 * Math.PI * t) / HERO_IDLE.shiftMs);
  return { scaleY: 1 + HERO_IDLE.breathScale * (0.5 + 0.5 * b), rotateDeg: HERO_IDLE.shiftDeg * s };
}
