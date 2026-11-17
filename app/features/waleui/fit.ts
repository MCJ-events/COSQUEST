// Fitting Wale's one-screen frames to any phone (build 27, his note on build 26: "this circled part is a
// lot of space in the app on iPhone, it does not fit the screen").
//
// His Homepage is a 403 x 575 frame: the room between the status bar and the tab bar on a phone a little
// shorter than an iPhone SE's. Scaled to the phone's width, as build 23 to 26 did, it ends far above the tab
// bar on a tall phone (about 120 pt of empty band on an iPhone 15). The fit:
//   - the frame is scaled to the phone's width (his proportions, every block his size), and the canvas is
//     made as tall as the room between the status bar and the tab bar, so the frame gets `extra` frame px;
//   - on a phone too short for the frame at full width, the frame is scaled to the room's height instead and
//     centred left to right (nothing is cut off and nothing has to scroll);
//   - Home spends `extra` on the middle of his frame (homeStretch): the header, the column under it and the
//     rank badge stay where he put them, ENTER QUEST keeps his 13 px above the bottom, and the hero and the
//     street web grow with the room while the right-hand panel keeps its place beside the hero.
// At his frame's own size `extra` is 0 and every block is exactly where his frame has it.

export type FitInput = {
  /** The room the screen is given (the window, or the measured screen). */
  width: number;
  height: number;
  /** Status bar / notch inset at the top. */
  top: number;
  /** What the bottom of the screen keeps for itself: the floating tab bar and its gap, or the home bar inset. */
  bottom: number;
  frameW: number;
  frameH: number;
};

export type Fit = {
  /** Points per frame px. */
  scale: number;
  /** Frame px added under the frame's own height so the canvas fills the room (0 when the frame is scaled to height). */
  extra: number;
  /** Left offset in points (0 unless the frame is scaled to the height and centred). */
  left: number;
  /** The room in points between the top inset and the bottom reserve. */
  room: number;
};

export function fitFrame({ width, height, top, bottom, frameW, frameH }: FitInput): Fit {
  const room = Math.max(1, height - top - bottom);
  const byWidth = width / frameW;
  if (frameH * byWidth <= room + 0.5) {
    return { scale: byWidth, extra: Math.max(0, room / byWidth - frameH), left: 0, room };
  }
  const scale = room / frameH;
  return { scale, extra: 0, left: Math.max(0, (width - frameW * scale) / 2), room };
}

// ---------- Home (403 x 575) ----------

/** His header band ends here; everything above it stays put. */
export const HOME_TOP = 66;
/** ENTER QUEST's top in his frame. The band between HOME_TOP and here is what grows. */
export const HOME_QUEST_Y = 502;
/** The hero's box in his frame (x, y, w, h) and the widest it may grow before it reaches the right-hand panel (x 256). */
export const HOME_HERO = { x: 97.25, y: 83.25, w: 153, h: 404.5, maxW: 164.5 } as const;
/** His street web behind the hero, and the right-hand panel's vertical centre (it moves with the hero's body). */
export const HOME_WEB = { x: 1, y: 220, w: 254, h: 278 } as const;
export const HOME_RIGHT_CENTRE = 324.5;

export type HomeStretch = {
  /** How much the middle band grows (1 at his frame size). */
  f: number;
  /** Where a frame y in the middle band lands. */
  y: (frameY: number) => number;
  /** The hero's box: same centre, height grown by f, width grown by f up to maxW; the picture sits on its foot. */
  hero: { x: number; y: number; w: number; h: number };
  /** The web's box: grown by f about its bottom-left corner. */
  web: { x: number; y: number; w: number; h: number };
  /** How far the right-hand panel (and its rows, the map and OPEN MAP) moves down. */
  rightDy: number;
  /** ENTER QUEST's top. */
  questY: number;
};

export function homeStretch(extra: number): HomeStretch {
  const e = Math.max(0, extra || 0);
  const span = HOME_QUEST_Y - HOME_TOP;
  const f = (span + e) / span;
  const y = (v: number) => (v <= HOME_TOP ? v : HOME_TOP + (v - HOME_TOP) * f);
  const heroBottom = y(HOME_HERO.y + HOME_HERO.h);
  const heroW = Math.min(HOME_HERO.maxW, HOME_HERO.w * f);
  const heroH = HOME_HERO.h * f;
  const webBottom = y(HOME_WEB.y + HOME_WEB.h);
  return {
    f,
    y,
    hero: { x: HOME_HERO.x + HOME_HERO.w / 2 - heroW / 2, y: heroBottom - heroH, w: heroW, h: heroH },
    web: { x: HOME_WEB.x, y: webBottom - HOME_WEB.h * f, w: HOME_WEB.w * f, h: HOME_WEB.h * f },
    rightDy: y(HOME_RIGHT_CENTRE) - HOME_RIGHT_CENTRE,
    questY: HOME_QUEST_Y + e,
  };
}

// ---------- the pinned bar of his Pro Max sized frames ----------

/**
 * Where a frame's bottom bar (customiser DONE, weapon page TRY, lobby tabs and chat, the Faction button) goes, in
 * points from the top of the screen: right under the rest of the frame when the whole frame fits, else on the home
 * bar inset so it never scrolls off a shorter phone.
 */
export function pinnedBarTop({ screenH, top, bottom, scale, barY, barH }: { screenH: number; top: number; bottom: number; scale: number; barY: number; barH: number }): number {
  return Math.min(screenH - bottom - barH * scale, top + barY * scale);
}
