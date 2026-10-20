// The Warden speaking in the React Native game: the line for a moment (the
// on-device model's when it is loaded, else the authored one, instantly),
// the speech bubble's state, and text-to-speech (expo-speech).
// costquest-ios Warden/WardenVoice.swift + WardenSpeaker.swift.
import * as Speech from "expo-speech";
import { useSyncExternalStore } from "react";

import { fallbackLine, type LineWriter, type WardenMoment } from "@/features/game/warden";
import { getPref, setPref } from "@/utils/prefsStorage";

import { callActive, prepareGameAudio } from "./sound";

export type Said = { id: number; text: string; moment: string; fromModel: boolean };

let said: Said | null = null;
let serial = 0;
let muted = false;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
/** The on-device model, when one is loaded (features/game/wardenModel). */
let writer: LineWriter | null = null;
/** Lines the model has written, by moment (written ahead, as on iOS). */
const written = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();
/** How long a moment waits for the model before the authored line (iOS: 2.5 s). */
const MODEL_WAIT_MS = 2500;
/** Log each line said (dev builds, and test builds with EXPO_PUBLIC_WORLD_TIMING=1). */
const TRACE = __DEV__ || process.env.EXPO_PUBLIC_WORLD_TIMING === "1";

function ask(m: WardenMoment): Promise<string | null> {
  const key = m.key;
  const cached = written.get(key);
  if (cached) return Promise.resolve(cached);
  const running = inFlight.get(key);
  if (running) return running;
  if (!writer) return Promise.resolve(null);
  const job = writer(m)
    .then((text) => {
      if (text) {
        if (written.size > 200) written.clear();
        written.set(key, text);
      }
      return text;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}
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

  /** Start writing a line now so it is ready when wanted (no-op without a model). */
  prepare(moment: WardenMoment) {
    void ask(moment);
  },

  /** Say a moment's line: the model's if it is ready in time, the authored one otherwise. */
  async speak(moment: WardenMoment, holdMs = 6000): Promise<string> {
    const fromModel = writer
      ? await Promise.race([ask(moment), new Promise<null>((r) => setTimeout(() => r(null), MODEL_WAIT_MS))])
      : null;
    const line = fromModel ? { text: fromModel, fromModel: true } : { text: fallbackLine(moment), fromModel: false };
    said = { id: ++serial, text: line.text, moment: moment.kind, fromModel: line.fromModel };
    if (TRACE) console.log(`[warden] ${moment.kind}${line.fromModel ? " (model)" : ""}: ${line.text}`);
    notify();
    // Not over a call, and through the game's own session so the silent
    // switch does not swallow it (GameKit.swift: .playback, call-safe).
    if (!muted && !callActive()) {
      prepareGameAudio();
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

  /** A moment's line without saying it (the point card's legend): the model's if it comes within `waitMs`. */
  async line(moment: WardenMoment, waitMs = 8000): Promise<string> {
    const fromModel = writer ? await Promise.race([ask(moment), new Promise<null>((r) => setTimeout(() => r(null), waitMs))]) : null;
    return fromModel || fallbackLine(moment);
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
