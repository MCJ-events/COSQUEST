// Who holds the screen sideways, and the one place the app rotates (build 21).
// The app is portrait; the open map and the 3D fight ask for landscape here
// (features/game/landscape.ts decides whether this phone gets it at all). The
// screen turns only after the player has seen the "turn your phone" notice
// (components/game/TiltNotice.tsx) and tapped Ready, and it is locked to
// landscape (so it works with the system's rotation lock on). When the last
// holder lets go the app is locked back to portrait.
import * as ScreenOrientation from "expo-screen-orientation";
import { Dimensions } from "react-native";

import { CostQuestGame } from "@/modules/costquest-game/src";
import { getPref, setPref } from "@/utils/prefsStorage";

import { landscapeDecision, type LandscapeDecision } from "./landscape";

const OVERRIDE_KEY = "cq.landscape.override";
let override: "on" | "off" | null = null;
let overrideRead = false;
/** "Stay in portrait" on the notice: this session keeps portrait (both the map and fights). */
let declined = false;
const holders = new Set<string>();
const listeners = new Set<() => void>();

const log = (line: string) => console.log(`[orientation] ${line}`);

/** Reads the tester's switch once (call early; until then the RAM rule applies). */
export async function loadLandscapeOverride(): Promise<void> {
  if (overrideRead) return;
  overrideRead = true;
  const v = await getPref(OVERRIDE_KEY);
  override = v === "on" || v === "off" ? v : null;
}

/** The dev link's switch: "on", "off", or null for the RAM rule. Remembered on the phone. */
export async function setLandscapeOverride(v: "on" | "off" | null): Promise<void> {
  override = v;
  overrideRead = true;
  declined = false;
  await setPref(OVERRIDE_KEY, v);
  listeners.forEach((l) => l());
}

export function landscapeFlag(): LandscapeDecision {
  return landscapeDecision({ physicalMemory: CostQuestGame?.physicalMemory, env: process.env.EXPO_PUBLIC_LANDSCAPE ?? null, override });
}

/** Landscape is on for this phone and the player has not chosen portrait this session. */
export function landscapeWanted(): boolean {
  return landscapeFlag().on && !declined;
}

let accepted = false;
/** Ready on either notice: the map and fights go sideways without asking again this session. */
export function acceptLandscape(): void {
  if (accepted) return;
  accepted = true;
  listeners.forEach((l) => l());
}

export function landscapeAccepted(): boolean {
  return accepted;
}

export function declineLandscape(): void {
  declined = true;
  listeners.forEach((l) => l());
}

export function onLandscapeChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** True while someone holds the screen sideways (the fight skips its own notice then). */
export function landscapeHeld(): boolean {
  return holders.size > 0;
}

/** Turns the screen sideways for `who` ("map", "fight"); resolves once the window is wider than tall (at most 1.5 s). */
export async function holdLandscape(who: string): Promise<void> {
  holders.add(who);
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
  } catch (e) {
    log(`landscape lock failed: ${(e as Error).message}`);
    return;
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 1500) {
    const d = Dimensions.get("window");
    if (d.width > d.height) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  log(`landscape for ${who} after_ms=${Date.now() - t0}`);
}

/** `who` lets go; the last one out puts the app back in portrait. */
export async function releaseLandscape(who: string): Promise<void> {
  if (!holders.delete(who) || holders.size > 0) return;
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  } catch (e) {
    log(`portrait lock failed: ${(e as Error).message}`);
  }
}
