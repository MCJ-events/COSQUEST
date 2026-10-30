// The 3D fight (cq 061, "Godot G0"): Godot draws the fight full screen inside
// the app (RTNGodotView), with a small close button over it and a loading
// card until Godot says the fight is on. The engine itself is
// features/game3d/engine.ts; the rules (config, result, reward) fight3d.ts.
//
//   <Fight3D point mode onResult onClose />   one fight
//   <Fight3DHost point run onResult onClose /> one fight, or the leak test:
//        run.cycle = N opens and closes it N times, run.cycleMs apart,
//        logging "CQCYCLE i=<n> ..." lines (adb logcat -s ReactNativeJS)
//
// Closing (X, Android Back, the result, leaving the screen) always goes
// through closeFight, which is safe while loading and safe twice.
// testIDs: fight3d-view, fight3d-close, fight3d-loading, fight3d-error.
import { Ionicons } from "@expo/vector-icons";
import { Paths } from "expo-file-system";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, BackHandler, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { castWeapons, fightCast } from "@/features/game3d/characters";
import { closeFight, fightStatus, FightOpenError, godotLib, holdForBackground, onFightState, openFight } from "@/features/game3d/engine";
import { buildFightConfig, type Fight3DMode, type Fight3DResult, type Fight3DRun, godotArgs, parseFightResult, quitResult } from "@/features/game3d/fight3d";
import { FIGHT3D } from "@/features/game3d/flags";
import { useAppSelector } from "@/store/hooks";
import type { QuestPoint } from "@/features/game/wire";

import { GameButton, MAX_FONT_SCALE } from "./kit";
import { GF, GP } from "./theme";

type Phase = { kind: "loading"; step: string } | { kind: "fighting" } | { kind: "closing" } | { kind: "failed"; message: string };

const log = (line: string) => console.log(`[fight3d] ${line}`);

export default function Fight3D({
  point,
  mode,
  autoplay,
  enemyId,
  parked = false,
  autoCloseMs,
  onFighting,
  onResult,
  onClose,
}: {
  /** The point fought at: its name on the HUD and its Guardian. Null for a test run. */
  point: QuestPoint | null;
  mode: Fight3DMode;
  autoplay: boolean;
  /** The opponent character a duel start named (else the server's pick for the point). */
  enemyId?: string | null;
  /** The game is behind the chat: Godot stops drawing. */
  parked?: boolean;
  /** The leak test: close by itself this long after the fight is on. */
  autoCloseMs?: number;
  onFighting?: () => void;
  /** Godot's verdict. The engine is already closed. */
  onResult: (r: Fight3DResult) => void;
  /** Closed without a verdict (X, Back, a failure, the leak test). The engine is already closed. */
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>({ kind: "loading", step: "Getting the fighters ready" });
  const phaseRef = useRef(phase);
  const done = useRef(false);
  // The app's Reduce motion setting (cq 013): read when the fight opens (a ref, so a change never reopens it).
  const reduceMotionSetting = useAppSelector((state) => Boolean(state.settings.appearance?.reduceMotion));
  const reduceMotion = useRef(reduceMotionSetting);
  reduceMotion.current = reduceMotionSetting;
  const openedAt = useRef(Date.now());
  const go = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);
  const View3D = godotLib()?.RTNGodotView ?? null;

  /** The one way out: the engine closed first, then the parent told once. */
  const finish = useCallback(
    (result: Fight3DResult | null) => {
      if (done.current) return;
      done.current = true;
      go({ kind: "closing" });
      log(`close outcome=${result?.outcome ?? "none"} after_ms=${Date.now() - openedAt.current}`);
      void closeFight({ keep: FIGHT3D.keep }).then(() => {
        if (result) onResult(result);
        else onClose();
      });
    },
    [go, onClose, onResult],
  );
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // Open on mount: the cast's files, the engine, the fight. Closed on unmount whatever happened.
  useEffect(() => {
    let alive = true;
    openedAt.current = Date.now();
    void (async () => {
      try {
        const role = point?.source === "raid" ? "boss" : "guardian";
        // No point (the test link's Test arena): a fixed key, so the opponent is a published Guardian, not the capsule.
        const cast = await fightCast({ pointId: point?.id ?? "test-arena", role, enemyId, enemyName: point?.extra?.guardian ?? null, lodOverride: FIGHT3D.lod });
        if (!alive || done.current) return;
        log(`cast lod=${cast.lod} hero_id=${cast.hero.id ?? "-"} hero=${cast.hero.path ? "glb" : "-"} ally=${cast.ally.path ? "glb" : "-"} enemy=${cast.enemy.path ? "glb" : "-"} after_ms=${Date.now() - openedAt.current}`);
        go({ kind: "loading", step: "Opening the arena" });
        const config = buildFightConfig({
          hero: cast.hero,
          ally: cast.ally,
          enemy: cast.enemy,
          pointName: point?.name ?? "Test arena",
          mode,
          seed: Math.floor(Math.random() * 2147483647),
          autoplay,
          tilesUrl: FIGHT3D.tilesUrl || null,
          reduceMotion: reduceMotion.current,
        });
        // Weapons in hand (cq 234): the cast's weapons, as files, with their grips.
        const weapons = await castWeapons(cast);
        Object.assign(config, weapons);
        log(`weapons ${Object.keys(weapons).join(",") || "-"}`);
        // Leak probe (test link selfcycle=N): Godot restarts the fight N times in this one view.
        const probe = FIGHT3D as { selfCycle?: number; look?: Record<string, boolean> | null };
        if (probe.selfCycle) Object.assign(config, { self_cycle: probe.selfCycle, self_cycle_ms: 6000 });
        // Look switches (test link look=post etc.): the opt-in post stack on a device.
        if (probe.look) Object.assign(config, { look: probe.look });
        await openFight({
          args: godotArgs(Platform.OS, { bundleDir: Platform.OS === "ios" ? Paths.bundle.uri : null }),
          config,
          keep: FIGHT3D.keep,
          onResult: (json) => {
            const r = parseFightResult(json);
            log(`result ${r ? r.outcome : `unreadable: ${String(json).slice(0, 120)}`}`);
            finishRef.current(r ?? quitResult(mode, (Date.now() - openedAt.current) / 1000));
          },
        });
        if (!alive || done.current) return;
        log(`started mode=${mode} after_ms=${Date.now() - openedAt.current}`);
      } catch (e) {
        if (!alive || done.current) return;
        if (e instanceof FightOpenError && (e as FightOpenError & { cancelled?: boolean }).cancelled) return;
        log(`failed: ${(e as Error).message}`);
        go({ kind: "failed", message: (e as Error).message || "The 3D fight could not start." });
        void closeFight({ keep: FIGHT3D.keep });
      }
    })();
    return () => {
      alive = false;
      if (!done.current) {
        done.current = true;
        void closeFight({ keep: FIGHT3D.keep });
      }
    };
    // One fight per mount: the props are read once.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The loading card stays until Godot says the fight is on (its state push).
  useEffect(() => {
    if (phase.kind !== "loading") return;
    let alive = true;
    onFightState((st) => {
      if (!alive || phaseRef.current.kind !== "loading" || st !== "fighting") return;
      log(`fighting after_ms=${Date.now() - openedAt.current}`);
      go({ kind: "fighting" });
      onFighting?.();
      // Leak probe (test link statusspam=N): N bridge calls in a row, nothing else.
      const spam = (FIGHT3D as { statusSpam?: number }).statusSpam ?? 0;
      if (spam > 0) {
        void (async () => {
          log(`statusspam start n=${spam}`);
          for (let k = 0; k < spam; k++) await fightStatus();
          log(`statusspam done n=${spam}`);
        })();
      }
    });
    return () => {
      alive = false;
    };
  }, [phase.kind, go, onFighting]);

  // The leak test closes it by itself.
  useEffect(() => {
    if (phase.kind !== "fighting" || !autoCloseMs) return;
    const t = setTimeout(() => finishRef.current(null), autoCloseMs);
    return () => clearTimeout(t);
  }, [phase.kind, autoCloseMs]);

  // Android Back closes the fight (as the X does).
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      finishRef.current(null);
      return true;
    });
    return () => sub.remove();
  }, []);

  // Not drawn while the app is in the background or the game is behind the chat.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => holdForBackground(s !== "active"));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    holdForBackground(parked);
  }, [parked]);

  return (
    <View style={styles.root}>
      <StatusBar hidden animated />
      {View3D ? <View3D style={StyleSheet.absoluteFill} testID="fight3d-view" /> : null}

      {phase.kind === "loading" || phase.kind === "closing" ? (
        <View style={styles.cover} testID="fight3d-loading" accessible accessibilityLabel={phase.kind === "loading" ? phase.step : "Closing"}>
          <ActivityIndicator color="#FFF" size="large" />
          <Text style={styles.coverText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {phase.kind === "loading" ? `${phase.step}…` : "Closing…"}
          </Text>
          {point ? (
            <Text style={styles.coverSub} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {point.name}
            </Text>
          ) : null}
        </View>
      ) : null}

      {phase.kind === "failed" ? (
        <View style={styles.cover} testID="fight3d-error">
          <Text style={styles.coverText} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite">
            {phase.message}
          </Text>
          <GameButton title="Back" color={GP.sun} onPress={onClose} testID="fight3d-error-back" style={{ alignSelf: "stretch" }} />
        </View>
      ) : null}

      <Pressable
        onPress={() => (phase.kind === "failed" ? onClose() : finish(null))}
        style={[styles.close, { top: insets.top + 10 }]}
        hitSlop={10}
        testID="fight3d-close"
        accessibilityRole="button"
        accessibilityLabel="Close the 3D fight">
        <Ionicons name="close" size={22} color="#FFF" />
      </Pressable>
    </View>
  );
}

/**
 * One 3D fight, or the leak test (run.cycle > 0): open, wait for the fight,
 * hold it run.cycleMs, close, wait run.cycleMs, again, N times. Each step is
 * logged as "CQCYCLE i=<n> <what> t=<ms since the test began>".
 */
export function Fight3DHost({
  point,
  run,
  parked,
  enemyId,
  onResult,
  onClose,
}: {
  point: QuestPoint | null;
  run: Fight3DRun;
  parked?: boolean;
  enemyId?: string | null;
  onResult: (r: Fight3DResult) => void;
  onClose: () => void;
}) {
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(true);
  const began = useRef(Date.now());
  const cycling = run.cycle > 0;
  const say = useCallback((what: string) => console.log(`CQCYCLE i=${i} ${what} t=${Date.now() - began.current} keep=${FIGHT3D.keep ? 1 : 0} mode=${run.mode}`), [i, run.mode]);

  useEffect(() => {
    if (cycling && open) say("open");
  }, [cycling, open, say]);

  const next = useCallback(() => {
    say("closed");
    setOpen(false);
    setTimeout(() => {
      if (i + 1 >= run.cycle) {
        console.log(`CQCYCLE done n=${run.cycle} t=${Date.now() - began.current}`);
        onClose();
        return;
      }
      setI(i + 1);
      setOpen(true);
    }, run.cycleMs);
  }, [i, run.cycle, run.cycleMs, onClose, say]);

  if (!open) return <View style={[StyleSheet.absoluteFill, { backgroundColor: GP.navy }]} testID="fight3d-cycle-gap" />;
  return (
    <Fight3D
      key={i}
      point={point}
      mode={run.mode}
      autoplay={run.autoplay}
      enemyId={enemyId}
      parked={parked}
      autoCloseMs={cycling ? run.cycleMs : undefined}
      onFighting={cycling ? () => say("fighting") : undefined}
      onResult={cycling ? () => next() : onResult}
      onClose={cycling ? next : onClose}
    />
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: "#000" },
  cover: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 14, padding: 24, backgroundColor: GP.navy },
  coverText: { fontFamily: GF.display, fontSize: 20, color: "#FFF", textAlign: "center" },
  coverSub: { fontFamily: GF.body, fontSize: 14, color: "rgba(255,255,255,0.7)" },
  close: { position: "absolute", left: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
});
