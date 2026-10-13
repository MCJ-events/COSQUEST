// The Warden speaking in the React Native game: the line for a moment (the
// on-device model's when it is loaded, else the authored one, instantly),
// the speech bubble's state, and text-to-speech (expo-speech).
// costquest-ios Warden/WardenVoice.swift + WardenSpeaker.swift.
import * as Speech from "expo-speech";
import { useSyncExternalStore } from "react";

import { type LineWriter, lineFor, type WardenMoment } from "@/features/game/warden";
import { getPref, setPref } from "@/utils/prefsStorage";

export type Said = { id: number; text: string; moment: string; fromModel: boolean };

let said: Said | null = null;
let serial = 0;
let muted = false;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
/** The on-device model, when one is loaded (features/game/wardenModel). */
let writer: LineWriter | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const MUTE_PREF = "game.warden.muted";
getPref(MUTE_PREF)
  .then((v) => {
    muted = v === "1";
    notify();
  })
  .catch(() => {});

export const wardenVoice = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  get: () => said,
  isMuted: () => muted,

  setWriter(next: LineWriter | null) {
    writer = next;
  },

  setMuted(next: boolean) {
    muted = next;
    setPref(MUTE_PREF, next ? "1" : "0").catch(() => {});
    if (next) Speech.stop().catch(() => {});
    notify();
  },

  /** Say a moment's line. Returns it (the reward screen shows it too). */
  async speak(moment: WardenMoment, holdMs = 6000): Promise<string> {
    const line = await lineFor(moment, writer);
    said = { id: ++serial, text: line.text, moment: moment.kind, fromModel: line.fromModel };
    notify();
    if (!muted) {
      Speech.stop()
        .catch(() => {})
        .finally(() => Speech.speak(line.text, { rate: 1.02, pitch: 0.95 }));
    }
    if (hideTimer) clearTimeout(hideTimer);
    const id = said.id;
    hideTimer = setTimeout(() => {
      if (said?.id === id) {
        said = null;
        notify();
      }
    }, holdMs);
    return line.text;
  },

  quiet() {
    Speech.stop().catch(() => {});
    if (hideTimer) clearTimeout(hideTimer);
    said = null;
    notify();
  },
};

export function useWardenSaid(): Said | null {
  return useSyncExternalStore(wardenVoice.subscribe, wardenVoice.get, wardenVoice.get);
}

export function useWardenMuted(): boolean {
  return useSyncExternalStore(wardenVoice.subscribe, wardenVoice.isMuted, wardenVoice.isMuted);
}
