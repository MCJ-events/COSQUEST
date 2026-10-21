// The Godot engine inside the app (cq 061), through @borndotcom/react-native-godot.
// One engine for the whole app (the library has one instance), driven from
// here only, one step at a time:
//
//   openFight(config)  create the instance (or resume a kept one), wait for
//                      the scene tree and its /root/Bridge autoload, hand it
//                      the result callback, start_fight(config)
//   closeFight()       end it: destroy the instance (default), or with
//                      EXPO_PUBLIC_GODOT_KEEP=1 end_fight() and pause it, so
//                      the next fight only resumes it (the two strategies the
//                      memory measurements compare)
//
// Steps run in order on one queue, so a double tap, a close while the engine
// is still loading, or an open right after a close cannot create or destroy
// twice. Godot runs on its own thread: everything touching its API is a
// worklet run there (runOnGodotThread), and its answers come back to the JS
// thread through worklets-core's runOnJS.
//
// The module is required lazily: a build without the native module (the web,
// Android 9 and older) never loads it and the 3D fight is simply not offered.
import type { ComponentType } from "react";
import { Platform } from "react-native";

import { ANDROID_MIN_API, type Fight3DConfig } from "./fight3d";

type GodotModule = {
  createInstance(args: string[]): unknown;
  getInstance(): unknown;
  API(): any;
  pause(): void;
  resume(): void;
  is_paused(): boolean;
  destroyInstance(): void;
};
type GodotLib = {
  RTNGodot: GodotModule;
  runOnGodotThread: <T>(f: () => T) => Promise<T>;
  RTNGodotView: ComponentType<{ style?: unknown; windowName?: string; testID?: string }>;
};
type WorkletsLib = { Worklets: { createRunOnJS: <A extends unknown[], R>(f: (...a: A) => R) => (...a: A) => Promise<R> } };

/**
 * The library installs `RTNGodot` on the global object of both the React
 * runtime and its worklet runtime. Worklets read it as `global.RTNGodot`:
 * worklets-core's babel plugin treats `global` as the runtime's own global
 * (any other free name, `globalThis` included, would be captured from the JS
 * thread when the worklet is created, which for these module-level worklets
 * is before the library is loaded).
 */
type WithGodot = { RTNGodot?: GodotModule };

let lib: GodotLib | null | undefined;
let worklets: WorkletsLib | null = null;

/** The library, when this build and this phone can run it. Never throws. */
export function godotLib(): GodotLib | null {
  if (lib !== undefined) return lib;
  lib = null;
  if (Platform.OS === "web" || (Platform.OS === "android" && Number(Platform.Version) < ANDROID_MIN_API)) return lib;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const l = require("@borndotcom/react-native-godot") as GodotLib;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    worklets = require("react-native-worklets-core") as WorkletsLib;
    if (l?.RTNGodot && typeof l.runOnGodotThread === "function") lib = l;
  } catch (e) {
    console.warn(`[godot] the native module is not in this build: ${(e as Error).message}`);
  }
  return lib;
}

export type EngineState = "none" | "starting" | "running" | "paused" | "stopping";

let state: EngineState = "none";
let queue: Promise<unknown> = Promise.resolve();
/** Bumped by every open and close: a step that sees it move on was overtaken and stops. */
let generation = 0;
let pausedAt = 0;
let listener: ((json: string) => void) | null = null;
let deliverOnJs: ((json: string, gen: number) => Promise<void>) | null = null;
const stateListeners = new Set<(s: EngineState) => void>();

function setState(s: EngineState) {
  state = s;
  if (__DEV__ || process.env.EXPO_PUBLIC_WORLD_TIMING === "1") console.log(`[godot] engine ${s}`);
  stateListeners.forEach((l) => l(s));
}

export function engineState(): EngineState {
  return state;
}
export function onEngineState(l: (s: EngineState) => void): () => void {
  stateListeners.add(l);
  return () => {
    stateListeners.delete(l);
  };
}

function serial<T>(step: () => Promise<T>): Promise<T> {
  const run = queue.then(step, step);
  queue = run.catch(() => undefined);
  return run;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Godot's result callback lands here (on the JS thread). Only the fight that
 * is still open takes it: a "quit" from a fight already closed (end_fight on
 * a kept engine) arrives late and must not end the next one.
 */
function deliver(json: string, gen: number) {
  if (gen === generation) listener?.(json);
}

// ---------- worklets (run on the Godot thread) ----------

function createWorklet(args: string[]): boolean {
  "worklet";
  const G = (global as unknown as WithGodot).RTNGodot;
  if (!G) return false;
  if (G.getInstance()) return true;
  return !!G.createInstance(args);
}

function bridgeReadyWorklet(): boolean {
  "worklet";
  const G = (global as unknown as WithGodot).RTNGodot;
  if (!G || !G.getInstance()) return false;
  const tree = G.API().Engine.get_main_loop();
  if (!tree) return false;
  const root = tree.get_root();
  return !!root && root.has_node("Bridge");
}

function destroyWorklet(): boolean {
  "worklet";
  const G = (global as unknown as WithGodot).RTNGodot;
  if (G && G.getInstance()) G.destroyInstance();
  return true;
}

// ---------- the steps ----------

export class FightOpenError extends Error {}

/**
 * Open a fight: the engine up (created, or resumed when kept), the result
 * callback set, start_fight(config). Resolves once Godot has the fight;
 * `onResult` gets Godot's result JSON (once, on the JS thread). Rejects when
 * the engine cannot start or the Bridge never shows (FightOpenError), or
 * when a close overtook it (a FightOpenError with `cancelled`).
 */
export function openFight(opts: { args: string[]; config: Fight3DConfig; keep: boolean; onResult: (json: string) => void; bridgeTimeoutMs?: number }): Promise<void> {
  const g = godotLib();
  if (!g || !worklets) return Promise.reject(new FightOpenError("Godot is not in this build."));
  const mine = ++generation;
  const run = g.runOnGodotThread;
  listener = opts.onResult;
  if (!deliverOnJs) deliverOnJs = worklets.Worklets.createRunOnJS(deliver);
  const toJs = deliverOnJs;
  const configJson = JSON.stringify(opts.config);
  const args = opts.args;
  const cancelled = () => {
    const e = new FightOpenError("cancelled");
    (e as FightOpenError & { cancelled?: boolean }).cancelled = true;
    return e;
  };
  return serial(async () => {
    if (mine !== generation) throw cancelled();
    if (state === "paused") {
      // A kept engine: resume it. The library re-arms its frame loop on resume,
      // so give the last paused frame time to land first (two loops otherwise).
      const wait = 120 - (Date.now() - pausedAt);
      if (wait > 0) await sleep(wait);
      g.RTNGodot.resume();
      setState("running");
    } else if (state === "none") {
      setState("starting");
      const ok = await run(() => {
        "worklet";
        return createWorklet(args);
      });
      if (!ok) {
        setState("none");
        throw new FightOpenError("Godot would not start (are the game files in this build?).");
      }
    }
    // The scene tree and its autoloads come up on the first frames.
    const until = Date.now() + (opts.bridgeTimeoutMs ?? 30000);
    for (;;) {
      if (mine !== generation) throw cancelled();
      const ready = await run(() => {
        "worklet";
        return bridgeReadyWorklet();
      }).catch(() => false);
      if (ready) break;
      if (Date.now() > until) throw new FightOpenError("The 3D fight did not load (no Bridge in the scene).");
      await sleep(100);
    }
    if (mine !== generation) throw cancelled();
    await run(() => {
      "worklet";
      const bridge = (global as unknown as WithGodot).RTNGodot!.API().Engine.get_main_loop().get_root().get_node("Bridge");
      bridge.set_result_callback((json: string) => {
        void toJs(String(json), mine);
      });
      bridge.start_fight(configJson);
      return true;
    });
    setState("running");
  });
}

/** bridge.get_status() as JSON text, or null while there is no engine or Bridge. */
export function fightStatus(): Promise<string | null> {
  const g = godotLib();
  if (!g || state === "none" || state === "stopping") return Promise.resolve(null);
  return g
    .runOnGodotThread(() => {
      "worklet";
      if (!bridgeReadyWorklet()) return null;
      const s = (global as unknown as WithGodot).RTNGodot!.API().Engine.get_main_loop().get_root().get_node("Bridge").get_status();
      return s == null ? null : String(s);
    })
    .catch(() => null);
}

/**
 * Close the fight: destroy the engine, or (keep) end the fight and pause it.
 * Safe to call at any time, any number of times; an open still loading is
 * cancelled first.
 */
export function closeFight(opts: { keep: boolean }): Promise<void> {
  const g = godotLib();
  ++generation;
  listener = null;
  if (!g) return Promise.resolve();
  const run = g.runOnGodotThread;
  return serial(async () => {
    if (state === "none" || (opts.keep && state === "paused")) return;
    if (opts.keep) {
      await run(() => {
        "worklet";
        if (bridgeReadyWorklet()) (global as unknown as WithGodot).RTNGodot!.API().Engine.get_main_loop().get_root().get_node("Bridge").end_fight();
        return true;
      }).catch(() => false);
      g.RTNGodot.pause();
      pausedAt = Date.now();
      setState("paused");
      return;
    }
    setState("stopping");
    await run(() => {
      "worklet";
      return destroyWorklet();
    }).catch((e) => console.warn(`[godot] destroy: ${String(e)}`));
    setState("none");
  });
}

/** The app went to the background (or the game behind the chat): stop drawing; resume after. */
let heldBy = false;
export function holdForBackground(hold: boolean) {
  const g = godotLib();
  if (!g || state !== "running") {
    heldBy = false;
    return;
  }
  if (hold && !heldBy && !g.RTNGodot.is_paused()) {
    g.RTNGodot.pause();
    heldBy = true;
  } else if (!hold && heldBy) {
    heldBy = false;
    g.RTNGodot.resume();
  }
}
