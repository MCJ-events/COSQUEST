// How every game sheet, card and pop-in moves: one place, so they all open,
// close and arrive alike.
//
// Tight and settled, like a native iOS sheet: a decelerating slide with no
// overshoot (~280 ms in, ~240 ms out). The sheets used to open with
// SlideInDown.springify().damping(20), written for Reanimated 3's spring
// (mass 1, stiffness 100: damping 20 is critically damped). Reanimated 4's
// default spring is mass 4, stiffness 900, so the same damping(20) came out
// at a damping ratio of about 0.17: a big, wobbly bounce on every sheet.
// Timing curves here cannot overshoot whatever the library's defaults.
//
// Pop-ins (the banner, the Run countdown, a result, a blocked stamp) had the
// same fault: ZoomIn.springify().stiffness(440).damping(10) is a damping
// ratio of about 0.12 under Reanimated 4's mass of 4, so they wobbled several
// times before settling. They now grow in on the same decelerating curve as
// the sheets, with a fade, and stop dead at full size.
//
// Reduce Motion: a short fade instead of a slide or a pop.
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

/** A pop-in's length: quick enough for a countdown that ticks every second. */
export const POP_MS = 240;

/**
 * Grows from `from` of its size to full size with a fade, decelerating, never
 * past full size. Build once (module scope) per look: a Keyframe is a builder.
 */
export function popIn(from = 0.6, ms = POP_MS) {
  return new Keyframe({
    0: { opacity: 0, transform: [{ scale: from }] },
    // Visible by 40% of the way, so a fast countdown number reads at once.
    40: { opacity: 1, easing: SHEET_EASE_OUT },
    100: { opacity: 1, transform: [{ scale: 1 }], easing: SHEET_EASE_OUT },
  }).duration(ms);
}

/** Slides in from the right by `dx` points with a fade, decelerating, no overshoot (a new question in a round). */
export function slideInRight(dx = 60, ms = SHEET_OPEN_MS) {
  return new Keyframe({
    0: { opacity: 0, transform: [{ translateX: dx }] },
    100: { opacity: 1, transform: [{ translateX: 0 }], easing: SHEET_EASE_OUT },
  }).duration(ms);
}

/** The usual pop-ins, built once. */
export const POP_IN = popIn(0.6);
/** For big things that should only settle a touch (a result card, a versus panel). */
export const POP_IN_SOFT = popIn(0.92);
/** The banner: from small, as it always has, but no bounce. */
export const POP_IN_BANNER = popIn(0.3, 280);
/** A countdown number: from half size, short, so 3-2-1 stays crisp. */
export const POP_IN_COUNT = popIn(0.5, 220);
export const SLIDE_IN_RIGHT = slideInRight();

/** Any pop-in under Reduce Motion: a short fade. */
export const POP_FADE = FadeIn.duration(FADE_IN_MS);

/** The pop-in to use, or a short fade under Reduce Motion. */
export function usePopIn(pop = POP_IN) {
  const reduce = useReducedMotion();
  return reduce ? POP_FADE : pop;
}

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
