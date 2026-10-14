// A Quest Point's Guardian Duel in the React Native game: the briefing
// (costquest-ios Roam/PointDuelView.swift), then the fight itself on the
// TypeScript port of costquest-duel (features/game/duel), drawn side-on in
// 2D. iOS draws the same simulation in Unity; the fight, the inputs and the
// hash are identical, so the server judges both the same way.
//
//   tap: strike · hold: block (keep holding to charge, let go to throw the heavy)
//   flick toward: dash · flick away: dodge · drag: walk · the two buttons: specials
//
// The sim steps at a fixed 60 Hz from real time (DuelRunner); this screen
// draws its state every frame. The phone only reports what happened; the
// server decides what it pays (POST /v1/duel/finish).
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  type GestureResponderEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  type DuelEvent,
  DuelEventType,
  type DuelPresentation,
  DuelRunner,
  EndReason,
  FighterAction,
  type FighterState,
  GestureRecognizer,
  presentationFromServer,
  setupFromServer,
} from "@/features/game/duel";
import { distanceText } from "@/features/game/geo";
import { raidDuelStart } from "@/features/game/raids";
import { gameStore } from "@/features/game/runtime";
import { levelMoment, reactionMoment } from "@/features/game/warden";
import type { DuelStart, QuestPoint, RoamStanding } from "@/features/game/wire";

import { GameButton, ProgressBar } from "./kit";
import { RaidDuelBriefing, raidDuelRewardSummary } from "./RaidDuel";
import { type RewardSummary, rewardFromDuel } from "./Reward";
import { difficultyName, edgeOf, GF, GP, realmColor, realmIcon, tierColor } from "./theme";
import { wardenVoice } from "./wardenVoice";

type Phase =
  | { kind: "briefing" }
  | { kind: "starting" }
  | { kind: "countdown"; start: DuelStart; n: number }
  | { kind: "fighting"; start: DuelStart }
  | { kind: "reporting"; start: DuelStart; won: boolean; reason: string }
  | { kind: "failed"; message: string };

export default function DuelScreen({
  point,
  parked,
  raid,
  onReward,
  onClose,
}: {
  point: QuestPoint;
  parked: boolean;
  /** A boss fought as a duel: mode "raid", its damage goes into the crew's shared pool. */
  raid?: boolean;
  onReward: (r: RewardSummary) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "briefing" });
  const before = useRef<RoamStanding | null>(null);
  const ctx = () => ({ me: gameStore.get().me, playerName: gameStore.playerName() });

  const fight = async () => {
    setPhase({ kind: "starting" });
    before.current = gameStore.get().me?.standing ?? null;
    try {
      const start = raid ? await raidDuelStart(gameStore.client, point, gameStore.get().fix) : await gameStore.duelStart(point);
      for (let n = 3; n >= 1; n--) {
        setPhase({ kind: "countdown", start, n });
        Haptics.selectionAsync().catch(() => {});
        await new Promise((r) => setTimeout(r, 650));
      }
      setPhase({ kind: "fighting", start });
    } catch (error) {
      setPhase({ kind: "failed", message: (error as Error).message });
    }
  };

  const finished = useCallback(
    async (start: DuelStart, runner: DuelRunner) => {
      const st = runner.sim.state;
      const won = st.winner === 1;
      const reason = st.endReason === EndReason.KO ? "K.O.!" : "Time!";
      setPhase({ kind: "reporting", start, won, reason });
      Haptics.notificationAsync(won ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
      wardenVoice.speak(reactionMoment(ctx(), won, point, "duel"), 5000).catch(() => {});
      try {
        const outcome = await gameStore.duelFinish(start, runner.finishPayload());
        await gameStore.refreshMe();
        const after = gameStore.get().me?.standing ?? null;
        const reward = raid ? raidDuelRewardSummary(outcome, point, before.current, after) : rewardFromDuel(outcome, point, before.current, after);
        if (reward.leveledUp && after) wardenVoice.speak(levelMoment(ctx(), after, reward.rankUp), 5000).catch(() => {});
        // Let the K.O. land before the reward.
        setTimeout(() => onReward(reward), 900);
      } catch (error) {
        setPhase({ kind: "failed", message: `Couldn't send the fight: ${(error as Error).message}` });
      }
    },
    [point, raid, onReward],  
  );

  if (phase.kind === "briefing" || phase.kind === "starting" || phase.kind === "failed") {
    const Brief = raid ? RaidDuelBriefing : Briefing;
    return <Brief point={point} busy={phase.kind === "starting"} problem={phase.kind === "failed" ? phase.message : null} onFight={fight} onClose={onClose} />;
  }
  return (
    <Arena
      key={phase.start.duel_id}
      point={point}
      start={phase.start}
      countdown={phase.kind === "countdown" ? phase.n : 0}
      ending={phase.kind === "reporting" ? phase : null}
      paused={parked}
      raid={raid}
      onOver={finished}
      onQuit={onClose}
    />
  );
}

// ---------- the briefing ----------

function Briefing({ point, busy, problem, onFight, onClose }: { point: QuestPoint; busy: boolean; problem: string | null; onFight: () => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const color = realmColor(point.realm);
  const me = gameStore.get().me;
  const holder = point.extra?.holder_name ?? (point.extra?.holder ? gameStore.factionName(point.extra.holder) : null);
  return (
    <View style={styles.root}>
      <View style={[styles.header, { backgroundColor: color, paddingTop: insets.top + 8 }]}>
        <Ionicons name={point.realm === "anime" ? "flame" : realmIcon(point.realm)} size={300} color="rgba(0,0,0,0.10)" style={styles.emblem} />
        <View style={styles.topBar}>
          <Pressable onPress={onClose} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Leave" hitSlop={8}>
            <Ionicons name="close" size={22} color="#FFF" />
          </Pressable>
          <Text style={styles.placeChip} numberOfLines={1}>
            {point.name.toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <Animated.View entering={FadeIn.duration(400)}>
          <Text style={styles.kicker}>{`${gameStore.factionName(point.realm)} Guardian`.toUpperCase()}</Text>
          <Text style={styles.guardian} numberOfLines={3} adjustsFontSizeToFit>
            {point.extra?.guardian ?? `Guardian of ${point.name}`}
          </Text>
        </Animated.View>
      </View>
      <View style={[styles.lower, { paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.facts}>
          <Fact label="DIFFICULTY" value={difficultyName(point.tier)} color={tierColor(point.tier)} />
          <View style={styles.divider} />
          <Fact label="YOU" value={me ? `Lv ${me.standing.level}` : "-"} color={GP.ink} />
          <View style={styles.divider} />
          <Fact label="DISTANCE" value={distanceText(gameStore.distanceTo(point))} color={GP.ink} />
        </View>
        <Text style={styles.blurb}>
          {point.extra?.holder && point.extra.holder === gameStore.get().me?.faction
            ? `Held by your faction. Beat its Guardian to defend ${point.name}.`
            : holder
              ? `${holder} holds ${point.name}. Beat its Guardian to take it for your faction.`
              : `Beat it to take ${point.name} for your faction.`}
        </Text>
        <Text style={styles.howto}>Tap to strike · Hold to block, keep holding to charge · Flick toward to dash, away to dodge · Drag to walk</Text>
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        {busy ? (
          <ActivityIndicator color={GP.navy} />
        ) : (
          <GameButton title="Fight" color={GP.sun} onPress={onFight} icon={<Ionicons name="flash" size={20} color="#FFF" />} />
        )}
      </View>
    </View>
  );
}

function Fact({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={[styles.factValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

// ---------- the arena ----------

type Floater = { id: number; x: number; text: string; color: string; born: number };

/** What one frame draws: a plain copy of the sim's state (never the live sim, so render stays pure). */
type FighterView = {
  x: number;
  facing: number;
  action: number;
  actionTick: number;
  actionLength: number;
  hp: number;
  maxHp: number;
  meter: number;
  guard: number;
  holding: boolean;
  charging: boolean;
  invulnerable: boolean;
  cls: number;
};
type Snap = { now: number; ticksLeft: number; p1: FighterView; p2: FighterView; floaters: Floater[]; shakeAt: number; glowAt: [number, number] };

function viewOf(f: FighterState, x: number): FighterView {
  return {
    x,
    facing: f.facing,
    action: f.action,
    actionTick: f.actionTick,
    actionLength: f.actionLength,
    hp: f.hp,
    maxHp: f.stats.maxHp,
    meter: f.meter,
    guard: f.guard,
    holding: f.holding,
    charging: f.action === FighterAction.HeavyCharge || (f.holding && f.chargeTicks > 0),
    invulnerable: f.invulnerable,
    cls: f.class,
  };
}

function snapshot(runner: DuelRunner, now: number, floaters: Floater[], shakeAt: number, glowAt: [number, number]): Snap {
  const st = runner.sim.state;
  return {
    now,
    ticksLeft: st.ticksLeft,
    p1: viewOf(st.p1, runner.drawX(0)),
    p2: viewOf(st.p2, runner.drawX(1)),
    floaters: [...floaters],
    shakeAt,
    glowAt: [glowAt[0], glowAt[1]],
  };
}

const FIGHTER_H = 150;

function Arena({
  point,
  start,
  countdown,
  ending,
  paused,
  raid,
  onOver,
  onQuit,
}: {
  point: QuestPoint;
  start: DuelStart;
  countdown: number;
  ending: { won: boolean; reason: string } | null;
  paused: boolean;
  raid?: boolean;
  onOver: (start: DuelStart, runner: DuelRunner) => void;
  onQuit: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const setup = useMemo(() => setupFromServer(start.setup, start.seed_text), [start]);
  const view: DuelPresentation = useMemo(() => presentationFromServer(start.setup), [start]);
  const gestures = useMemo(() => new GestureRecognizer({ width, height }), [width, height]);
  const runner = useMemo(() => new DuelRunner(setup, { input: gestures }), [setup, gestures]);
  const [snap, setSnap] = useState<Snap>(() => snapshot(runner, 0, [], -1e9, [-1e9, -1e9]));
  const live = countdown === 0 && !ending;
  const halfWidth = setup.arenaHalfWidthMm;

  // The loop: real time in, fixed 60 Hz ticks out, one snapshot per frame.
  useEffect(() => {
    if (!live || paused) return;
    const toX = (mm: number) => width / 2 + (mm / halfWidth) * (width * 0.46);
    let floaters: Floater[] = [];
    let floaterId = 0;
    let shakeAt = -1e9;
    const glowAt: [number, number] = [-1e9, -1e9];
    let raf = 0;
    let done = false;
    let last = performance.now();
    gestures.setEnabled(true, last);
    const onEvent = (e: DuelEvent, now: number) => {
      if (e.type === DuelEventType.Hit || e.type === DuelEventType.Blocked) {
        const heavy = (e.hitStop ?? 0) > 6;
        floaters.push({
          id: ++floaterId,
          x: toX(e.x ?? 0),
          text: e.type === DuelEventType.Blocked ? `${e.damage}` : `-${e.damage}`,
          color: e.type === DuelEventType.Blocked ? GP.ice : e.target === 1 ? GP.berry : GP.sun,
          born: now,
        });
        if (heavy) shakeAt = now;
        Haptics.impactAsync(heavy ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      } else if (e.type === DuelEventType.GuardBreak) {
        floaters.push({ id: ++floaterId, x: toX(e.x ?? 0), text: "BREAK!", color: GP.sun, born: now });
        shakeAt = now;
      } else if (e.type === DuelEventType.Telegraph) {
        glowAt[(e.source ?? 1) - 1] = now;
      } else if (e.type === DuelEventType.KO) {
        shakeAt = now;
      }
    };
    const loop = (now: number) => {
      gestures.poll(now);
      const r = runner.advance(now - last);
      last = now;
      for (const e of r.events) onEvent(e, now);
      floaters = floaters.filter((f) => now - f.born < 900);
      setSnap(snapshot(runner, now, floaters, shakeAt, glowAt));
      if (runner.over) {
        if (!done) {
          done = true;
          onOver(start, runner);
        }
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      gestures.setEnabled(false, performance.now());
    };
  }, [live, paused, runner, gestures, start, onOver, width, halfWidth]);

  const toScreenX = (mm: number) => width / 2 + (mm / halfWidth) * (width * 0.46);
  const now = snap.now;
  const shaking = now - snap.shakeAt < 220;
  const offset = shaking ? Math.sin(now / 18) * 6 : 0;
  const groundY = height * 0.68;
  const p1Color = realmColor(view.p1Faction || gameStore.get().me?.faction);
  const p2Color = realmColor(view.p2Faction || point.realm);
  // One clock for touches and the loop's poll (a touch event's own timestamp
  // is on another clock on Android), or a still thumb never becomes a block.
  const touch = (fn: (t: number, x: number, y: number, id: number) => void) => (e: GestureResponderEvent) => {
    const t = performance.now();
    for (const p of e.nativeEvent.changedTouches) fn(t, p.pageX, p.pageY, Number(p.identifier));
  };

  return (
    <View
      style={[styles.arena, { backgroundColor: edgeOf(p2Color, 0.35) }]}
      onStartShouldSetResponder={() => live}
      onMoveShouldSetResponder={() => live}
      onResponderTerminationRequest={() => false}
      onResponderGrant={touch((t, x, y, id) => gestures.press(t, x, y, id))}
      onResponderMove={touch((t, x, y, id) => gestures.move(t, x, y, id))}
      onResponderRelease={touch((t, x, y, id) => gestures.release(t, x, y, id))}
      onResponderTerminate={() => gestures.cancel(performance.now())}
      accessibilityLabel="The arena. Tap to strike, hold to block, flick to dash or dodge."
      accessibilityHint="Double tap and hold to block">
      <View style={[styles.sky, { backgroundColor: edgeOf(p2Color, 0.55) }]} />
      <View style={[styles.ground, { top: groundY, backgroundColor: edgeOf(p2Color, 0.22) }]} />
      <View style={[styles.groundLine, { top: groundY }]} />

      <View style={[StyleSheet.absoluteFill, { transform: [{ translateX: offset }] }]} pointerEvents="none">
        <Fighter f={snap.p2} toScreenX={toScreenX} groundY={groundY} color={p2Color} glow={now - snap.glowAt[1] < 400} now={now} guardian />
        <Fighter f={snap.p1} toScreenX={toScreenX} groundY={groundY} color={p1Color} glow={now - snap.glowAt[0] < 400} now={now} />
        {snap.floaters.map((fl) => {
          const age = (now - fl.born) / 900;
          return (
            <Text key={fl.id} style={[styles.floater, { left: fl.x - 40, top: groundY - FIGHTER_H - 30 - age * 50, opacity: 1 - age, color: fl.color }]}>
              {fl.text}
            </Text>
          );
        })}
      </View>

      <View style={[styles.hud, { top: insets.top + 8 }]} pointerEvents="box-none">
        <Bars name={view.p1Name || gameStore.playerName()} level={view.p1Level} f={snap.p1} color={p1Color} align="left" />
        <View style={styles.clock}>
          <Text style={styles.clockText}>{Math.ceil(snap.ticksLeft / 60)}</Text>
        </View>
        <Bars name={view.p2Name || "Guardian"} level={view.p2Level} f={snap.p2} color={p2Color} align="right" />
      </View>

      <View style={[styles.specials, { bottom: insets.bottom + 18 }]}>
        <SpecialButton n={1} label="Special" ready={snap.p1.meter >= 100} onPress={() => gestures.special(1)} disabled={!live} />
        <SpecialButton n={2} label="Ultimate" ready={snap.p1.meter >= 300} onPress={() => gestures.special(2)} disabled={!live} />
      </View>
      <Pressable onPress={onQuit} style={[styles.quit, { bottom: insets.bottom + 22 }]} accessibilityRole="button" accessibilityLabel="Leave the fight" hitSlop={8}>
        <Ionicons name="exit-outline" size={20} color="#FFF" />
      </Pressable>

      {countdown > 0 ? (
        <View style={styles.center} pointerEvents="none">
          <Animated.Text key={countdown} entering={ZoomIn.springify()} style={styles.countdown}>
            {countdown}
          </Animated.Text>
          <Text style={styles.versus}>
            {view.p1Name || "You"} vs {view.p2Name}
          </Text>
        </View>
      ) : null}
      {ending ? (
        <View style={styles.center} pointerEvents="none">
          <Animated.Text entering={ZoomIn.springify()} style={[styles.countdown, { color: ending.won ? GP.sun : "#FFF" }]}>
            {ending.reason}
          </Animated.Text>
          <Text style={styles.versus}>{ending.won ? "You win!" : raid ? "Every hit counts toward the crew's." : "The Guardian holds."}</Text>
          <ActivityIndicator color="#FFF" style={{ marginTop: 12 }} />
        </View>
      ) : null}
      {paused && live ? (
        <View style={styles.center} pointerEvents="none">
          <Text style={styles.versus}>Paused</Text>
        </View>
      ) : null}
    </View>
  );
}

function Bars({ name, level, f, color, align }: { name: string; level: number; f: FighterView; color: string; align: "left" | "right" }) {
  const hp = f.hp / Math.max(1, f.maxHp);
  return (
    <View style={[styles.bars, { alignItems: align === "left" ? "flex-start" : "flex-end" }]} accessibilityLabel={`${name}, ${f.hp} of ${f.maxHp} health`}>
      <Text style={styles.barName} numberOfLines={1}>
        {name} · Lv {level}
      </Text>
      <View style={{ width: "100%", transform: [{ scaleX: align === "right" ? -1 : 1 }] }}>
        <ProgressBar value={hp} color={hp > 0.3 ? GP.mint : GP.berry} track="rgba(0,0,0,0.35)" height={14} />
      </View>
      <View style={[styles.meterRow, { flexDirection: align === "left" ? "row" : "row-reverse" }]}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.meterCell}>
            <View style={{ width: `${Math.max(0, Math.min(1, (f.meter - i * 100) / 100)) * 100}%`, height: "100%", backgroundColor: color }} />
          </View>
        ))}
      </View>
      <View style={{ width: "60%", transform: [{ scaleX: align === "right" ? -1 : 1 }] }}>
        <ProgressBar value={f.guard / 100} color={GP.ice} track="rgba(0,0,0,0.3)" height={4} />
      </View>
    </View>
  );
}

function SpecialButton({ n, label, ready, onPress, disabled }: { n: number; label: string; ready: boolean; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.special, { backgroundColor: ready ? GP.sun : "rgba(255,255,255,0.18)" }]}
      accessibilityRole="button"
      accessibilityLabel={`${label}${ready ? ", ready" : ", charging"}`}>
      <Ionicons name={n === 1 ? "flash" : "nuclear"} size={22} color={ready ? GP.navy : "rgba(255,255,255,0.7)"} />
      <Text style={[styles.specialText, { color: ready ? GP.navy : "rgba(255,255,255,0.7)" }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * One fighter, drawn from its sim state: a body, a head, a weapon arm, and the
 * pose of the current action (FighterAction) at its normalised time.
 */
function Fighter({
  f,
  toScreenX,
  groundY,
  color,
  glow: telegraphed,
  now,
  guardian,
}: {
  f: FighterView;
  toScreenX: (mm: number) => number;
  groundY: number;
  color: string;
  glow: boolean;
  now: number;
  guardian?: boolean;
}) {
  const A = FighterAction;
  const t = f.actionLength > 0 ? Math.min(1, f.actionTick / f.actionLength) : 0;
  const attackArm =
    f.action === A.Light1 || f.action === A.Light2 || f.action === A.Light3
      ? Math.sin(t * Math.PI) * 95
      : f.action === A.HeavyRelease || f.action === A.DashStrike
        ? Math.sin(t * Math.PI) * 120
        : f.action === A.Special1 || f.action === A.Special2
          ? 140 * Math.sin(t * Math.PI)
          : f.action === A.Block || f.action === A.BlockStun || f.action === A.HeavyCharge
            ? 60
            : f.action === A.Victory
              ? 150
              : 20;
  const lean =
    f.action === A.DashIn || f.action === A.DashStrike
      ? 18
      : f.action === A.HitLight || f.action === A.HitHeavy || f.action === A.GuardBreak
        ? -16
        : f.action === A.DodgeBack
          ? -22
          : f.action === A.WalkFwd
            ? 6
            : f.action === A.WalkBack
              ? -6
              : 0;
  const down = f.action === A.Knockdown ? 1 : f.action === A.GetUp ? 1 - t : 0;
  const defeated = f.action === A.Defeat;
  const hit = f.action === A.HitLight || f.action === A.HitHeavy;
  const glow = telegraphed || f.charging;
  const blocking = f.action === A.Block || f.action === A.BlockStun || f.holding;
  const left = toScreenX(f.x);
  const facing = f.facing;
  const bob = f.action === A.Idle ? Math.sin(now / 260) * 2 : 0;
  return (
    <View
      style={[
        styles.fighter,
        {
          left: left - 40,
          top: groundY - FIGHTER_H + bob + (defeated ? 30 : 0),
          opacity: f.invulnerable && f.action === A.DodgeBack ? 0.55 : 1,
          transform: [
            { scaleX: facing },
            { rotate: `${down ? 80 * down : lean}deg` },
            { translateY: down * 40 },
            { scaleY: defeated ? 0.75 : 1 },
          ],
        },
      ]}>
      {glow ? <View style={[styles.glow, { borderColor: guardian ? GP.berry : GP.sun }]} /> : null}
      <View style={[styles.head, { backgroundColor: hit ? "#FFFFFF" : color }]}>
        {guardian ? <Ionicons name="skull" size={20} color="rgba(0,0,0,0.35)" /> : <View style={styles.eye} />}
      </View>
      <View style={[styles.body, { backgroundColor: hit ? "#FFFFFF" : edgeOf(color, 0.85) }]} />
      <View style={[styles.arm, { transform: [{ rotate: `${-attackArm}deg` }] }]}>
        <View style={[styles.forearm, { backgroundColor: edgeOf(color, 0.7) }]} />
        {f.cls === 0 ? <View style={styles.blade} /> : <View style={[styles.fist, { backgroundColor: edgeOf(color, 0.6) }]} />}
      </View>
      {blocking ? <View style={[styles.shield, { borderColor: f.guard < 30 ? GP.berry : GP.ice }]} /> : null}
      <View style={styles.legs}>
        <View style={[styles.leg, { backgroundColor: edgeOf(color, 0.55), transform: [{ rotate: `${f.action === A.WalkFwd || f.action === A.WalkBack ? Math.sin(now / 90) * 18 : 6}deg` }] }]} />
        <View style={[styles.leg, { backgroundColor: edgeOf(color, 0.55), transform: [{ rotate: `${f.action === A.WalkFwd || f.action === A.WalkBack ? -Math.sin(now / 90) * 18 : -6}deg` }] }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: GP.cream },
  header: { flex: 1, paddingHorizontal: 16, paddingBottom: 26, overflow: "hidden" },
  emblem: { position: "absolute", right: -70, top: 20 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(30,58,76,0.85)", alignItems: "center", justifyContent: "center" },
  placeChip: {
    maxWidth: "70%",
    fontFamily: GF.display,
    fontSize: 13,
    letterSpacing: 1.4,
    color: "#FFF",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "rgba(30,58,76,0.85)",
  },
  kicker: { fontFamily: GF.display, fontSize: 13, letterSpacing: 1.6, color: "rgba(255,255,255,0.9)" },
  guardian: { fontFamily: GF.display, fontSize: 40, color: "#FFF" },
  lower: { paddingHorizontal: 16, paddingTop: 22, gap: 16, borderTopWidth: 5, borderTopColor: GP.navy },
  facts: { flexDirection: "row", alignItems: "center", paddingVertical: 14, borderRadius: 16, backgroundColor: "#FFF", borderWidth: 1.5, borderColor: "rgba(30,58,76,0.12)" },
  fact: { flex: 1, alignItems: "center", gap: 4 },
  factLabel: { fontFamily: GF.display, fontSize: 11, letterSpacing: 1.2, color: GP.mist },
  factValue: { fontFamily: GF.display, fontSize: 20 },
  divider: { width: 1.5, height: 36, backgroundColor: "rgba(30,58,76,0.12)" },
  blurb: { fontFamily: GF.body, fontSize: 15, color: "rgba(30,58,76,0.7)" },
  howto: { fontFamily: GF.regular, fontSize: 12, color: GP.mist },
  problem: { fontFamily: GF.body, fontSize: 14, color: GP.berry },
  arena: { ...StyleSheet.absoluteFill, overflow: "hidden" },
  sky: { ...StyleSheet.absoluteFill, bottom: "40%" },
  ground: { position: "absolute", left: 0, right: 0, bottom: 0 },
  groundLine: { position: "absolute", left: 0, right: 0, height: 3, backgroundColor: "rgba(255,255,255,0.35)" },
  hud: { position: "absolute", left: 12, right: 12, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bars: { flex: 1, gap: 4 },
  barName: { fontFamily: GF.display, fontSize: 13, color: "#FFF" },
  meterRow: { gap: 3, width: "70%" },
  meterCell: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: "rgba(0,0,0,0.35)" },
  clock: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "rgba(255,255,255,0.5)" },
  clockText: { fontFamily: GF.display, fontSize: 20, color: "#FFF" },
  specials: { position: "absolute", right: 14, flexDirection: "row", gap: 10 },
  special: { width: 74, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", gap: 2 },
  specialText: { fontFamily: GF.bold, fontSize: 11 },
  quit: { position: "absolute", left: 14, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  countdown: { fontFamily: GF.display, fontSize: 84, color: "#FFF", textShadowColor: "rgba(0,0,0,0.4)", textShadowOffset: { width: 0, height: 4 }, textShadowRadius: 0.1 },
  versus: { fontFamily: GF.display, fontSize: 20, color: "#FFF" },
  floater: { position: "absolute", width: 80, textAlign: "center", fontFamily: GF.display, fontSize: 22 },
  fighter: { position: "absolute", width: 80, height: FIGHTER_H, alignItems: "center" },
  glow: { position: "absolute", top: -10, left: -6, width: 92, height: FIGHTER_H + 16, borderRadius: 46, borderWidth: 4, opacity: 0.8 },
  head: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "rgba(0,0,0,0.25)" },
  eye: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FFF", marginLeft: 14 },
  body: { width: 44, height: 58, borderRadius: 16, marginTop: 2 },
  arm: { position: "absolute", top: 50, left: 40, width: 70, height: 12, transformOrigin: "0% 50%", flexDirection: "row", alignItems: "center" },
  forearm: { width: 30, height: 10, borderRadius: 5 },
  blade: { width: 44, height: 5, borderRadius: 2, backgroundColor: "#E8EEF2" },
  fist: { width: 16, height: 16, borderRadius: 8 },
  shield: { position: "absolute", top: 20, left: 54, width: 26, height: 84, borderRadius: 14, borderWidth: 5, borderLeftWidth: 0 },
  legs: { flexDirection: "row", gap: 6, marginTop: 0 },
  leg: { width: 14, height: 42, borderRadius: 7, transformOrigin: "50% 0%" },
});
