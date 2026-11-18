// The player's two saved looks, kept on the phone (features/waleui/look.ts has
// the model). Same shape as the game's small prefs (components/game/prefs.ts):
// a module value, a pref behind it, a hook over it. The server has no field
// for a look yet, so nothing is sent anywhere.
import { useSyncExternalStore } from "react";

import { DEFAULT_WARDROBE, type Look, type Wardrobe, parseWardrobe, pickSlot, serializeWardrobe, withActiveLook } from "@/features/waleui/look";
import { getPref, setPref } from "@/utils/prefsStorage";

const PREF = "wale.wardrobe.v1";

let wardrobe: Wardrobe = DEFAULT_WARDROBE;
/** True once a change has been written (the footer's "Look saved"). */
let saved = true;
const listeners = new Set<() => void>();
const notifyAll = () => listeners.forEach((l) => l());

getPref(PREF)
  .then((v) => {
    if (v) {
      wardrobe = parseWardrobe(v);
      notifyAll();
    }
  })
  .catch(() => {});

function commit(next: Wardrobe) {
  wardrobe = next;
  saved = false;
  notifyAll();
  setPref(PREF, serializeWardrobe(next))
    .then((ok) => {
      // Only the newest write may say "saved".
      if (wardrobe === next) {
        saved = ok;
        notifyAll();
      }
    })
    .catch(() => {});
}

export function setLook(look: Look) {
  commit(withActiveLook(wardrobe, look));
}

export function chooseSlot(slot: 0 | 1) {
  commit(pickSlot(wardrobe, slot));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useWardrobe(): Wardrobe {
  return useSyncExternalStore(subscribe, () => wardrobe, () => wardrobe);
}

export function useLookSaved(): boolean {
  return useSyncExternalStore(subscribe, () => saved, () => saved);
}
