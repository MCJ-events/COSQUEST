// The character the player picked (build 29), kept on the phone like their looks (lookStore.ts) and the game's
// small prefs (components/game/prefs.ts): a module value, a pref behind it, a hook over it. Neither server has a
// field for it (the chat profile's schema is fixed; the game server has no profile prefs), so nothing is sent; the
// fight reads it when it starts (Fight3D.tsx, "hero_pick"). null = no pick: the faction hero.
import { useSyncExternalStore } from "react";

import { parsePick } from "@/features/waleui/characters";
import { getPref, setPref } from "@/utils/prefsStorage";

const PREF = "wale.character.v1";

let pick: string | null = null;
/** True once the player picked in this run: a slow first read never overwrites it. */
let touched = false;
const listeners = new Set<() => void>();
const notifyAll = () => listeners.forEach((l) => l());

getPref(PREF)
  .then((v) => {
    const k = parsePick(v);
    if (!touched && k !== pick) {
      pick = k;
      notifyAll();
    }
  })
  .catch(() => {});

/** The pick right now (the fight reads it once at start). */
export function pickedCharacter(): string | null {
  return pick;
}

/** Pick a character (its key), or null to go back to the faction hero. */
export function setPickedCharacter(key: string | null) {
  const k = key === null ? null : parsePick(key);
  if (key !== null && k === null) return;
  pick = k;
  touched = true;
  notifyAll();
  setPref(PREF, k).catch(() => {});
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function usePickedCharacter(): string | null {
  return useSyncExternalStore(subscribe, () => pick, () => pick);
}
