// The CostQuest game, as the shell sees it.
//
// iOS: the real game (modules/costquest-game/ios). Android: a placeholder
// with the same API until merge task 2. Web and Expo Go: no native module at
// all, so `CostQuestGame` is null and the shell shows the "get the app" page.
import { requireNativeView, requireOptionalNativeModule } from "expo";
import type { ComponentType } from "react";
import { Platform, type ViewProps } from "react-native";

import type { GameTarget } from "@/features/world/deepLink";
import type { GameSharePayload } from "@/features/world/gameInvite";

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
  addListener<K extends keyof GameEvents>(event: K, listener: GameEvents[K]): Subscription;
};

export const CostQuestGame =
  Platform.OS === "web" ? null : requireOptionalNativeModule<CostQuestGameModule>("CostQuestGame");

/** Is there a game to swipe into (even the Android placeholder)? */
export const gameInstalled = CostQuestGame != null;

/** Is it the real game (not the Android placeholder)? */
export const gamePlayable = CostQuestGame != null && CostQuestGame.available !== false;

export type CostQuestGameViewProps = ViewProps & { accessibilityLabel?: string };

export const CostQuestGameView: ComponentType<CostQuestGameViewProps> | null = gameInstalled
  ? requireNativeView<CostQuestGameViewProps>("CostQuestGame")
  : null;

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
