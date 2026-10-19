// The CostQuest game, as the shell sees it.
//
// Two games behind one API, chosen by the gameUi flag (features/game/config.ts):
//   native  iOS: the costquest-ios SwiftUI game in modules/costquest-game/ios
//   rn      the shared React Native game (components/game), implemented in
//           TypeScript by ./rnGame.ts. Android always; iOS with
//           EXPO_PUBLIC_GAME_UI=rn until it is checked on a Mac.
// Web: no game (the shell shows the "get the app" page).
import { requireNativeView, requireOptionalNativeModule } from "expo";
import type { ComponentType } from "react";
import { Platform, type ViewProps } from "react-native";

import { GAME_UI } from "@/features/game/runtime";
import type { GameTarget } from "@/features/world/deepLink";
import type { GameSharePayload } from "@/features/world/gameInvite";

import { createRnGame } from "./rnGame";

export type GameChatPreview = { chatId: string; title: string; text: string };

export type GameCallPillState = {
  title: string;
  video: boolean;
  /** Epoch ms the call was answered; absent while it rings. */
  answeredAt?: number | null;
};

export type GameEvents = {
  /** The game's world is standing (once per app run). */
  onReady: (event: { playerKey?: string | null }) => void;
  /** One login worked: the account's player is in. */
  onSession: (event: {
    playerKey: string;
    created: boolean;
    handle?: string | null;
    faction?: string | null;
  }) => void;
  /** The game's "invite to a chat" action. */
  onShareToChat: (event: GameSharePayload) => void;
  /** The game wants the chat back (optionally one conversation). */
  onRequestChat: (event: { chatId?: string | null }) => void;
  onError: (event: { code: string; message?: string }) => void;
};

type Subscription = { remove: () => void };

export type CostQuestGameModule = {
  /** False on the Android placeholder. */
  available?: boolean;
  /** False in the simulator / no-Unity build: no fights, no event maps. */
  hasUnity?: boolean;
  /** Bytes of RAM, for the prewarm policy (iOS). */
  physicalMemory?: number;
  prewarm(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  open(target: GameTarget): Promise<void>;
  setSession(token: string | null): Promise<void>;
  setUnread(count: number, previews: GameChatPreview[]): Promise<void>;
  setCallPill(state: GameCallPillState | null): Promise<void>;
  handleURL(url: string): Promise<void>;
  reset(): Promise<void>;
  /** iOS: bytes used now (phys_footprint) and still available, for measuring the prewarm. */
  memoryReport?(): { physical: number; footprint: number; available: number };
  addListener<K extends keyof GameEvents>(event: K, listener: GameEvents[K]): Subscription;
};

/** The platform's module: the iOS game, or the Android helpers (RAM, Unity, gestures, NFC, speech). */
const nativeGame =
  Platform.OS === "web" ? null : requireOptionalNativeModule<CostQuestGameModule & NativeOnly>("CostQuestGame");

/**
 * The platform helpers on the native module: the same names on both platforms
 * (android/src/.../CostQuestGameModule.kt, ios/Embed/GameHelpers.swift), so
 * the shared screens call one interface. Optional: an older native build, or
 * a platform without the feature, simply lacks the function.
 */
export type NativeOnly = {
  /** Keep the system back gesture off a strip of the screen edge (dp). */
  setGestureExclusion?(rects: { x: number; y: number; width: number; height: number }[]): Promise<void>;
  nfcAvailable?: boolean;
  uwbAvailable?: boolean;
  /** One spoken utterance (SpeechListener.kt); results arrive as onSpeechResult / onSpeechError. */
  startListening?(options: { prompt?: string; locale?: string; choices?: string[]; onDeviceOnly?: boolean }): Promise<{ onDevice: boolean }>;
  stopListening?(): Promise<void>;
  /** Stops and drops the utterance: no event follows. */
  cancelListening?(): Promise<void>;
  /** iOS: CMPedometer can report walking distance (GameHelpers.swift). */
  pedometerAvailable?: boolean;
  /**
   * iOS: walking distance and steps since `fromMs` (CMPedometer keeps a week of history).
   * `ask`: may show the Motion & Fitness prompt. Android has readStepCounter instead.
   */
  queryPedometer?(query: { fromMs: number; toMs?: number; ask: boolean }): Promise<{
    status: "ok" | "unavailable" | "denied" | "notDetermined" | "error";
    meters: number;
    steps: number;
  }>;
  /** NFC checkpoint tags (NfcReader.kt / GameHelpers.swift NfcHelper); a tag arrives as onNfcTag. */
  startNfcScan?(): Promise<void>;
  stopNfcScan?(): Promise<void>;
  /** The phone has a hardware step counter (StepCounter.kt). */
  stepCounterAvailable?: boolean;
  /** One read of the step counter: steps since boot, with the clocks it was read at. */
  readStepCounter?(): Promise<{ steps: number | null; elapsedRealtimeMs: number; wallClockMs: number; available: boolean }>;
  addListener?(event: "onSpeechResult", listener: (e: { text: string; final: boolean }) => void): Subscription;
  addListener?(event: "onSpeechError", listener: (e: { code: string; message: string }) => void): Subscription;
  addListener?(event: "onNfcTag", listener: (e: { id: string; ndefText?: string | null }) => void): Subscription;
  /** iOS: the NFC sheet closed without a tag (cancelled, timed out, not entitled). Android's reader never ends by itself. */
  addListener?(event: "onNfcEnd", listener: (e: { code: string; message: string }) => void): Subscription;

  // Unity (fights). Only does something when `hasUnity` is true: a device
  // build with UnityFramework (iOS) or a unityAndroid build (Android).
  /** DuelBridge.StartDuel(setupJson): boots Unity if needed, then starts the fight. Rejects ERR_NO_UNITY / ERR_UNITY_START. */
  unityStartDuel?(setupJson: string): Promise<void>;
  /** DuelBridge.DemoDuel: an offline practice fight. */
  unityDemoDuel?(): Promise<void>;
  /** DuelBridge.Quit. Unity stays loaded (it cannot be restarted). */
  unityQuit?(): Promise<void>;
  /** Any other bridge message (WorldRoot, HubBridge, BattleBridge; FRAMEWORK_PIN.md). */
  unitySend?(gameObject: string, method: string, message?: string | null): Promise<void>;
  unityPause?(paused: boolean): Promise<void>;
  /**
   * Unity to the app: scene "duel" | "battle" | "hub" | "world"; kind "ready" | "sfx" | "finished" | "quit"
   * (world: "anchorTapped" | "checkpointTapped" | "ready"). A duel's "finished" json is
   * {"result": ..., "inputs": [[tick, code(, arg)]], "hash": ...}, what POST /v1/duel/finish takes.
   */
  addListener?(event: "onUnityEvent", listener: (e: UnityEvent) => void): Subscription;
};

export type UnityEvent = { scene: "duel" | "battle" | "hub" | "world" | string; kind: string; json: string };

export { GAME_UI };

export const CostQuestGame: CostQuestGameModule | null =
  Platform.OS === "web" ? null : GAME_UI === "rn" ? createRnGame(nativeGame) : nativeGame;

/** The native module's own helpers (null on web and Expo Go). */
export const nativeHelpers: NativeOnly | null = Platform.OS === "web" ? null : nativeGame;

/** Is there a game to swipe into? */
export const gameInstalled = CostQuestGame != null;

/** Is it a playable game (not a placeholder)? */
export const gamePlayable = CostQuestGame != null && CostQuestGame.available !== false;

export type CostQuestGameViewProps = ViewProps & {
  accessibilityLabel?: string;
  /** Off the window but kept warm (the chat has been showing for a while). */
  parked?: boolean;
};

export type CostQuestUnityViewProps = ViewProps & {
  /** Unity keeps running under the view unless paused (the fight is paused while the app is away). */
  paused?: boolean;
  accessibilityLabel?: string;
};

/**
 * Unity's view, where it draws a fight (iOS: UnityBridge's view adopted by
 * ios/Embed/UnityIsland.swift; Android: CostQuestUnityView.kt). Null where
 * there is no Unity in the build: draw the 2D fight instead.
 */
export const CostQuestUnityView: ComponentType<CostQuestUnityViewProps> | null =
  nativeGame?.hasUnity === true ? requireNativeView<CostQuestUnityViewProps>("CostQuestGame", "CostQuestUnityView") : null;

export type CostQuestModelViewProps = ViewProps & {
  /** A downloaded .glb or .usdz on this phone (file:// URI). */
  uri: string;
  /** The weapon's colour (#RRGGBB), for parts without their own. */
  tint?: string;
  /** Turn slowly by itself (off under Reduce Motion). */
  spin?: boolean;
  accessibilityLabel?: string;
};

/**
 * iOS only: a Forge model turning on a small stage (RealityKit, Game/Net/GLBMesh
 * for .glb), the native game's ForgeModelView. Null elsewhere: draw the 2D art.
 */
export const CostQuestModelView: ComponentType<CostQuestModelViewProps> | null =
  Platform.OS === "ios" && nativeGame && (nativeGame as { modelViewAvailable?: boolean }).modelViewAvailable === true
    ? requireNativeView<CostQuestModelViewProps>("CostQuestGame", "CostQuestModelView")
    : null;

/** The native game's view (iOS native UI only; the RN game is components/game/GameRoot). */
export const CostQuestGameView: ComponentType<CostQuestGameViewProps> | null =
  GAME_UI === "native" && nativeGame ? requireNativeView<CostQuestGameViewProps>("CostQuestGame") : null;

/** Fire and forget: a game call never throws into the shell. */
export function callGame<K extends keyof CostQuestGameModule>(
  name: K,
  ...args: CostQuestGameModule[K] extends (...a: infer A) => unknown ? A : never
) {
  const fn = CostQuestGame?.[name];
  if (typeof fn !== "function") return;
  try {
    const result = (fn as (...a: unknown[]) => unknown).apply(CostQuestGame, args);
    if (result && typeof (result as Promise<unknown>).catch === "function") {
      (result as Promise<unknown>).catch((error) => console.warn(`[game] ${String(name)} failed`, error));
    }
  } catch (error) {
    console.warn(`[game] ${String(name)} failed`, error);
  }
}
