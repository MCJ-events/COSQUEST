// How every game sheet moves: one place, so they all open and close alike.
//
// Tight and settled, like a native iOS sheet: a decelerating slide with no
// overshoot (~280 ms in, ~240 ms out). The sheets used to open with
// SlideInDown.springify().damping(20), written for Reanimated 3's spring
// (mass 1, stiffness 100: damping 20 is critically damped). Reanimated 4's
// default spring is mass 4, stiffness 900, so the same damping(20) came out
// at a damping ratio of about 0.17: a big, wobbly bounce on every sheet.
// Timing curves here cannot overshoot whatever the library's defaults.
//
// Reduce Motion: a short fade instead of a slide.
import { Easing, FadeIn, FadeOut, Keyframe, SlideInDown, SlideOutDown, useReducedMotion } from "react-native-reanimated";

export const SHEET_OPEN_MS = 280;
export const SHEET_CLOSE_MS = 240;
/** Fast start, long soft landing, never past the end (iOS's sheet curve, near enough). */
export const SHEET_EASE_OUT = Easing.bezier(0.2, 0.9, 0.3, 1);
/** Leaving: gathers speed and goes. */
export const SHEET_EASE_IN = Easing.bezier(0.4, 0, 0.9, 0.6);
/** A sheet dragged a little and let go springs home with no bounce (critically damped). */
export const SHEET_SNAP_BACK = { duration: 260, dampingRatio: 1, overshootClamping: true } as const;
/** How far a small card (a point's briefing) rises as it fades in. */
const CARD_RISE = 90;

const FADE_IN_MS = 150;
const FADE_OUT_MS = 120;

const SHEET_IN = SlideInDown.duration(SHEET_OPEN_MS).easing(SHEET_EASE_OUT);
const SHEET_OUT = SlideOutDown.duration(SHEET_CLOSE_MS).easing(SHEET_EASE_IN);
const CARD_IN = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: CARD_RISE }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: SHEET_EASE_OUT },
}).duration(SHEET_OPEN_MS);
const CARD_OUT = new Keyframe({
  0: { opacity: 1, transform: [{ translateY: 0 }] },
  100: { opacity: 0, transform: [{ translateY: CARD_RISE }], easing: SHEET_EASE_IN },
}).duration(SHEET_CLOSE_MS);
const FADE_ENTER = FadeIn.duration(FADE_IN_MS);
const FADE_EXIT = FadeOut.duration(FADE_OUT_MS);

/** A full sheet sliding up from the bottom edge (and back down, when it has an exit of its own). */
export function useSheetMotion() {
  const reduce = useReducedMotion();
  return reduce ? { entering: FADE_ENTER, exiting: FADE_EXIT, reduce } : { entering: SHEET_IN, exiting: SHEET_OUT, reduce };
}

/** A small card that rises a little as it fades in (a point's briefing). */
export function useCardMotion() {
  const reduce = useReducedMotion();
  return reduce ? { entering: FADE_ENTER, exiting: FADE_EXIT } : { entering: CARD_IN, exiting: CARD_OUT };
}
