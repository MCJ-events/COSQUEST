// A quiz point, played: trivia, an emoji rebus, a sequence or a blitz,
// against the server's deadline (not a local timer, so a slow network or a
// backgrounded app cannot buy time). The answers go to the server, which
// marks them; the reveal shows its key. costquest-ios Roam/EncounterView.swift
// and Roam/ChallengeViews.swift.
//
// Beats: the shrine's crystal stands in front of you; you answer and the
// Strike runs (three rising pulses, sound and haptics, while the server marks
// it); the crystal breaks and the answers are shown; then the reward counts up
// (Reward.tsx). The AR/3D stage and the "Tap the shrine" approach are not
// ported: the crystal is drawn in 2D and the challenge opens at once.
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  SlideInRight,
  SlideOutLeft,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { gameStore } from "@/features/game/runtime";
import {
  challengeLabel,
  choiceLook,
  choiceState,
  type ChoiceState,
  deadlineView,
  gradeColorKey,
  hintDisabled,
  isWin,
  resultTitle,
  scrimOpacity,
  secondChanceLabel,
  springOf,
  tierName,
} from "@/features/game/strike";
import { arriveMoment, hintMoment, lateMoment, levelMoment, reactionMoment } from "@/features/game/warden";
import type { AttemptQuestion, QuestPoint, RoamAnswer, RoamAttempt, RoamVerdict } from "@/features/game/wire";
import { parseServerDate } from "@/features/game/wire";

import { announce, Chip, dropEdge, GameButton, GameCoin, GameIconButton, GamePanel, GameTitle, MAX_FONT_SCALE, pressFeedback, withAlpha } from "./kit";
import { Pop } from "./Pop";
import { type RewardSummary, celebrate, rewardFromVerdict } from "./Reward";
import SayItButton from "./SayItButton";
import { ShrineCrystal, type CrystalHandle } from "./ShrineCrystal";
import { playSound } from "./sound";
import { playResolve, startStrike } from "./strike";
import { CHOICE_COLORS, edgeOf, GF, GP, realmColor, tierColor } from "./theme";
import { useWardenSaid, wardenVoice } from "./wardenVoice";

type Phase = "opening" | "playing" | "submitting" | "reveal" | { failed: string };

/** Second chance and the hint buttons are this purple in Swift (Color(0.55, 0.36, 0.95)). */
const PURPLE = "#8C5CF2";
const GREY = "#8C8C8C";

/**
 * Android's hardware Back, for GameRoot to ask first: while the clock runs it
 * shows the leave confirmation and returns true (handled); otherwise it leaves
 * and returns true as well. Null when no encounter is open.
 */
export const encounterGuard: { current: (() => boolean) | null } = { current: null };

export default function Encounter({
  point,
  onReward,
  onClose,
}: {
  point: QuestPoint;
  onReward: (reward: RewardSummary) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [phase, setPhaseState] = useState<Phase>("opening");
  const phaseRef = useRef<Phase>("opening");
  const [attempt, setAttempt] = useState<RoamAttempt | null>(null);
  const [verdict, setVerdict] = useState<RoamVerdict | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [blitz, setBlitz] = useState<number[]>([]);
  const [showing, setShowing] = useState(0);
  const [removed, setRemoved] = useState<Record<number, number[]>>({});
  const [deadline, setDeadline] = useState<number>(0);
  const [boughtTime, setBoughtTime] = useState(false);
  const [hintProblem, setHintProblem] = useState<string | null>(null);
  const [hinting, setHinting] = useState(false);
  const [bag, setBag] = useState<Record<string, number>>({});
  const mounted = useRef(true);
  const crystal = useRef<CrystalHandle>(null);
  const said = useWardenSaid();
  const coins = useSyncExternalStore(gameStore.subscribe, () => gameStore.get().me?.coins ?? 0);
  const prices = useSyncExternalStore(gameStore.subscribe, () => gameStore.get().config?.hints ?? null);
  // What the player has answered so far, for the clock's own submit.
  const answersRef = useRef<{ picked: number | null; order: string[]; blitz: number[] }>({ picked: null, order: [], blitz: [] });

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);
  const ctx = () => ({ me: gameStore.get().me, playerName: gameStore.playerName() });
  const color = realmColor(attempt?.realm ?? point.realm);

  const refreshBag = useCallback(() => {
    gameStore.client
      .bag()
      .then((b) => {
        if (mounted.current) setBag(b.bag);
      })
      .catch(() => {});
  }, []);

  const startWith = useCallback(
    (a: RoamAttempt) => {
      answersRef.current = { picked: null, order: [], blitz: Array(a.challenge.questions?.length ?? 0).fill(-1) };
      setAttempt(a);
      setVerdict(null);
      setPicked(null);
      setOrder([]);
      setBlitz(Array(a.challenge.questions?.length ?? 0).fill(-1));
      setShowing(0);
      setRemoved({});
      setBoughtTime(false);
      setDeadline(Date.now() + 1000 * (a.remaining_s ?? a.seconds));
      setPhase("playing");
    },
    [setPhase],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Open the point: the server judges reach and hands out the challenge.
  useEffect(() => {
    let cancelled = false;
    playSound("whoosh");
    wardenVoice.speak(arriveMoment(ctx(), point), 4000).catch(() => {});
    refreshBag();
    gameStore
      .open(point)
      .then((a) => {
        if (cancelled) return;
        startWith(a);
        // Both reactions, written while the question is read (blitz waits for its score).
        if (a.kind !== "blitz") {
          wardenVoice.prepare(reactionMoment(ctx(), true, point, a.kind));
          wardenVoice.prepare(reactionMoment(ctx(), false, point, a.kind));
        }
      })
      .catch((error: Error) => {
        if (!cancelled) setPhase({ failed: error.message });
      });
    return () => {
      cancelled = true;
    };
    // Once per point.
  }, [point.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = useCallback(async () => {
    if (!attempt || phaseRef.current !== "playing") return;
    setPhase("submitting");
    const { picked: pk, order: od, blitz: bz } = answersRef.current;
    const answers: RoamAnswer[] = attempt.kind === "sequence" ? od : attempt.kind === "blitz" ? bz : [pk ?? -1];
    // The Strike: three rising pulses start the moment the answer is given and
    // run while the server marks it, so the wait is the suspense.
    const strike = startStrike({ pulse: (i) => crystal.current?.pulse(i) });
    try {
      const v = await gameStore.submit(attempt, answers);
      await strike.done;
      if (!mounted.current) return;
      const win = isWin(v);
      crystal.current?.resolve(win);
      playResolve(win);
      setVerdict(v);
      setPhase("reveal");
      const line = resultTitle(v);
      announce(v.grade ? `${line.text} ${v.grade}.` : line.text);
      if (v.can_retry) refreshBag();
      if (v.leveled_up) wardenVoice.prepare(levelMoment(ctx(), v.after, v.rank_up));
      const m = v.late ? lateMoment(ctx(), point) : reactionMoment(ctx(), win, point, attempt.kind, attempt.kind === "blitz" ? v : null);
      wardenVoice.speak(m, 5000).catch(() => {});
    } catch (error) {
      // The answer is safe to send again; say so rather than dropping the player's work.
      strike.cancel();
      if (mounted.current) setPhase({ failed: `Couldn't send your answer: ${(error as Error).message}. Open the point again to retry.` });
    }
  }, [attempt, point, setPhase, refreshBag]);

  // The server's clock: when it runs out, send whatever was answered.
  useEffect(() => {
    if (phase !== "playing" || !deadline) return;
    const timer = setTimeout(() => submit(), Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [phase, deadline, submit]);

  const question = attempt?.kind === "blitz" ? showing : 0;

  const buy = async (kind: "fifty" | "time") => {
    if (!attempt) return;
    setHinting(true);
    setHintProblem(null);
    try {
      const h = await gameStore.hint(attempt, kind, question);
      playSound("coin");
      if (h.bag) setBag(h.bag);
      wardenVoice.speak(hintMoment(ctx(), kind), 3000).catch(() => {});
      if (h.removed) setRemoved((r) => ({ ...r, [question]: h.removed ?? [] }));
      if (kind === "time") {
        setBoughtTime(true);
        const until = h.remaining_s != null ? Date.now() + h.remaining_s * 1000 : parseServerDate(h.deadline);
        if (until) setDeadline(until);
      }
    } catch (error) {
      setHintProblem((error as Error).message);
    } finally {
      setHinting(false);
    }
  };

  const retry = async () => {
    if (!attempt) return;
    const here = gameStore.get().fix;
    if (!here) return;
    try {
      const next = await gameStore.client.retry(attempt.attempt_id, here.lat, here.lng, here.accuracy);
      setBag((b) => ({ ...b, retry: (b.retry ?? 1) - 1 }));
      crystal.current?.reset();
      startWith(next);
    } catch (error) {
      setHintProblem((error as Error).message);
    }
  };

  const collect = () => {
    if (!verdict) return;
    const reward = rewardFromVerdict(verdict, point, gameStore.get().me);
    // The level line is the Warden's, said 2.4 s into the ceremony.
    if (verdict.leveled_up) reward.speakLevel = () => wardenVoice.speak(levelMoment(ctx(), verdict.after, verdict.rank_up), 5000).catch(() => {});
    onReward(reward);
  };

  const leave = () => {
    if (phaseRef.current === "playing") {
      Alert.alert("Leave this challenge?", "The clock keeps running. You can come back while it does.", [
        {
          text: "Leave",
          style: "destructive",
          onPress: () => {
            wardenVoice.quiet();
            onClose();
          },
        },
        { text: "Keep playing", style: "cancel" },
      ]);
      return;
    }
    // On the reveal the answer is already in: leaving still counts the day's quests.
    if (verdict) celebrate(rewardFromVerdict(verdict, point, gameStore.get().me));
    wardenVoice.quiet();
    onClose();
  };
  const leaveRef = useRef(leave);
  useEffect(() => {
    leaveRef.current = leave;
  });
  useEffect(() => {
    encounterGuard.current = () => {
      leaveRef.current();
      return true;
    };
    return () => {
      encounterGuard.current = null;
    };
  }, []);

  const total = (attempt?.seconds ?? 20) + (boughtTime ? prices?.time_s ?? 10 : 0);
  const reveal = phase === "reveal" ? verdict?.reveal ?? null : null;
  const phaseName = typeof phase === "object" ? "failed" : phase;

  // The scrim under the question: lighter while the shrine is shown, darker once you play.
  const scrim = useSharedValue(scrimOpacity("opening") / 0.7);
  useEffect(() => {
    scrim.value = withTiming(scrimOpacity(phaseName) / 0.7, { duration: 300, easing: Easing.inOut(Easing.cubic) });
  }, [phaseName, scrim]);
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));

  return (
    <View style={[styles.root, { backgroundColor: color }]}>
      <LinearGradient colors={[color, edgeOf(color)]} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <Animated.View style={[StyleSheet.absoluteFill, scrimStyle]} pointerEvents="none">
        <LinearGradient colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.7)"]} style={StyleSheet.absoluteFill} />
      </Animated.View>

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <GameIconButton icon="close" color={GP.navy} diameter={42} onPress={leave} accessibilityLabel="Leave" />
        <View style={styles.headRight}>
          <Text style={styles.place} numberOfLines={1} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {point.name}
          </Text>
          <View style={styles.chips}>
            <Chip text={tierName(point.tier)} color={tierColor(point.tier)} />
            <Chip text={attempt?.realm_name ?? challengeLabel(point.challenge)} color={realmColor(attempt?.realm ?? point.realm)} />
          </View>
        </View>
      </View>

      {said ? <WardenLine key={said.id} text={said.text} compact={phase === "playing"} tint={realmColor(gameStore.get().me?.faction)} /> : null}

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 12 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.stage}>
          <ShrineCrystal tint={tierColor(point.tier)} ref={crystal} />
          {phase === "opening" ? (
            <View style={styles.opening} accessible accessibilityLabel="The shrine is waking" accessibilityLiveRegion="polite">
              <ActivityIndicator color="#FFF" size="large" />
              <Text style={styles.openingText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                The shrine is waking…
              </Text>
            </View>
          ) : null}
        </View>

        {typeof phase === "object" ? (
          <GamePanel>
            <View style={{ gap: 12 }}>
              <Text style={styles.failTitle}>Not this time</Text>
              <Text style={styles.failText}>{phase.failed}</Text>
              <GameButton title="Back to the map" color={GP.sky} onPress={onClose} />
            </View>
          </GamePanel>
        ) : attempt ? (
          <View style={{ gap: 14 }}>
            {phase !== "reveal" ? (
              <>
                <DeadlineBar deadline={deadline} total={total} />
                {phase === "playing" && prices ? (
                  <HintBar
                    coins={coins}
                    prices={prices}
                    bag={bag}
                    canFifty={attempt.kind !== "sequence" && !removed[question]}
                    canTime={!boughtTime}
                    busy={hinting}
                    onFifty={() => buy("fifty")}
                    onTime={() => buy("time")}
                  />
                ) : null}
                {hintProblem ? <Text style={styles.hintProblem}>{hintProblem}</Text> : null}
              </>
            ) : verdict ? (
              <ResultLine verdict={verdict} />
            ) : null}

            {attempt.kind === "sequence" ? (
              <SequenceCard
                prompt={attempt.challenge.prompt ?? ""}
                beats={attempt.challenge.beats ?? []}
                order={order}
                reveal={reveal?.correct_order ?? null}
                onTap={(id) => {
                  if (phase !== "playing") return;
                  // Sequence tap: the tap sound and a light impact (not a selection tick).
                  pressFeedback();
                  const next = order.includes(id) ? order.slice(0, order.indexOf(id)) : [...order, id];
                  setOrder(next);
                  answersRef.current = { ...answersRef.current, order: next };
                }}
              />
            ) : attempt.kind === "blitz" ? (
              <BlitzCard
                questions={attempt.challenge.questions ?? []}
                showing={showing}
                answers={blitz}
                removed={removed}
                marks={reveal?.marks ?? null}
                correct={reveal?.correct ?? null}
                voice={phase === "playing"}
                onPick={(i) => {
                  if (phase !== "playing") return;
                  const next = [...blitz];
                  next[showing] = i;
                  setBlitz(next);
                  answersRef.current = { ...answersRef.current, blitz: next };
                  if (showing + 1 < (attempt.challenge.questions?.length ?? 0)) setShowing(showing + 1);
                  else submit();
                }}
              />
            ) : attempt.challenge.questions?.[0] ? (
              <TriviaCard
                question={attempt.challenge.questions[0]}
                picked={picked}
                removed={removed[0] ?? []}
                correct={reveal?.correct?.[0] ?? null}
                voice={phase === "playing"}
                onPick={(i) => {
                  if (phase !== "playing" || picked !== null) return;
                  setPicked(i);
                  answersRef.current = { ...answersRef.current, picked: i };
                  submit();
                }}
              />
            ) : null}

            {phase === "playing" && attempt.kind === "sequence" ? (
              <GameButton title="Lock it in" color={GP.mint} disabled={order.length < (attempt.challenge.beats?.length ?? 4)} onPress={submit} />
            ) : null}
            {phase === "submitting" ? <ActivityIndicator color="#FFF" accessibilityLabel="Marking your answer" /> : null}
            {phase === "reveal" && verdict?.can_retry ? (
              <GameButton title={secondChanceLabel(bag.retry ?? 0)} color={PURPLE} onPress={retry} icon={<Ionicons name="refresh" size={18} color="#FFF" />} />
            ) : null}
            {phase === "reveal" ? (
              <Animated.View entering={FadeIn.duration(300)}>
                <GameButton title="Collect" color={GP.sun} onPress={collect} />
              </Animated.View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** The Warden's line under the header (WardenBubble); compact while the clock runs. */
function WardenLine({ text, compact, tint }: { text: string; compact: boolean; tint: string }) {
  return (
    <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOut.duration(160)} style={styles.bubbleRow} accessibilityLiveRegion="polite">
      <View style={[styles.wardenBadge, { backgroundColor: tint }]} importantForAccessibility="no-hide-descendants">
        <Ionicons name="eye" size={compact ? 14 : 18} color="#FFF" />
      </View>
      <Pressable
        style={styles.bubble}
        onPress={() => wardenVoice.quiet()}
        accessibilityRole="button"
        accessibilityLabel={`The Warden says: ${text}`}
        accessibilityHint="Double tap to dismiss">
        <Text style={[styles.bubbleText, compact && { fontSize: 13 }]} numberOfLines={compact ? 2 : 4}>
          {text}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function ResultLine({ verdict }: { verdict: RoamVerdict }) {
  const line = resultTitle(verdict);
  const chip = verdict.grade ? { sun: GP.sun, mint: GP.mint, sky: GP.sky }[gradeColorKey(verdict.grade)] : null;
  return (
    <Pop from={0.5} response={0.45} damping={0.75} style={{ gap: 4, alignItems: "center" }}>
      <GameTitle text={line.text} size={line.size} edge={edgeOf(line.win ? GP.mint : GP.berry)} />
      {/* The throw grade: speed as skill. */}
      {verdict.grade && chip ? (
        <Pop from={0.3} response={0.4} damping={0.7} delayMs={120}>
          <View accessible accessibilityLabel={`Grade: ${verdict.grade}`}>
            <Chip text={verdict.grade} color={chip} />
          </View>
        </Pop>
      ) : null}
    </Pop>
  );
}

/** The countdown every challenge runs against: the server's deadline, refreshed every 0.1 s; the whole row turns berry under 6 s. */
function DeadlineBar({ deadline, total }: { deadline: number; total: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(tick);
  }, []);
  const left = deadline ? Math.max(0, (deadline - now) / 1000) : total;
  const { seconds, hot } = deadlineView(left);
  const frac = total > 0 ? Math.min(1, left / total) : 0;
  useEffect(() => {
    if (hot) announce("Under six seconds left.");
  }, [hot]);
  const tint = hot ? GP.berry : "#FFFFFF";
  return (
    <View style={styles.deadline} accessible accessibilityRole="timer" accessibilityLabel={`${seconds} seconds left`}>
      <Ionicons name="timer" size={18} color={tint} />
      <View style={styles.deadlineTrack}>
        <View style={{ width: `${frac * 100}%`, height: 12, borderRadius: 6, backgroundColor: hot ? GP.berry : GP.sun }} />
      </View>
      <Text style={[styles.deadlineText, { color: tint }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {seconds}
      </Text>
    </View>
  );
}

/** Help, for coins or bag items. Shown only while a question is open. */
function HintBar({
  coins,
  prices,
  bag,
  canFifty,
  canTime,
  busy,
  onFifty,
  onTime,
}: {
  coins: number;
  prices: { fifty: number; time: number; time_s: number };
  bag: Record<string, number>;
  canFifty: boolean;
  canTime: boolean;
  busy: boolean;
  onFifty: () => void;
  onTime: () => void;
}) {
  return (
    <View style={[styles.hints, busy && { opacity: 0.6 }]}>
      <HintButton label="50/50" spoken="Fifty fifty" item={bag.fifty ?? 0} cost={prices.fifty} coins={coins} allowed={canFifty} busy={busy} onPress={onFifty} />
      <HintButton label={`+${prices.time_s}s`} spoken={`Plus ${prices.time_s} seconds`} item={bag.time ?? 0} cost={prices.time} coins={coins} allowed={canTime} busy={busy} onPress={onTime} />
      <View style={{ flex: 1 }} />
      <View style={styles.balance} accessible accessibilityLabel={`${coins} coins`}>
        <GameCoin size={18} />
        <Text style={styles.balanceText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {coins}
        </Text>
      </View>
    </View>
  );
}

/** A small purple game button: the label, then "bag ×n" when the bag has one (spent first), else a coin and its price. */
function HintButton({
  label,
  spoken,
  item,
  cost,
  coins,
  allowed,
  busy,
  onPress,
}: {
  label: string;
  spoken: string;
  item: number;
  cost: number;
  coins: number;
  allowed: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const disabled = hintDisabled({ allowed, item, coins, cost, busy });
  const face = disabled ? "#9E9E9E" : PURPLE;
  return (
    <Pressable
      onPressIn={() => {
        if (!disabled) pressFeedback();
      }}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Hint: ${spoken}, ${item > 0 ? `${item} in your bag` : `${cost} coins`}`}
      accessibilityState={{ disabled }}>
      {({ pressed }) => (
        <View style={{ paddingBottom: 4, transform: [{ translateY: pressed ? 1 : 0 }] }}>
          <View style={[StyleSheet.absoluteFill, { top: 4, borderRadius: 14, backgroundColor: edgeOf(face) }]} />
          <LinearGradient colors={[withAlpha(face, 0.92), face]} style={[styles.hintFace, { transform: [{ translateY: pressed ? 3 : 0 }] }]}>
            <View pointerEvents="none" style={styles.hintGloss} />
            <Text style={styles.hintText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {label}
            </Text>
            {item > 0 ? (
              <>
                <Ionicons name="bag" size={12} color="#FFF" />
                <Text style={styles.hintText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  ×{item}
                </Text>
              </>
            ) : (
              <>
                <GameCoin size={16} />
                <Text style={styles.hintText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {cost}
                </Text>
              </>
            )}
          </LinearGradient>
        </View>
      )}
    </Pressable>
  );
}

const CHOICE_SPRING = springOf(0.35, 0.6);

/** One answer button in one of four fixed colours, so "the blue one" means the same to every player (ChoiceButton). */
function ChoiceButton({ text, index, state, onPress }: { text: string; index: number; state: ChoiceState; onPress: () => void }) {
  const look = choiceLook(state);
  const face = look.face === "mint" ? GP.mint : look.face === "berry" ? GP.berry : look.face === "grey" ? GREY : CHOICE_COLORS[index % CHOICE_COLORS.length];
  const scale = useSharedValue(look.scale);
  const opacity = useSharedValue(look.opacity);
  useEffect(() => {
    scale.value = withSpring(look.scale, CHOICE_SPRING);
    opacity.value = withTiming(look.opacity, { duration: 300, easing: Easing.inOut(Easing.cubic) });
  }, [look.scale, look.opacity, scale, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
  const locked = state !== "idle";
  const spoken = state === "right" ? `${text}, correct answer` : state === "wrong" ? `${text}, your answer, wrong` : state === "picked" ? `${text}, selected` : text;
  return (
    <Animated.View style={animated}>
      <Pressable
        onPressIn={() => {
          if (!locked) pressFeedback();
        }}
        onPress={onPress}
        disabled={locked}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityState={{ selected: state === "picked" || state === "right", disabled: state === "removed" }}>
        {({ pressed }) => (
          <View style={{ paddingBottom: 6, transform: [{ translateY: pressed ? 1 : 0 }] }}>
            <View style={[StyleSheet.absoluteFill, { top: 6, borderRadius: 20, backgroundColor: edgeOf(face) }]} />
            <LinearGradient colors={[withAlpha(face, 0.92), face]} style={[styles.choiceFace, { transform: [{ translateY: pressed ? 5 : 0 }] }]}>
              <View pointerEvents="none" style={styles.choiceGloss} />
              <Text style={styles.choiceText} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {text}
              </Text>
              {state === "right" ? <Ionicons name="checkmark-circle" size={22} color="#FFF" /> : null}
              {state === "wrong" ? <Ionicons name="close-circle" size={22} color="#FFF" /> : null}
              {state === "dim" ? <Ionicons name="ellipse-outline" size={22} color="#FFF" style={{ opacity: 0 }} /> : null}
              {state === "picked" ? <Ionicons name="checkmark" size={18} color="#FFF" /> : null}
            </LinearGradient>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

function TriviaCard({
  question,
  picked,
  removed,
  correct,
  voice,
  onPick,
}: {
  question: AttemptQuestion;
  picked: number | null;
  removed: number[];
  correct: number | null;
  /** Offer the spoken answer (only while the clock runs). */
  voice: boolean;
  onPick: (i: number) => void;
}) {
  return (
    <View style={{ gap: 14 }}>
      {question.clue ? (
        <View style={styles.clue} accessible accessibilityLabel={`Emoji clue: ${question.clue}`}>
          <Text style={styles.clueText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {question.clue}
          </Text>
        </View>
      ) : null}
      <Text style={styles.question}>{question.q}</Text>
      {voice && correct === null && picked === null ? <SayItButton key={question.id} choices={question.choices} removed={removed} onPick={onPick} /> : null}
      {question.choices.map((choice, i) => (
        <ChoiceButton key={`${question.id}-${i}`} text={choice} index={i} state={choiceState(i, picked, removed, correct)} onPress={() => onPick(i)} />
      ))}
    </View>
  );
}

const REORDER = springOf(0.5, 0.8);

/**
 * Tap the moments in the order they happened. Tapping is more reliable than
 * dragging on a phone held up in the street, and tapping a numbered one again
 * takes it back. After the verdict the beats rearrange themselves.
 */
function SequenceCard({
  prompt,
  beats,
  order,
  reveal,
  onTap,
}: {
  prompt: string;
  beats: { id: string; text: string }[];
  order: string[];
  reveal: string[] | null;
  onTap: (id: string) => void;
}) {
  const shown = reveal ? reveal.map((id) => beats.find((b) => b.id === id)).filter((b): b is { id: string; text: string } => !!b) : beats;
  return (
    <View style={{ gap: 12 }}>
      <Text style={[styles.question, { fontSize: 24, lineHeight: 30 }]}>{prompt}</Text>
      <Text style={styles.sub}>{reveal ? "The right order:" : "Tap them in order, first to last."}</Text>
      {shown.map((beat) => {
        const n = order.indexOf(beat.id) + 1;
        const right = reveal ? reveal.indexOf(beat.id) + 1 : 0;
        const wasRight = !!reveal && n === right;
        const badge = reveal ? (wasRight ? GP.mint : GP.sunDeep) : n ? GP.skyDeep : "#B3B3B3";
        const spoken = reveal ? `${beat.text}, number ${right}, ${wasRight ? "you had it right" : "you had it in the wrong place"}` : `${beat.text}${n ? `, number ${n}` : ""}`;
        return (
          <Animated.View key={beat.id} layout={LinearTransition.springify().stiffness(REORDER.stiffness).damping(REORDER.damping)}>
            <Pressable onPress={() => onTap(beat.id)} accessibilityRole="button" accessibilityLabel={spoken} style={styles.beat}>
              <View style={[styles.beatBadge, { backgroundColor: badge }]}>
                <Text style={styles.beatBadgeText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {reveal ? right : n || ""}
                </Text>
              </View>
              <Text style={styles.beatText}>{beat.text}</Text>
              {reveal ? (
                <Ionicons name={wasRight ? "checkmark-circle" : "arrow-redo-circle"} size={22} color={wasRight ? GP.mint : GP.sunDeep} />
              ) : null}
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

/** Five questions, one clock. The answers go to the server together at the end, so the key is never on the phone. */
function BlitzCard({
  questions,
  showing,
  answers,
  removed,
  marks,
  correct,
  voice,
  onPick,
}: {
  questions: AttemptQuestion[];
  showing: number;
  answers: number[];
  removed: Record<number, number[]>;
  marks: boolean[] | null;
  correct: number[] | null;
  voice: boolean;
  onPick: (i: number) => void;
}) {
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.pips} accessible accessibilityLabel={marks ? `${marks.filter(Boolean).length} of ${questions.length} right` : `Question ${Math.min(showing + 1, questions.length)} of ${questions.length}`}>
        {questions.map((q, i) => (
          <View
            key={q.id}
            style={[
              styles.pip,
              {
                backgroundColor: marks ? (marks[i] ? GP.mint : GP.berry) : i < showing || answers[i] >= 0 ? GP.sun : i === showing ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.25)",
              },
            ]}
          />
        ))}
      </View>
      {marks ? (
        <View style={styles.summary}>
          {questions.map((q, i) => {
            const ok = !!marks[i];
            const right = correct && correct[i] >= 0 && correct[i] < q.choices.length ? q.choices[correct[i]] : null;
            return (
              <View key={q.id} style={styles.summaryRow} accessible accessibilityLabel={`${q.q}${right ? `, answer ${right}` : ""}, ${ok ? "right" : "wrong"}`}>
                <Ionicons name={ok ? "checkmark-circle" : "close-circle"} size={20} color={ok ? GP.mint : GP.berry} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.summaryQ}>{q.q}</Text>
                  {right ? <Text style={[styles.summaryA, { color: ok ? GP.mint : GP.sun }]}>{right}</Text> : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : questions[showing] ? (
        <Animated.View key={showing} entering={SlideInRight.duration(250)} exiting={SlideOutLeft.duration(250)}>
          <TriviaCard question={questions[showing]} picked={null} removed={removed[showing] ?? []} correct={null} voice={voice} onPick={onPick} />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10, paddingHorizontal: 16, paddingBottom: 4 },
  headRight: { flex: 1, alignItems: "flex-end", gap: 6 },
  place: {
    fontFamily: GF.display,
    fontSize: 20,
    color: "#FFF",
    textAlign: "right",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
  chips: { flexDirection: "row", gap: 6 },
  bubbleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 10, paddingHorizontal: 16 },
  wardenBadge: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFF" },
  bubble: { flex: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.95)" },
  bubbleText: { fontFamily: GF.body, fontSize: 15, color: GP.ink },
  content: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 8, gap: 14 },
  stage: { flex: 1, minHeight: 130, alignItems: "center", justifyContent: "center" },
  opening: { position: "absolute", bottom: 0, alignItems: "center", gap: 8 },
  openingText: { fontFamily: GF.display, fontSize: 20, color: "#FFF", textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 4 },
  failTitle: { fontFamily: GF.display, fontSize: 24, color: GP.ink },
  failText: { fontFamily: GF.regular, fontSize: 16, color: GP.ink },
  deadline: { flexDirection: "row", alignItems: "center", gap: 8 },
  deadlineTrack: { flex: 1, height: 12, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.18)", overflow: "hidden" },
  deadlineText: { fontFamily: GF.display, fontSize: 18, width: 30, textAlign: "right", fontVariant: ["tabular-nums"] },
  hints: { flexDirection: "row", alignItems: "center", gap: 10 },
  hintFace: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, overflow: "hidden" },
  hintGloss: { position: "absolute", top: 5, left: 10, right: 10, height: 10, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.28)" },
  hintText: { fontFamily: GF.display, fontSize: 16, color: "#FFF", textShadowColor: "rgba(0,0,0,0.28)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 0.1 },
  balance: { flexDirection: "row", alignItems: "center", gap: 4 },
  balanceText: { fontFamily: GF.display, fontSize: 16, color: "#FFF", fontVariant: ["tabular-nums"] },
  hintProblem: { fontFamily: GF.body, fontSize: 13, color: GP.sun },
  clue: { alignItems: "center", paddingVertical: 14, borderRadius: 24, backgroundColor: GP.cream, marginBottom: 5, ...dropEdge(edgeOf(GP.cream), 5) },
  clueText: { fontSize: 64, lineHeight: 78 },
  question: {
    fontFamily: GF.display,
    fontSize: 26,
    lineHeight: 32,
    color: "#FFF",
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 0.1,
  },
  sub: { fontFamily: GF.body, fontSize: 15, color: "rgba(255,255,255,0.85)" },
  choiceFace: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 20, overflow: "hidden" },
  choiceGloss: { position: "absolute", top: 5, left: 10, right: 10, height: 10, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.28)" },
  choiceText: {
    flex: 1,
    fontFamily: GF.display,
    fontSize: 20,
    color: "#FFF",
    textAlign: "left",
    textShadowColor: "rgba(0,0,0,0.28)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 0.1,
  },
  beat: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, marginBottom: 4, borderRadius: 18, backgroundColor: GP.cream, ...dropEdge(edgeOf(GP.cream), 4) },
  beatBadge: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "rgba(255,255,255,0.7)" },
  beatBadgeText: { fontFamily: GF.display, fontSize: 20, color: "#FFF" },
  beatText: { flex: 1, fontFamily: GF.body, fontSize: 17, color: GP.ink },
  pips: { flexDirection: "row", gap: 6 },
  pip: { flex: 1, height: 8, borderRadius: 4 },
  summary: { gap: 8, padding: 12, borderRadius: 18, backgroundColor: withAlpha(GP.navy, 0.7) },
  summaryRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  summaryQ: { fontFamily: GF.body, fontSize: 14, color: "#FFF" },
  summaryA: { fontFamily: GF.display, fontSize: 15 },
});
