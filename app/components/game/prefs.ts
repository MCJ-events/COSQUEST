// The player's choices about the game itself, kept on the phone (costquest-ios
// UI/Preferences.swift: `haptics`). Never sent to a server.
//
// Others honour the haptics choice by reading `hapticsOn()` before an impact,
// or by calling `impact` / `notify` / `selection` here, which do it for them:
//
//   import { hapticsOn } from "./prefs";
//   if (hapticsOn()) Haptics.impactAsync(...);
//
// The value is loaded once at start-up (on by default until it has been read,
// as on iOS, where UserDefaults answers at once).
import * as Haptics from "expo-haptics";
import { useSyncExternalStore } from "react";

import { getPref, setPref } from "@/utils/prefsStorage";

const HAPTICS_PREF = "game.haptics";

let haptics = true;
const listeners = new Set<() => void>();
const notifyAll = () => listeners.forEach((l) => l());

getPref(HAPTICS_PREF)
  .then((v) => {
    if (v === "0" || v === "1") {
      haptics = v === "1";
      notifyAll();
    }
  })
  .catch(() => {});

/** Whether the player wants the phone to buzz. */
export function hapticsOn(): boolean {
  return haptics;
}

export function setHapticsOn(next: boolean) {
  haptics = next;
  setPref(HAPTICS_PREF, next ? "1" : "0").catch(() => {});
  notifyAll();
}

export function useHapticsOn(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    hapticsOn,
    hapticsOn,
  );
}

/** UIImpactFeedbackGenerator(style).impactOccurred(), unless haptics are off. */
export function impact(style: Haptics.ImpactFeedbackStyle) {
  if (haptics) Haptics.impactAsync(style).catch(() => {});
}

/** UINotificationFeedbackGenerator().notificationOccurred(type), unless haptics are off. */
export function notify(type: Haptics.NotificationFeedbackType) {
  if (haptics) Haptics.notificationAsync(type).catch(() => {});
}

/** UISelectionFeedbackGenerator().selectionChanged(), unless haptics are off. */
export function selection() {
  if (haptics) Haptics.selectionAsync().catch(() => {});
}
