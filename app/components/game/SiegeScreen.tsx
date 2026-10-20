// The quiz Siege: a rival faction holds this point, and its Guardian is beaten
// with right answers (costquest-ios Features/SiegeFeature.swift SiegeView).
// The intro with the rules, then up to seven rounds against a 15 s ring: a
// right answer swings the Relic and cracks the Guardian, the Relic's ward can
// block a miss, a wrong or late one is struck back (shake, red edges, focus
// lost). The Strike's three pulses play while the server marks the answer.
// The model is features/game/siege.ts, the staging numbers siegeFlow.ts, the
// pieces SiegeParts.tsx.
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInRight,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
  ZoomIn,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { abilityIcon, abilityName, equippedFor } from "@/features/game/relics";
import { useRelics, relicsStore } from "@/features/game/relicsLive";
import { gameStore, useGame } from "@/features/game/runtime";
import {
  beatOf,
  effectLabel,
  effectsOf,
  hitLabel,
  hpShare,
  initialSiege,
  removedChoices,
  rewardRows,
  roundsLine,
  siegeAfter,
  siegeAnswer,
  siegeBegin,
  siegeDrop,
  siegeFailed,
  siegeFaction,
  siegeLanded,
  siegePick,
  siegeStart,
  siegeStarted,
  type SiegeAnswerResult,
  type SiegeModel,
  totalRounds,
} from "@/features/game/siege";
import {
  BEAT_MS,
  BLOCKED_MS,
  choiceLabel,
  EFFECT_GAP_MS,
  HIT_LAND_MS,
  introLine,
  POP_LIFE_MS,
  resultButton,
  resultCopy,
  RETREAT_MESSAGE,
  RETREAT_TITLE,
  roundChip,
  SIEGE_INTRO_RULES,
  siegeMoment,
  STRIKE_LEAD_MS,
  STRIKE_TAIL_MS,
} from "@/features/game/siegeFlow";
import type { QuestPoint } from "@/features/game/wire";

import { GameBackdrop } from "./GameBackdrop";
import { Chip, GameButton, GameIconButton, GamePanel, GameTitle, MAX_FONT_SCALE, announce, withAlpha } from "./kit";
import { impact, notify } from "./prefs";
import { RelicArt } from "./RelicArt";
import { RelicDropExtra } from "./RelicDropCard";
import { DamageText, FocusBar, GuardianView, HpBar, RingTimer, SiegeChoice, type SiegeChoiceState, StrikeVignette, Sunburst, SwingingRelic } from "./SiegeParts";
import { playSound } from "./sound";
import { playResolve, startStrike } from "./strike";
import { edgeOf, GF, GP, realmColor, realmIcon } from "./theme";
import { useWardenSaid, wardenVoice } from "./wardenVoice";
import { WardenBubble } from "./Hud";

/** The phone's clock, read in handlers (never during render). */
const clock = () => Date.now();

type Pop = { id: number; text: string; color: string; x: number };

/** SiegeLook.gradeColor: Flawless sun, Swift mint, the rest sky. */
function gradeColor(g: string | null | undefined): string {
  return g === "Flawless" ? GP.sun : g === "Swift" ? GP.mint : GP.sky;
}

/**
 * Android's hardware Back, for GameRoot to ask first: during a round it asks
 * before retreating (and returns true); otherwise it leaves. Null when no
 * siege is open.
 */
export const siegeGuard: { current: (() => boolean) | null } = { current: null };

export default function SiegeScreen({
  point,
  parked,
  onClose,
  onDone,
}: {
  point: QuestPoint;
  parked: boolean;
  onClose: () => void;
  /** Called once, as the screen closes: true when the point was taken. */
  onDone?: (won: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const me = useGame((s) => s.me);
  const fix = useGame((s) => s.fix);
  const relics = useRelics();
  const said = useWardenSaid();
  const [m, setModel] = useState<SiegeModel>(() => initialSiege(point));
  const model = useRef(m);
  const set = (next: SiegeModel) => {
    model.current = next;
    setModel(next);
  };
  const [pops, setPops] = useState<Pop[]>([]);
  const [blocked, setBlocked] = useState(false);
  const [hitTick, setHitTick] = useState(0);
  const [strikeTick, setStrikeTick] = useState(0);
  const [swing, setSwing] = useState(0);
  const alive = useRef(true);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const popId = useRef(0);
  const shake = useSharedValue(0);
  const vignette = useSharedValue(0);

  const holder = m.state?.faction_attacked ?? siegeFaction(point);
  const holderColor = realmColor(holder);
  const holderName = m.state?.faction_attacked_name ?? (holder ? gameStore.factionName(holder) : "Rival");
  const myColor = realmColor(me?.faction);
  const relic = m.state?.relic ?? equippedFor(relics.payload, me);
  const power = m.state?.relic_power ?? (relic && "power_now" in relic ? relic.power_now : null) ?? relic?.power ?? null;
  const ability = m.state?.ability ?? relic?.ability ?? null;
  const fighting = m.phase === "fight" || m.phase === "judging";

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        timers.current.delete(t);
        resolve();
      }, ms);
      timers.current.add(t);
    });

  useEffect(() => {
    alive.current = true;
    void relicsStore.refresh();
    const pending = timers.current;
    return () => {
      alive.current = false;
      pending.forEach(clearTimeout);
      wardenVoice.quiet();
    };
  }, []);

  const close = () => {
    wardenVoice.quiet();
    onDone?.(model.current.won);
    onClose();
  };
  const leave = () => {
    const p = model.current.phase;
    if (p === "fight" || p === "judging") {
      Alert.alert(RETREAT_TITLE, RETREAT_MESSAGE, [
        { text: "Retreat", style: "destructive", onPress: close },
        { text: "Keep fighting", style: "cancel" },
      ]);
      return;
    }
    close();
  };
  const leaveRef = useRef(leave);
  useEffect(() => {
    leaveRef.current = leave;
  });
  useEffect(() => {
    siegeGuard.current = () => {
      leaveRef.current();
      return true;
    };
    return () => {
      siegeGuard.current = null;
    };
  }, []);

  const pop = (text: string, color: string) => {
    const p = { id: ++popId.current, text, color, x: Math.round(Math.random() * 100 - 50) };
    setPops((all) => [...all, p]);
    const t = setTimeout(() => {
      timers.current.delete(t);
      if (alive.current) setPops((all) => all.filter((x) => x.id !== p.id));
    }, POP_LIFE_MS);
    timers.current.add(t);
  };

  const begin = async () => {
    const started = siegeBegin(model.current);
    if (started === model.current) return;
    set(started);
    playSound("whoosh");
    try {
      const s = await siegeStart(gameStore.client, point, fix);
      if (!alive.current) return;
      const next = siegeStarted(model.current, s, clock());
      set(next);
      if (next.phase === "result") finished(next);
      else wardenVoice.prepare(siegeMoment(ctx(), true, point.name, holderName, 3));
    } catch (e) {
      if (alive.current) set(siegeFailed(model.current, e instanceof Error ? e.message : "The siege could not start."));
    }
  };

  const ctx = () => ({ me: gameStore.get().me, playerName: gameStore.playerName() });

  const answer = async (choice: number) => {
    const picked = siegePick(model.current, choice, clock());
    if (!picked) return;
    set(picked.model);
    // The Strike: the same three rising pulses as any point, while the server judges.
    const strike = startStrike({ pulse: () => {} });
    try {
      const { siegeId, round, choice: c, elapsedMs } = picked.send;
      const r = await siegeAnswer(gameStore.client, siegeId, round, c, elapsedMs);
      await strike.done;
      if (alive.current) await land(r);
    } catch (e) {
      strike.cancel();
      if (alive.current) set(siegeFailed(model.current, `Couldn't send your answer: ${e instanceof Error ? e.message : "no connection"}`));
    }
  };

  /** One exchange, staged: the answer shown, then the hit or the strike, then the next question or the end. */
  const land = async (r: SiegeAnswerResult) => {
    const before = model.current;
    const landed = siegeLanded(before, r);
    // The HP and focus move with their beats, not before.
    set({ ...landed, hp: before.hp, focus: before.focus });
    const beat = beatOf(r);
    if (beat === "hit") {
      setSwing((n) => n + 1);
      playSound("whoosh");
      await wait(HIT_LAND_MS);
      if (!alive.current) return;
      setHitTick((n) => n + 1);
      playResolve(true);
      playSound("hit");
      pop(hitLabel(r), gradeColor(r.grade));
      for (const e of effectsOf(r, ability, landed.run)) {
        await wait(EFFECT_GAP_MS);
        if (!alive.current) return;
        pop(effectLabel(e === "surge" ? e : abilityName(e)), GP.berry);
      }
      set({ ...model.current, hp: landed.hp, focus: landed.focus });
      announce(`Hit. ${hitLabel(r)}. Guardian ${Math.max(0, landed.hp)} of ${landed.maxHp}.`);
    } else if (beat === "blocked") {
      playSound("coin");
      impact(Haptics.ImpactFeedbackStyle.Rigid);
      setBlocked(true);
      announce("Blocked by your Relic.");
      await wait(BLOCKED_MS);
      if (!alive.current) return;
      setBlocked(false);
    } else {
      // The Guardian hits back: the screen shakes, the edges go red.
      playSound("hit");
      notify(Haptics.NotificationFeedbackType.Error);
      setStrikeTick((n) => n + 1);
      await wait(STRIKE_LEAD_MS);
      if (!alive.current) return;
      if (!reduce) {
        shake.set(withSequence(...[10, -9, 7, -5, 3, 0].map((x) => withTiming(x, { duration: 75, easing: Easing.linear }))));
      }
      vignette.set(withTiming(1, { duration: 120, easing: Easing.out(Easing.quad) }));
      set({ ...model.current, focus: landed.focus });
      announce(`The Guardian strikes. Focus ${landed.focus}.`);
      await wait(STRIKE_TAIL_MS);
      vignette.set(withTiming(0, { duration: 700, easing: Easing.in(Easing.quad) }));
    }
    set({ ...model.current, hp: landed.hp, focus: landed.focus });
    await wait(BEAT_MS);
    if (!alive.current) return;
    const next = siegeAfter(model.current, r, clock());
    set(next);
    if (next.phase === "result") finished(next);
  };

  const finished = (end: SiegeModel) => {
    if (end.won) {
      playSound("fanfare");
      notify(Haptics.NotificationFeedbackType.Success);
      announce(`Taken! ${point.name} is yours.`);
    } else {
      playResolve(false);
      announce(`Repelled. The ${holderName} Guardian held.`);
    }
    void wardenVoice.speak(siegeMoment(ctx(), end.won, point.name, holderName, end.roundsUsed), 8000).catch(() => {});
    relicsStore.noteDrop();
    void gameStore.refreshMe();
    void gameStore.refreshPoints(true);
  };

  // The clock: a late answer is answer -1, sent when the ring runs out.
  const questionKey = m.phase === "fight" ? `${m.round}:${m.deadline}` : null;
  useEffect(() => {
    if (!questionKey || parked) return;
    const t = setTimeout(() => void answer(-1), Math.max(0, model.current.deadline - clock()));
    return () => clearTimeout(t);
  }, [questionKey, parked]); // eslint-disable-line react-hooks/exhaustive-deps

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.get() }] }));
  const share = hpShare(m);
  const q = m.question;
  const removed = removedChoices(m);
  const copy = resultCopy(m.won, point.name, holderName, me?.faction_name);
  const drop = siegeDrop(m.reward);
  const guardianH = m.phase === "intro" || m.phase === "starting" ? 280 : m.phase === "result" ? (m.won ? 60 : 190) : 170;

  const choiceState = (i: number): SiegeChoiceState => {
    if (m.reveal !== null) return i === m.reveal ? "right" : i === m.picked ? "wrong" : "dim";
    if (removed.includes(i)) return "removed";
    return "idle";
  };

  return (
    <View style={styles.root} accessibilityViewIsModal>
      {/* SiegeView.statusBarHidden() */}
      <StatusBar hidden animated />
      <GameBackdrop />
      {/* Dusk over the arena, tinted with whoever holds it. */}
      <LinearGradient colors={[withAlpha(GP.navy, 0.75), withAlpha(holderColor, 0.25), withAlpha(GP.navyEdge, 0.6)]} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <LinearGradient
        colors={["rgba(0,0,0,0)", "rgba(0,0,0,0)", `rgba(0,0,0,${m.phase === "intro" ? 0.3 : 0.6})`]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <StrikeVignette opacity={vignette} />

      <Animated.View style={[styles.column, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 10 }, shakeStyle]}>
        {/* The header: leave, the place, the chips. */}
        <View style={styles.header}>
          <GameIconButton icon="close" color={withAlpha(GP.navy, 0.8)} diameter={42} onPress={leave} accessibilityLabel="Leave" />
          <View style={{ flex: 1, alignItems: "flex-end", gap: 6 }}>
            <Text style={styles.place} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {point.name}
            </Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <Chip text="Siege" color={holderColor} />
              {fighting ? <Chip text={roundChip(m.round, totalRounds(m.state))} color={GP.navy} /> : null}
            </View>
          </View>
        </View>

        {/* The Guardian's bar. */}
        <View
          style={[styles.guardianBar, { borderColor: withAlpha(holderColor, 0.7) }]}
          accessible
          accessibilityLabel={`${holderName} Guardian, ${Math.max(0, m.hp)} of ${m.maxHp} health`}>
          <View style={styles.barRow}>
            <View style={[styles.realmDot, { backgroundColor: holderColor }]}>
              <Ionicons name={realmIcon(holder)} size={15} color="#FFF" />
            </View>
            <Text style={styles.barTitle} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {holderName} Guardian
            </Text>
            <View style={{ flex: 1 }} />
            <Text style={styles.hpNow}>{Math.max(0, m.hp)}</Text>
            <Text style={styles.hpMax}>/ {m.maxHp}</Text>
          </View>
          <HpBar share={share} color={holderColor} />
        </View>

        {/* The Guardian itself, and what lands on it. */}
        <View style={[styles.arena, { height: guardianH }]} pointerEvents="none">
          <View style={{ transform: [{ scale: m.phase === "intro" || m.phase === "starting" ? 1 : 0.62 }] }}>
            <GuardianView color={holderColor} share={share} hitTick={hitTick} strikeTick={strikeTick} defeated={m.phase === "result" && m.won} idle={!parked} />
          </View>
          {pops.map((p) => (
            <DamageText key={p.id} text={p.text} color={p.color} x={p.x} />
          ))}
          {blocked ? (
            <Animated.View entering={ZoomIn.springify().stiffness(440).damping(17)} exiting={FadeOut} style={styles.blocked}>
              <Ionicons name="shield" size={26} color="#FFF" />
              <Text style={styles.blockedText}>BLOCKED</Text>
            </Animated.View>
          ) : null}
        </View>

        {said && (m.phase === "intro" || m.phase === "result") ? (
          <View style={{ marginBottom: 8, marginHorizontal: -14 }}>
            <WardenBubble key={said.id} text={said.text} color={myColor} onClose={() => wardenVoice.quiet()} />
          </View>
        ) : null}

        <View style={{ flex: 1 }} />

        {m.phase === "intro" || m.phase === "starting" ? (
          <Animated.View entering={FadeIn} style={{ gap: 14 }}>
            <View style={{ alignItems: "center", gap: 6 }}>
              <GameTitle text="SIEGE!" size={52} edge={edgeOf(holderColor)} />
              <Text style={styles.introLine} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {introLine(holderName, point.name)}
              </Text>
            </View>
            <View style={styles.rules}>
              <RuleChip icon="heart" text={`${m.maxHp} HP`} color={holderColor} />
              <RuleChip icon="timer" text="15 s a round" color={GP.skyDeep} />
              <RuleChip icon="list" text="Up to 7" color={GP.navy} />
            </View>
            <Text style={styles.rulesText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {SIEGE_INTRO_RULES}
            </Text>
            {m.phase === "starting" ? (
              <View style={[styles.starting, { backgroundColor: holderColor }]} accessibilityLabel="Starting the siege">
                <ActivityIndicator color="#FFF" />
              </View>
            ) : (
              <GameButton title="Attack" icon={<Ionicons name="flag" size={20} color="#FFF" />} color={holderColor} onPress={() => void begin()} />
            )}
          </Animated.View>
        ) : null}

        {m.phase === "failed" ? (
          <GamePanel>
            <View style={{ gap: 12 }}>
              <Text style={styles.panelTitle}>The Guardian waits</Text>
              <Text style={styles.panelBody}>{m.failure}</Text>
              <GameButton title="Back to the map" color={GP.sky} onPress={close} />
            </View>
          </GamePanel>
        ) : null}

        {fighting && q ? (
          <Animated.View key={`q${m.round}`} entering={reduce ? FadeIn : SlideInRight.springify().stiffness(175).damping(21)} exiting={FadeOut} style={{ gap: 12 }}>
            <View style={styles.qRow}>
              <RingTimer deadline={m.deadline} total={m.seconds} paused={m.phase !== "fight" || parked} />
              <View style={{ flex: 1, gap: 4 }}>
                {q.clue ? <Text style={{ fontSize: 34 }}>{q.clue}</Text> : null}
                <Text style={styles.question} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header">
                  {q.q}
                </Text>
              </View>
            </View>
            {q.choices.map((c, i) => {
              const st = choiceState(i);
              return (
                <SiegeChoice
                  key={i}
                  text={c}
                  index={i}
                  state={st}
                  picked={m.picked === i}
                  active={m.phase === "fight"}
                  label={choiceLabel(i, q.choices.length, c, st === "right" ? "right" : st === "wrong" ? "wrong" : st === "removed" ? "removed" : null)}
                  onPress={() => void answer(i)}
                />
              );
            })}
          </Animated.View>
        ) : null}

        {m.phase === "result" ? (
          <Animated.View entering={reduce ? FadeIn : ZoomIn.springify().stiffness(160).damping(19)} style={{ gap: 14 }}>
            {m.won ? (
              <View style={{ alignItems: "center", gap: 6 }}>
                <View style={styles.sunburst} pointerEvents="none">
                  <Sunburst color={myColor} />
                </View>
                <View style={[styles.flag, { backgroundColor: myColor, shadowColor: edgeOf(myColor) }]}>
                  <Ionicons name="flag" size={40} color="#FFF" />
                </View>
                <GameTitle text={copy.title} size={copy.size} edge={edgeOf(myColor)} />
                <Text style={styles.resultLine} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {copy.line}
                </Text>
              </View>
            ) : (
              <View style={{ alignItems: "center", gap: 6 }}>
                <GameTitle text={copy.title} size={copy.size} edge={edgeOf(holderColor)} />
                <Text style={styles.introLine} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {copy.line}
                </Text>
              </View>
            )}
            <GamePanel>
              <ScrollView style={{ maxHeight: height * 0.32 }} contentContainerStyle={{ gap: 10 }}>
                {rewardRows(m).map((l, i) => (
                  <View key={i} style={styles.payRow}>
                    <Text style={styles.payLabel}>{l.label}</Text>
                    <Text style={styles.payXp}>+{l.xp} XP</Text>
                  </View>
                ))}
                {m.reward?.faction_points && m.reward.faction_points > 0 ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons name="flag" size={14} color={withAlpha(GP.ink, 0.7)} />
                    <Text style={styles.payNote}>+{m.reward.faction_points} for your faction</Text>
                  </View>
                ) : null}
                {drop ? <RelicDropExtra extra={drop} /> : null}
                <Text style={styles.rounds}>{roundsLine(m)}</Text>
              </ScrollView>
            </GamePanel>
            <GameButton title={resultButton(m.won)} color={m.won ? GP.mint : GP.sky} onPress={close} />
          </Animated.View>
        ) : null}

        {m.phase !== "result" ? (
          <View
            style={[styles.playerBar, { borderColor: withAlpha(myColor, 0.7) }]}
            accessible
            accessibilityLabel={`Your focus ${m.focus} of 100`}>
            {relic ? <RelicArt kind={relic.kind} rarity={relic.rarity} size={46} /> : null}
            <View style={{ flex: 1, gap: 5 }}>
              <View style={styles.barRow}>
                <Text style={styles.focusLabel}>FOCUS</Text>
                <Text style={styles.focusNow}>{m.focus}</Text>
                <View style={{ flex: 1 }} />
                {ability ? <StatChip icon={abilityIcon(ability)} text={abilityName(ability)} color={GP.skyDeep} /> : null}
                {power !== null ? <StatChip icon="flame" text={`${power}`} color={GP.berry} /> : null}
              </View>
              <FocusBar value={m.focus / 100} />
            </View>
          </View>
        ) : null}
      </Animated.View>

      {/* The Relic, swung at the Guardian on a hit. */}
      {m.phase !== "result" && relic && !reduce ? <SwingingRelic kind={relic.kind} rarity={relic.rarity} swing={swing} width={width} height={height} /> : null}
    </View>
  );
}

function RuleChip({ icon, text, color }: { icon: "heart" | "timer" | "list"; text: string; color: string }) {
  return (
    <View style={[styles.ruleChip, { backgroundColor: color }]}>
      <Ionicons name={icon} size={14} color="#FFF" />
      <Text style={styles.ruleText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {text}
      </Text>
    </View>
  );
}

function StatChip({ icon, text, color }: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string; color: string }) {
  return (
    <View style={[styles.statChip, { backgroundColor: color }]}>
      <Ionicons name={icon} size={12} color="#FFF" />
      <Text style={styles.statText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {text}
      </Text>
    </View>
  );
}

const shadow = { textShadowColor: "rgba(0,0,0,0.5)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 0 };

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: GP.navy },
  column: { flex: 1, paddingHorizontal: 16 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingTop: 8 },
  place: { fontFamily: GF.display, fontSize: 20, color: "#FFF", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3 },
  guardianBar: { marginTop: 10, padding: 12, gap: 5, borderRadius: 20, borderWidth: 2, backgroundColor: withAlpha(GP.navy, 0.72) },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  realmDot: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: "#FFF", alignItems: "center", justifyContent: "center" },
  barTitle: { fontFamily: GF.display, fontSize: 19, color: "#FFF", flexShrink: 1, ...shadow },
  hpNow: { fontFamily: GF.display, fontSize: 22, color: "#FFF", fontVariant: ["tabular-nums"], ...shadow },
  hpMax: { fontFamily: GF.display, fontSize: 15, color: "rgba(255,255,255,0.7)", fontVariant: ["tabular-nums"] },
  arena: { alignItems: "center", justifyContent: "center", overflow: "visible" },
  blocked: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: "#FFF",
    backgroundColor: GP.skyDeep,
  },
  blockedText: { fontFamily: GF.display, fontSize: 30, color: "#FFF" },
  introLine: { fontFamily: GF.bold, fontSize: 16, color: "#FFF", textAlign: "center", textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 3 },
  rules: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: 8 },
  ruleChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.5)" },
  ruleText: { fontFamily: GF.display, fontSize: 14, color: "#FFF" },
  rulesText: { fontFamily: GF.body, fontSize: 14, color: "rgba(255,255,255,0.9)", textAlign: "center" },
  starting: { height: 58, borderRadius: 22, alignItems: "center", justifyContent: "center", opacity: 0.8 },
  panelTitle: { fontFamily: GF.display, fontSize: 24, color: GP.ink },
  panelBody: { fontFamily: GF.body, fontSize: 16, color: GP.ink },
  qRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  question: { fontFamily: GF.display, fontSize: 22, color: "#FFF", textShadowColor: "rgba(0,0,0,0.35)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 0 },
  sunburst: { position: "absolute", top: -170, alignSelf: "center", opacity: 0.55 },
  flag: { width: 84, height: 84, borderRadius: 42, borderWidth: 4, borderColor: "#FFF", alignItems: "center", justifyContent: "center", shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: 5 }, elevation: 6 },
  resultLine: { fontFamily: GF.display, fontSize: 18, color: "#FFF", textAlign: "center", ...shadow },
  payRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  payLabel: { fontFamily: GF.bold, fontSize: 16, color: GP.ink },
  payXp: { fontFamily: GF.display, fontSize: 18, color: GP.skyDeep },
  payNote: { fontFamily: GF.bold, fontSize: 14, color: withAlpha(GP.ink, 0.7) },
  rounds: { fontFamily: GF.bold, fontSize: 13, color: withAlpha(GP.ink, 0.55) },
  playerBar: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 20, borderWidth: 2, backgroundColor: withAlpha(GP.navy, 0.82) },
  focusLabel: { fontFamily: GF.display, fontSize: 13, letterSpacing: 1.2, color: "#FFF" },
  focusNow: { fontFamily: GF.display, fontSize: 16, color: "#FFF", fontVariant: ["tabular-nums"] },
  statChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  statText: { fontFamily: GF.display, fontSize: 13, color: "#FFF" },
});
