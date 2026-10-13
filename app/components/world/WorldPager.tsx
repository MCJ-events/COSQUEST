// ==========================================
// SWIPE BETWEEN WORLDS
// ==========================================
// After login the app is two pages side by side: the chat tabs (page 0) and
// the CostQuest game (page 1). Like Snapchat's camera, a swipe from the
// right edge of the chat pulls the game's live map in, and a swipe from the
// game's left edge (or a tap on the chat bubble) puts the chat back.
//
// The rules (where a swipe may start, where it lands, timings) are plain
// functions in features/world/gesture.ts; docs/merged-app-ux.md explains
// every number. This file only wires them to Reanimated and gesture-handler.
//
//   - The swipe only starts in two thin edge strips (and on the handle and
//     the bubble), so it never competes with swipe-to-reply, carousels,
//     maps or text selection anywhere else.
//   - The game stays warm: once mounted it is never unmounted while signed
//     in. Off screen it is paused (no location, Unity paused) and, after a
//     while on the chat, parked (out of the window, so it stops drawing).
import * as Haptics from "expo-haptics";
import { router, useIsFocused } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  AppState,
  BackHandler,
  InteractionManager,
  Keyboard,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCallMinimized } from "@/components/calls/callUi";
import {
  ACTIVATE_OFFSET_X,
  chatLayer,
  crossedCommit,
  edgeZone,
  FAIL_OFFSET_Y,
  gameLayer,
  progressFor,
  settleDuration,
  settleTarget,
  worldSwipeAllowed,
  type WorldPage,
} from "@/features/world/gesture";
import { prewarmDecision, PREWARM_IDLE_DELAY_MS } from "@/features/world/prewarm";
import { factionVeilColor, world } from "@/features/world/worldState";
import { callGame, CostQuestGame, gameInstalled, gamePlayable } from "@/modules/costquest-game/src";
import { useAppSelector } from "@/store/hooks";

import GamePage from "./GamePage";
import SwipeCoachmark from "./SwipeCoachmark";
import { useWorld } from "./useWorld";
import WorldHandle from "./WorldHandle";

/** iOS said memory is short at some point in this run: warm less. */
let memoryWarned = false;

/** Keep the world in the window this long after the chat comes back (ms). */
const PARK_AFTER_MS = 15000;
/** A prewarm keeps the world in the window this long, to build it (ms). */
const WARM_BUILD_MS = 10000;

function openWorldFromHandle() {
  world.openGame(null);
}

function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setVisible(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

/** Dev builds: what the game costs in memory, for docs/merged-app-ux.md. */
function logMemory(label: string) {
  if (!__DEV__) return;
  try {
    const report = CostQuestGame?.memoryReport?.();
    if (report) {
      const mb = (bytes: number) => Math.round(bytes / 1048576);
      console.log(
        `[world] memory ${label}: footprint ${mb(report.footprint)} MB, available ${mb(report.available)} MB, device ${mb(report.physical)} MB`,
      );
    }
  } catch {
    // Measuring is best effort.
  }
}

export default function WorldPager({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const focused = useIsFocused();
  const { page, gameMounted, gameReady, openSerial, closeSerial, factionColor } = useWorld();
  const keyboardVisible = useKeyboardVisible();
  const callActive = useAppSelector((state) => !!state.call.active);
  const chatFaction = useAppSelector((state) => state.auth.user?.faction ?? null);
  const callMinimized = useCallMinimized();
  const callFullscreen = callActive && !callMinimized;

  const progress = useSharedValue(page === "game" ? 1 : 0);
  const dragFrom = useSharedValue<WorldPage>(page);
  const ready = useSharedValue(gameReady ? 1 : 0);

  // A drag or a settle is in flight (the game layer must be live).
  const [moving, setMoving] = useState(false);
  // Keeps the world in the window until then (prewarm, just left it).
  const [awakeUntil, setAwakeUntil] = useState(0);
  const [statusLight, setStatusLight] = useState(page === "game");

  const wake = useCallback((ms: number) => {
    setAwakeUntil(ms > 0 ? Date.now() + ms : 0);
  }, []);

  useEffect(() => {
    if (!awakeUntil) return;
    const timer = setTimeout(() => setAwakeUntil(0), Math.max(0, awakeUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [awakeUntil]);

  const parked = !(page === "game" || moving || awakeUntil > 0);

  // The veil holds until the game says its world is standing.
  useEffect(() => {
    ready.set(withTiming(gameReady ? 1 : 0, { duration: gameReady ? 220 : 0 }));
  }, [gameReady, ready]);

  // ---------- settling ----------

  const onSettled = useCallback(
    (target: WorldPage) => {
      setMoving(false);
      world.settled(target);
      setStatusLight(target === "game");
      if (target === "game") {
        callGame("resume");
        return;
      }
      callGame("pause");
      wake(memoryWarned ? 0 : PARK_AFTER_MS);
      const close = world.takeClose();
      if (close?.chatId) {
        router.push({ pathname: "/chat/[id]", params: { id: close.chatId } });
      }
    },
    [wake],
  );

  const onDragStart = useCallback((from: WorldPage) => {
    setMoving(true);
    if (from === "chat") {
      world.mountGame();
      // Location and the map's refresh start while it slides in.
      callGame("resume");
    }
  }, []);

  const onCrossCommit = useCallback((direction: number) => {
    if (direction > 0) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }, []);

  const animateTo = useCallback(
    (target: WorldPage) => {
      setMoving(true);
      if (target === "game") {
        world.mountGame();
        callGame("resume");
      }
      progress.set(withTiming(
        target === "game" ? 1 : 0,
        {
          duration: settleDuration(progress.get(), target, reduceMotion),
          easing: Easing.out(Easing.cubic),
        },
        (finished) => {
          if (finished) runOnJS(onSettled)(target);
        },
      ));
    },
    [onSettled, progress, reduceMotion],
  );

  // The status bar turns over halfway, not at the end.
  useAnimatedReaction(
    () => progress.get() > 0.5,
    (light, wasLight) => {
      if (wasLight !== null && light !== wasLight) runOnJS(setStatusLight)(light);
    },
  );

  // ---------- requests (Join, links, the bubble, the game) ----------

  useEffect(() => {
    // Wait until the tabs are on top: a Join inside a pushed chat screen
    // first pops back here, then the game slides in.
    if (!focused || !gameInstalled || !world.get().pendingOpen) return;
    // Next frame: lets a pop back to the tabs start first, and keeps the
    // state changes out of the effect body.
    const frame = requestAnimationFrame(() => {
      const request = world.takeOpen();
      if (!request) return;
      if (request.target) callGame("open", request.target);
      animateTo("game");
    });
    return () => cancelAnimationFrame(frame);
  }, [openSerial, focused, animateTo]);

  useEffect(() => {
    if (!world.get().pendingClose) return;
    const frame = requestAnimationFrame(() => animateTo("chat"));
    return () => cancelAnimationFrame(frame);
  }, [closeSerial, animateTo]);

  // Android Back on the game goes back to the chat.
  useEffect(() => {
    if (page !== "game") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      world.openChat(null);
      return true;
    });
    return () => sub.remove();
  }, [page]);

  // ---------- warm game ----------

  useEffect(() => {
    const sub = AppState.addEventListener("memoryWarning", () => {
      memoryWarned = true;
      // The chat is what the person is using: let the world leave the window.
      if (world.get().page === "chat") setAwakeUntil(0);
      logMemory("memory warning");
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!gameInstalled || world.get().gameMounted) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => {
        if (cancelled || world.get().gameMounted) return;
        const decision = prewarmDecision({
          physicalMemory: CostQuestGame?.physicalMemory,
          gameAvailable: gamePlayable,
          hadMemoryWarning: memoryWarned,
        });
        logMemory(`before prewarm (${decision.reason})`);
        if (!decision.prewarm) return;
        callGame("prewarm");
        world.mountGame();
        wake(WARM_BUILD_MS);
        setTimeout(() => logMemory("8 s after prewarm"), 8000);
      }, PREWARM_IDLE_DELAY_MS);
    });
    return () => {
      cancelled = true;
      task.cancel();
      if (timer) clearTimeout(timer);
    };
  }, [wake]);

  // ---------- the gesture ----------

  const allowed =
    focused &&
    worldSwipeAllowed({
      page,
      gameAvailable: gameInstalled,
      keyboardVisible,
      callFullscreen,
      settling: false,
    });

  const makePan = useCallback(
    () =>
      Gesture.Pan()
        .enabled(allowed)
        // From the chat only a leftward drag starts it; from the game, rightward.
        .activeOffsetX(page === "chat" ? [-ACTIVATE_OFFSET_X, 10000] : [-10000, ACTIVATE_OFFSET_X])
        .failOffsetY([-FAIL_OFFSET_Y, FAIL_OFFSET_Y])
        .onStart(() => {
          dragFrom.set(page);
          runOnJS(onDragStart)(page);
        })
        .onUpdate((event) => {
          const next = progressFor(dragFrom.get(), event.translationX, width);
          const crossed = crossedCommit(dragFrom.get(), progress.get(), next);
          if (crossed !== 0) runOnJS(onCrossCommit)(crossed);
          progress.set(next);
        })
        .onEnd((event) => {
          const target = settleTarget({
            from: dragFrom.get(),
            progress: progress.get(),
            velocityX: event.velocityX,
          });
          progress.set(withTiming(
            target === "game" ? 1 : 0,
            {
              duration: settleDuration(progress.get(), target, reduceMotion),
              easing: Easing.out(Easing.cubic),
            },
            (finished) => {
              if (finished) runOnJS(onSettled)(target);
            },
          ));
        }),
    [allowed, page, width, reduceMotion, dragFrom, progress, onDragStart, onCrossCommit, onSettled],
  );

  const edgePan = useMemo(() => makePan(), [makePan]);
  const zone = edgeZone({ page, width, height, topInset: insets.top, bottomInset: insets.bottom });

  // ---------- the layers ----------

  const chatStyle = useAnimatedStyle(() => {
    const layer = chatLayer(progress.get(), width, reduceMotion);
    return {
      transform: [{ translateX: layer.translateX }, { scale: layer.scale }],
      borderRadius: layer.radius,
    };
  });

  const dimStyle = useAnimatedStyle(() => ({
    opacity: chatLayer(progress.get(), width, reduceMotion).dim,
  }));

  const gameStyle = useAnimatedStyle(() => {
    const layer = gameLayer(progress.get(), width, reduceMotion);
    return { transform: [{ translateX: layer.translateX }], opacity: layer.opacity };
  });

  const veilStyle = useAnimatedStyle(() => {
    const layer = gameLayer(progress.get(), width, reduceMotion);
    // Until the world is standing the veil stays (the map fades up out of it).
    return { opacity: Math.max(layer.veil, 1 - ready.get()) };
  });

  const veil = factionColor ?? factionVeilColor(null, chatFaction);

  return (
    <View style={styles.root}>
      <Animated.View
        style={[styles.layer, styles.chatLayer, chatStyle]}
        pointerEvents={page === "chat" ? "auto" : "none"}
        importantForAccessibility={page === "chat" ? "auto" : "no-hide-descendants"}
        accessibilityElementsHidden={page !== "chat"}>
        {children}
        <Animated.View pointerEvents="none" style={[styles.layer, styles.dim, dimStyle]} />
      </Animated.View>

      {gameInstalled ? (
        <Animated.View
          style={[styles.layer, gameStyle]}
          pointerEvents={page === "game" ? "box-none" : "none"}
          importantForAccessibility={page === "game" ? "auto" : "no-hide-descendants"}
          accessibilityElementsHidden={page !== "game"}>
          <GamePage
            mounted={gameMounted}
            parked={parked}
            veilColor={veil}
            veilStyle={veilStyle}
            makePan={makePan}
          />
        </Animated.View>
      ) : null}

      {allowed ? (
        <GestureDetector gesture={edgePan}>
          <View
            collapsable={false}
            style={[styles.strip, { left: zone.x, top: zone.y, width: zone.width, height: zone.height }]}
          />
        </GestureDetector>
      ) : null}

      {gameInstalled ? (
        <WorldHandle
          progress={progress}
          visible={page === "chat" && allowed}
          color={veil}
          makePan={makePan}
          onOpen={openWorldFromHandle}
        />
      ) : null}

      {gameInstalled && focused ? <SwipeCoachmark color={veil} /> : null}

      {focused ? <StatusBar style={statusLight ? "light" : "auto"} animated /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000000",
  },
  layer: {
    ...StyleSheet.absoluteFill,
  },
  chatLayer: {
    overflow: "hidden",
  },
  dim: {
    backgroundColor: "#000000",
  },
  strip: {
    position: "absolute",
    backgroundColor: "transparent",
  },
});
