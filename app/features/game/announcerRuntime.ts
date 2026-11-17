// The Warden announcer wired to the phone: polls the feed with the game's own
// client, keeps the book, and speaks a line with on-device speech when the
// rules allow (announcer.ts maySpeak). announcer.ts is the pure part; this
// file is the glue, so it is not unit tested (as liveRuntime.ts).
//
// Silent unless /v1/roam/me says features.announcer is true; a 404 from the
// feed (the feature switched off since) silences it until /me says so again.
// The map asks once a minute; at a live event (a Room on screen) every 5 s.
import * as Speech from "expo-speech";
import { useSyncExternalStore } from "react";

import { callActive } from "@/components/game/sound";
import { getPref, setPref } from "@/utils/prefsStorage";

import {
  AnnouncerBook,
  type AnnouncerView,
  announcerOn,
  fetchFeed,
  fetchWardenEvent,
  maySpeak,
  maySpeakFightLine,
  pollDelayMs,
  type WardenEvent,
} from "./announcer.ts";
import { gameStore } from "./runtime.ts";

export type AnnouncerState = {
  on: boolean;
  view: AnnouncerView;
  /** The event on screen (a Room) as the Warden runs it, for its rules card. */
  event: WardenEvent | null;
  /** Server minus phone, ms (the rules card's countdown). */
  skewMs: number;
  muted: boolean;
};

const MUTE_KEY = "game.announcer.muted";
const VOICE = { rate: 0.95, pitch: 0.9 };

const book = new AnnouncerBook();
const listeners = new Set<() => void>();
let state: AnnouncerState = { on: false, view: { strip: null, ceremony: null }, event: null, skewMs: 0, muted: false };
let eventId: string | null = null;
let active = false;
let offBy404 = false;
let failures = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let loopSerial = 0;
/** Reasons the voice must keep quiet now (a question, a fight). */
const quiet = new Set<string>();

function set(patch: Partial<AnnouncerState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function refreshView() {
  set({ view: book.view(Date.now(), { eventId }), skewMs: book.skewMs });
}

function enabled(): boolean {
  return announcerOn(gameStore.get().me) && !offBy404;
}

function speakNew() {
  if (state.muted) return;
  const v = book.view(Date.now(), { eventId });
  for (const a of [v.ceremony, v.strip]) {
    if (!a) continue;
    const ctx = { inQuestion: quiet.has("question"), inFight: quiet.has("fight"), muted: state.muted, onCall: callActive(), onScreen: active };
    if (!maySpeak(a, ctx)) continue;
    if (!book.takeSpeech(a.id)) continue;
    Speech.speak(a.line, VOICE);
    return; // one line at a time
  }
}

async function pollOnce(): Promise<void> {
  if (!enabled()) {
    if (state.on) set({ on: false, view: { strip: null, ceremony: null }, event: null });
    return;
  }
  const here = gameStore.get().fix ?? gameStore.get().centre;
  const feed = await fetchFeed(gameStore.client, { since: book.since, lat: here?.lat, lng: here?.lng, eventId });
  if (feed === null) {
    offBy404 = true;
    set({ on: false, view: { strip: null, ceremony: null }, event: null });
    return;
  }
  book.ingest(feed, Date.now());
  book.prune(Date.now());
  if (eventId) {
    const ev = await fetchWardenEvent(gameStore.client, eventId).catch(() => state.event);
    set({ event: ev });
  }
  set({ on: true });
  refreshView();
  speakNew();
}

function schedule(serial: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    if (serial !== loopSerial || !active) return;
    try {
      await pollOnce();
      failures = 0;
    } catch {
      failures += 1;
    }
    if (serial === loopSerial && active) schedule(serial);
  }, pollDelayMs({ liveEvent: eventId !== null, failures }));
}

function restart() {
  loopSerial += 1;
  if (timer) clearTimeout(timer);
  if (ticker) clearInterval(ticker);
  timer = null;
  ticker = null;
  if (!active) return;
  const serial = loopSerial;
  // Ask now, then on the clock; re-read the book every 5 s so lines appear and expire on time.
  void pollOnce()
    .then(() => (failures = 0))
    .catch(() => (failures += 1))
    .finally(() => serial === loopSerial && schedule(serial));
  ticker = setInterval(() => {
    if (!state.on) return;
    refreshView();
    speakNew();
  }, 5000);
}

// /me says the feature is on again: listen again.
let lastOn = false;
gameStore.subscribe(() => {
  const now = announcerOn(gameStore.get().me);
  if (now && !lastOn) {
    offBy404 = false;
    if (active) restart();
  }
  lastOn = now;
});

void getPref(MUTE_KEY).then((v) => set({ muted: v === "1" }));

export const announcer = {
  /** The game page is showing (true) or parked behind the chat (false). */
  setActive(on: boolean) {
    if (on === active) return;
    active = on;
    restart();
  },
  /** A live event (a Room) on screen: its lines too, and every 5 s. Null for the map. */
  setEvent(id: string | null) {
    if (id === eventId) return;
    eventId = id;
    set({ event: null });
    restart();
  },
  /** A question or a fight is on screen: the voice keeps quiet. */
  setQuiet(reason: "question" | "fight", on: boolean) {
    if (on) {
      quiet.add(reason);
      void Speech.stop().catch(() => {});
    } else quiet.delete(reason);
  },
  markShown(id: string) {
    book.markShown(id);
    refreshView();
  },
  /** The venue socket's {"t":"announce_cancel"}: the line goes at once. */
  cancel(id: string) {
    book.cancel(id);
    refreshView();
  },
  async setMuted(muted: boolean) {
    set({ muted });
    if (muted) void Speech.stop().catch(() => {});
    await setPref(MUTE_KEY, muted ? "1" : null);
  },
  /** A 3D fight's own intro or verdict line (setup.warden), said in the fight. */
  sayFightLine(line: string | null | undefined) {
    const ctx = { inQuestion: quiet.has("question"), muted: state.muted, onCall: callActive(), onScreen: true };
    if (!line || !maySpeakFightLine(line, ctx)) return;
    void Speech.stop().catch(() => {});
    Speech.speak(line, VOICE);
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => state,
};

export function useAnnouncer(): AnnouncerState {
  return useSyncExternalStore(announcer.subscribe, announcer.get, announcer.get);
}
