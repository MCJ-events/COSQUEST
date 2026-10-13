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

/** Android-only helpers on the native module (android/src/.../CostQuestGameModule.kt). */
export type NativeOnly = {
  /** Keep the system back gesture off a strip of the screen edge (dp). */
  setGestureExclusion?(rects: { x: number; y: number; width: number; height: number }[]): Promise<void>;
  nfcAvailable?: boolean;
  uwbAvailable?: boolean;
};

export { GAME_UI };

export const CostQuestGame: CostQuestGameModule | null =
  Platform.OS === "web" ? null : GAME_UI === "rn" ? createRnGame(nativeGame) : nativeGame;

/** The native module's own helpers (null on iOS-native, web, Expo Go). */
export const nativeHelpers: NativeOnly | null = Platform.OS === "android" ? nativeGame : null;

/** Is there a game to swipe into? */
export const gameInstalled = CostQuestGame != null;

/** Is it a playable game (not a placeholder)? */
export const gamePlayable = CostQuestGame != null && CostQuestGame.available !== false;

export type CostQuestGameViewProps = ViewProps & {
  accessibilityLabel?: string;
  /** Off the window but kept warm (the chat has been showing for a while). */
  parked?: boolean;
};

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
