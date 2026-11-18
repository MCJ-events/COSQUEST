// Landscape for fights and the open map, with a "turn your phone" notice first (9 Nov
// meeting; Subomi 11 Nov: the map too). Behind a flag: on by default only for phones with
// 6 GB of RAM or more. Landscape lagged and crashed on Spark-class (3-4 GB) phones, so they
// stay in portrait. Pure (no react-native) so node tests it; components/game/TiltNotice.tsx
// and features/game/orientation.ts act on it.

const GIB = 1024 * 1024 * 1024;
/**
 * The 6 GB class. iOS and Android report less than the label (a 6 GB iPhone says about
 * 5.5 GiB, Sammy's 4 GB iPhone 13 said 3.6), so the line sits between the two classes.
 */
export const LANDSCAPE_MIN_RAM_BYTES = 5 * GIB;

export type LandscapeInput = {
  /** Physical memory the native module reports; 0, null or undefined = not known. */
  physicalMemory: number | null | undefined;
  /** EXPO_PUBLIC_LANDSCAPE: "1" on for every phone, "0" off for every phone, else the RAM rule. */
  env?: string | null;
  /** A tester's switch (the dev link cosquest://dev/landscape?on=1|0|auto), over everything. */
  override?: "on" | "off" | null;
};

export type LandscapeDecision = { on: boolean; reason: "override" | "env" | "ram" | "low-ram" | "ram-unknown" };

export function landscapeDecision(input: LandscapeInput): LandscapeDecision {
  if (input.override === "on" || input.override === "off") return { on: input.override === "on", reason: "override" };
  if (input.env === "1" || input.env === "0") return { on: input.env === "1", reason: "env" };
  const ram = input.physicalMemory ?? 0;
  if (!(ram > 0)) return { on: false, reason: "ram-unknown" }; // unknown: the safe side
  return ram >= LANDSCAPE_MIN_RAM_BYTES ? { on: true, reason: "ram" } : { on: false, reason: "low-ram" };
}

// ---- the fight HUD in landscape (Godot game3d: hud.gd, fight.gd "landscape")

/** The HUD's design size turned sideways: 1280 x 720 HUD px (portrait is 720 x 1280). */
export const HUD_LAND_W = 1280;
export const HUD_LAND_H = 720;

/**
 * The fight HUD's safe area in landscape, in HUD px: `side` [left, right] moves the stick and the
 * attack panel in from the notch / Dynamic Island and the home bar, `top` the top block down
 * (iOS shows no status bar in landscape, so usually 0). Width and height in points, landscape.
 */
export function hudLandscape(insets: { top: number; left: number; right: number }, width: number, height: number): { side: [number, number]; top: number; closeLeft: number } {
  const w = Math.max(width, height);
  const h = Math.min(width, height);
  if (!(w > 0) || !(h > 0)) return { side: [0, 0], top: 0, closeLeft: 14 };
  const k = Math.max(HUD_LAND_W / w, HUD_LAND_H / h); // HUD px per point
  const px = (pt: number) => Math.round(Math.max(0, pt) * k);
  return { side: [px(insets.left), px(insets.right)], top: Math.max(0, px(insets.top) - 20), closeLeft: Math.round(Math.max(0, insets.left)) + 10 };
}

/** The view's size in pixels with the long side across (the fight waits for its window to be this). */
export function landscapePx(width: number, height: number, ratio: number): [number, number] {
  return [Math.round(Math.max(width, height) * ratio), Math.round(Math.min(width, height) * ratio)];
}
