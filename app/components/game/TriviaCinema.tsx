// Trivia "bigger than life" (Mark, 14 Nov 2026: "realistic pictures ... very visual ... big pictures,
// and not just a bunch of questions. We want to be able to take this trivia and put it on social
// media"). When a tile is dealt by topic (the server's `trivia_topics`), its question is drawn over
// its picture, full-bleed, as Wale's screen 59284 starts it (the art, "COSQUEST · DAILY TRIVIA",
// the title) carried down the whole screen: a slow push-in on the picture, dark scrims for the
// words, his frosted glass made dark, his counter, segments, type and lettered 2 x 2 grid.
//
// The order things happen: the picture's colour at once, the picture fading in over it, the words
// rising in, the answers cascading. On the answer: the wrong cards dim away, the dim over the picture
// lifts, the right one lights (the server names it on a topic tile) and the line under it says so,
// the points in a ring. Then Share this question (its 9:16 card, made by the server) and Next.
//
// The game is the same: useRunQuiz (Run.tsx) holds the question's state for both looks. Without a
// topic or a picture, TriviaPlay.tsx draws the question as build 28 did. The pure half is
// features/game/triviaVisual.ts; the server's side is
// cosquest-review/realism-20261111/experiments/trivia-visual/CONTRACT.md.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, PixelRatio, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONTS } from "@/constants/fonts";
import { lookTierDecision } from "@/features/game/lookTier";
import { boardPlaceText, clock, isWorldBoard, type RunBoard, type RunFinish, type RunPoint, sequenceLine, signed, stakeLine, triviaSub } from "@/features/game/run";
import { useGame } from "@/features/game/runtime";
import { settle } from "@/features/game/spring";
import { deadlineView } from "@/features/game/strike";
import { halfWidth, letterOf, nextTriviaPoint, type Segment, stopwatch, TRIVIA, TRIVIA_RADIUS, TRIVIA_SIZE, twoDigits } from "@/features/game/triviaLook";
import {
  type ArtSize,
  type ArtTier,
  artColor,
  artUri,
  attemptArts,
  canShareQuestion,
  CINEMA,
  type CardMark,
  cardMark,
  pickArtSize,
  questionArt,
  revealLine,
  rightChoice,
  rightOf,
  rightOrder,
  topicLabel,
  topicsPlayed,
} from "@/features/game/triviaVisual";
import type { AttemptQuestion, TriviaArt } from "@/features/game/wire";
import { CostQuestGame } from "@/modules/costquest-game/src";

import { announce, MAX_FONT_SCALE, pressFeedback } from "./kit";
import { runModel, useRun } from "./runModel";
import type { useRunQuiz } from "./Run";
import SayItButton from "./SayItButton";
import { challengeName } from "./theme";
import { Segments, TriviaButton } from "./TriviaKit";

const C = CINEMA;
const T = TRIVIA;
const SETTLE = settle(0.28);
/** The push-in: slow enough to feel like a film, never long enough to notice it stop. */
const KEN_BURNS_MS = 18000;
const KEN_BURNS_SCALE = 1.12;

type Quiz = ReturnType<typeof useRunQuiz>;

// ---------- the picture ----------

/** The phone's quality tier for pictures; null on the web (no memory reading, a page is not a game). */
function artTier(): ArtTier {
  if (Platform.OS === "web") return null;
  return lookTierDecision({ physicalMemory: CostQuestGame?.physicalMemory, env: process.env.EXPO_PUBLIC_LOOK_TIER ?? null }).tier;
}

/** Which size of every picture this screen gets (features/game/triviaVisual.ts pickArtSize). */
export function useArtSize(): { size: ArtSize; tier: ArtTier } {
  const { width, height } = useWindowDimensions();
  const tier = useMemo(() => artTier(), []);
  return { size: pickArtSize({ width, height, scale: PixelRatio.get(), tier }), tier };
}

/** Fetch pictures before they are needed (a quick-fire's five, the next tile's when the server puts it on the tile). */
export function prefetchArt(arts: (TriviaArt | null | undefined)[], size: ArtSize) {
  const urls = arts.map((a) => artUri(a, size)).filter((u): u is string => !!u);
  if (urls.length) void Image.prefetch(urls, "memory-disk").catch(() => false);
}

/**
 * The picture, full-bleed behind the whole screen: its colour at once, the picture fading in over it,
 * a slow push-in (none with Reduce Motion or on a low tier phone), the dark scrims for the words, and
 * a dim over the lot that lifts when `lifted` (the reveal). No picture: a dark gradient in `tint`.
 */
export function ArtBackdrop({ art, tint, lifted, blurred }: { art: TriviaArt | null; tint?: string; lifted?: boolean; blurred?: boolean }) {
  const { size, tier } = useArtSize();
  const reduce = useReducedMotion();
  const still = reduce || tier === "low" || blurred;
  const uri = artUri(art, size);
  const zoom = useSharedValue(1);
  const dim = useSharedValue(1);
  useEffect(() => {
    if (still) {
      zoom.set(1);
      return;
    }
    zoom.set(withRepeat(withTiming(KEN_BURNS_SCALE, { duration: KEN_BURNS_MS, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [still, zoom]);
  useEffect(() => {
    dim.set(withTiming(lifted ? 0 : 1, { duration: reduce ? 0 : 700, easing: Easing.out(Easing.cubic) }));
  }, [lifted, reduce, dim]);
  const push = useAnimatedStyle(() => ({ transform: [{ scale: zoom.get() }, { translateY: (zoom.get() - 1) * -60 }] }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.get() }));
  const base = artColor(art, C.fallback);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: base, overflow: "hidden" }]}>
      {uri ? (
        <Animated.View style={[StyleSheet.absoluteFill, push]}>
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            contentPosition="top"
            cachePolicy="memory-disk"
            priority="high"
            transition={{ duration: reduce ? 0 : 600, effect: "cross-dissolve" }}
            blurRadius={blurred ? 24 : 0}
            accessible={!!art?.alt && !blurred}
            accessibilityLabel={art?.alt ?? undefined}
            accessibilityRole="image"
          />
        </Animated.View>
      ) : (
        <LinearGradient colors={[tint ?? "#3A2D5C", base, "#06080C"]} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={StyleSheet.absoluteFill} />
      )}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: blurred ? "rgba(6,8,12,0.55)" : C.dim }, blurred ? null : dimStyle]} />
      <LinearGradient colors={[C.scrimTop, "rgba(6,8,12,0)"]} style={styles.scrimTop} />
      <LinearGradient colors={["rgba(6,8,12,0)", C.scrimMid, C.scrimBottom]} locations={[0, 0.3, 1]} style={styles.scrimBottom} />
    </View>
  );
}

// ---------- the bar ----------

function DarkSquare({ icon, label, onPress, testID }: { icon: "arrow-back" | "close"; label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      onPressIn={pressFeedback}
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [styles.square, { transform: [{ scale: pressed ? 0.94 : 1 }] }]}>
      <Ionicons name={icon} size={22} color={C.ink} />
    </Pressable>
  );
}

/** Wale's top bar, light on dark: back, "COSQUEST" over the screen's name, close; transparent over the picture. */
export function CinemaTopBar({ title, onBack, onClose, backLabel = "Back", closeLabel = "Leave trivia", right }: { title: string; onBack?: (() => void) | null; onClose?: (() => void) | null; backLabel?: string; closeLabel?: string; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 10 }]}>
      {onBack ? <DarkSquare icon="arrow-back" label={backLabel} onPress={onBack} testID="trivia-back" /> : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.brand} maxFontSizeMultiplier={1.2}>
          COSQUEST
        </Text>
        <Text style={styles.barTitle} numberOfLines={1} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
          {title}
        </Text>
      </View>
      {right}
      {onClose ? <DarkSquare icon="close" label={closeLabel} onPress={onClose} testID="trivia-close" /> : null}
    </View>
  );
}

/** The run's clock and score, small, in the bar: the run is still timed while you look. */
function RunChip() {
  const s = useRun();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!s.run) return null;
  const left = s.localEnd !== null ? (s.localEnd - now) / 1000 : s.run.remaining_s;
  return (
    <View style={styles.chip} accessible accessibilityLabel={`Run: ${clock(left)} left, ${s.run.score} points`}>
      <Ionicons name="time-outline" size={14} color={C.ink} />
      <Text style={styles.chipText} maxFontSizeMultiplier={1.2}>
        {clock(left)} · {s.run.score}
      </Text>
    </View>
  );
}

function Stopwatch({ deadline }: { deadline: number }) {
  const [left, setLeft] = useState(() => Math.max(0, (deadline - Date.now()) / 1000));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, (deadline - Date.now()) / 1000)), 250);
    return () => clearInterval(t);
  }, [deadline]);
  const { seconds, hot } = deadlineView(left);
  useEffect(() => {
    if (hot) announce("Under six seconds left.");
  }, [hot]);
  const color = hot ? C.miss : C.ink;
  return (
    <View style={styles.metaRight} accessible accessibilityRole="timer" accessibilityLabel={`${seconds} seconds left`}>
      <Ionicons name="stopwatch-outline" size={17} color={color} />
      <Text style={[styles.metaText, { color }]} maxFontSizeMultiplier={1.2}>
        {stopwatch(left)}
      </Text>
    </View>
  );
}

// ---------- one question ----------

/**
 * A question over its picture. `opened` is the counter as the run stood when it opened, `marks` the
 * segments now, `then` where the main button goes after the answer.
 */
export function CinemaQuestion({
  point,
  q,
  number,
  marks,
  then,
  onBoard,
  onNext,
  onLeave,
}: {
  point: RunPoint;
  q: Quiz;
  number: { n: number; total: number };
  marks: Segment[];
  then: "next" | "board" | "score";
  onBoard: () => void;
  onNext: () => void;
  onLeave: (() => void) | null;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const s = useRun();
  const { size } = useArtSize();
  const { phase, attempt, result } = q;
  const done = phase === "result";
  const blitz = attempt?.kind === "blitz";
  const art = attempt ? questionArt(attempt, blitz ? q.showing : 0) : (point.art ?? null);
  const topic = { topic: attempt?.topic ?? point.topic, topic_name: attempt?.topic_name ?? point.topic_name };
  const question = attempt?.challenge.questions?.[0] ?? null;

  // A quick-fire's five pictures come down together as it opens; the next tile's as this one is answered.
  useEffect(() => {
    if (attempt) prefetchArt(attemptArts(attempt), size);
  }, [attempt, size]);
  useEffect(() => {
    if (done) prefetchArt([nextTriviaPoint(runModel.get().run, point.idx)?.art], size);
  }, [done, point.idx, size]);

  const verdict = done && result ? (result.late ? "late" : result.earned > 0 || result.correct > 0 ? "right" : "wrong") : null;
  const right = done && result ? rightChoice(result.reveal, 0, q.picked) : null;
  const pickedText = question && q.picked !== null ? (question.choices[q.picked] ?? null) : null;
  const rightText = question && right !== null ? (question.choices[right] ?? null) : null;
  const line =
    done && result
      ? attempt?.kind === "sequence"
        ? { tone: result.earned > 0 ? "right" : "miss", text: sequenceLine(result.reveal.positions_right ?? 0, attempt.challenge.beats?.length ?? 4) }
        : revealLine(result, pickedText, rightText)
      : null;
  const shareable = !!attempt && canShareQuestion({ topic: topic.topic, answered: done }) && !blitz;
  const shareKey = attempt ? `${attempt.attempt_id}:0` : "";

  useEffect(() => {
    if (line) announce(line.text);
  }, [line?.text]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <ArtBackdrop art={art} lifted={done} />
      <CinemaTopBar title="Daily trivia" onBack={phase === "submitting" ? null : onBoard} backLabel="All questions" onClose={phase === "submitting" ? null : onLeave} right={<RunChip />} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.pad, { flexGrow: 1, justifyContent: "flex-end", paddingTop: Math.round(height * 0.16), paddingBottom: insets.bottom + 24, gap: 12 }]}
        showsVerticalScrollIndicator={false}>
        <Rise i={0}>
          <Text style={styles.kicker} maxFontSizeMultiplier={1.3}>
            COSQUEST · DAILY TRIVIA
          </Text>
        </Rise>
        <Rise i={1} style={styles.chips}>
          <View style={styles.topicChip} accessible accessibilityLabel={`Topic: ${topicLabel(topic)}`}>
            <Text style={styles.topicText} maxFontSizeMultiplier={1.2}>
              {topicLabel(topic)}
            </Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipText} maxFontSizeMultiplier={1.2}>
              {challengeName(attempt?.kind ?? point.kind ?? "trivia")} · {point.value}
              {q.staked ? " · STAKED" : ""}
            </Text>
          </View>
        </Rise>
        <Rise i={2} style={styles.meta}>
          <Text style={styles.kicker} maxFontSizeMultiplier={1.3}>
            QUESTION {twoDigits(number.n)} / {twoDigits(number.total)}
          </Text>
          {phase === "playing" ? (
            <Stopwatch deadline={q.deadline} />
          ) : phase === "submitting" || done ? (
            <Animated.View entering={FadeIn.duration(200)} style={styles.metaRight}>
              <Ionicons name="lock-closed-outline" size={15} color={C.muted} />
              <Text style={[styles.metaText, { color: C.muted }]}>Answer locked</Text>
            </Animated.View>
          ) : null}
        </Rise>
        <Segments marks={marks} onDark />

        {phase === "opening" ? (
          <View style={styles.loading}>
            <ActivityIndicator color={C.ink} size="large" />
          </View>
        ) : typeof phase === "object" ? (
          <View style={{ gap: 16, paddingTop: 12 }}>
            <Text style={styles.question}>{phase.failed}</Text>
            <TriviaButton title="Back to the questions" onPress={onBoard} />
          </View>
        ) : attempt ? (
          <>
            {attempt.kind === "sequence" ? (
              <CinemaSequence prompt={attempt.challenge.prompt ?? ""} beats={attempt.challenge.beats ?? []} order={q.order} locked={phase !== "playing"} right={done && result ? rightOrder(result.reveal, attempt.challenge.beats ?? []) : null} />
            ) : blitz ? (
              <CinemaBlitz attemptId={attempt.attempt_id} shareable={canShareQuestion({ topic: topic.topic, answered: done })} questions={attempt.challenge.questions ?? []} showing={q.showing} answers={q.blitz} marks={q.reveal?.marks ?? null} correct={q.reveal?.correct ?? null} voice={phase === "playing"} onPick={q.pickBlitz} />
            ) : question ? (
              <CinemaSingle
                kicker={attempt.kind === "quote" ? (attempt.challenge.prompt ?? "Who said it?") : null}
                question={attempt.kind === "quote" ? { ...question, q: `“${question.q}”` } : question}
                picked={q.picked}
                verdict={verdict}
                right={right}
                voice={phase === "playing"}
                onPick={q.pickOne}
              />
            ) : null}

            {attempt.kind === "sequence" && phase === "playing" ? (
              <View style={{ gap: 10 }}>
                {attempt.challenge.beats?.map((b) => (
                  <Beat key={b.id} text={b.text} n={q.order.indexOf(b.id) + 1} locked={false} onPress={() => q.tapBeat(b.id)} />
                ))}
                <TriviaButton title="Lock it in" icon="lock-closed" iconSide="left" disabled={q.order.length < (attempt.challenge.beats?.length ?? 4)} onPress={q.submit} testID="trivia-lock" />
              </View>
            ) : null}
            {phase === "submitting" ? <ActivityIndicator color={C.ink} /> : null}

            {done && result && line ? (
              <Animated.View entering={FadeInDown.delay(250).duration(320)} style={{ gap: 12 }} accessibilityLiveRegion="polite">
                <View style={styles.feedback}>
                  <Ionicons
                    name={line.tone === "right" ? "checkmark-circle" : line.tone === "late" ? "time-outline" : "close-circle"}
                    size={20}
                    color={line.tone === "right" ? "#FFFFFF" : C.miss}
                  />
                  <Text style={[styles.feedbackText, { color: line.tone === "right" ? C.ink : C.miss }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {line.text}
                  </Text>
                </View>
                <Ring text={signed(result.earned)} paid={result.earned > 0} />
                {extras(result).length ? (
                  <Text style={styles.extras} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {extras(result).join("  ·  ")}
                  </Text>
                ) : null}
                <TriviaButton
                  title={then === "next" ? "Next question" : then === "board" ? "All questions" : "See your score"}
                  icon={then === "score" ? "trophy-outline" : "arrow-forward"}
                  iconSide="left"
                  onPress={onNext}
                  testID="trivia-next"
                />
                {shareable ? (
                  <TriviaButton
                    title="Share this question"
                    kind="quiet"
                    icon="share-social-outline"
                    iconSide="left"
                    busy={s.sharingQuestion === shareKey}
                    onPress={() => void runModel.shareQuestion(attempt.attempt_id, 0)}
                    testID="trivia-share-question"
                  />
                ) : null}
                {s.notice ? <Text style={styles.notice}>{s.notice}</Text> : null}
              </Animated.View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** What sits beside the points: the speed and Surge multipliers and a stake's outcome. */
function extras(r: { total: number; earned: number; speed_mult: number; surged: boolean; stake_result?: { stake: number; won: boolean } | null }): string[] {
  const out: string[] = [];
  if (r.earned > 0 && r.speed_mult > 1.01) out.push(`Speed ×${r.speed_mult.toFixed(2)}`);
  if (r.surged) out.push("Surge ×1.5");
  if (r.stake_result) out.push(stakeLine(r.stake_result));
  return out;
}

/** Words rising in, one after another (none with Reduce Motion: Reanimated's entering follows the system). */
function Rise({ i, children, style }: { i: number; children: ReactNode; style?: object }) {
  return (
    <Animated.View entering={FadeInDown.delay(80 + 70 * i).duration(380)} style={style}>
      {children}
    </Animated.View>
  );
}

function Ring({ text, paid }: { text: string; paid: boolean }) {
  const reduce = useReducedMotion();
  const pop = useSharedValue(reduce ? 1 : 0.6);
  useEffect(() => {
    if (!reduce) pop.set(withSpring(1, SETTLE));
  }, [reduce, pop]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: pop.get() }] }));
  return (
    <Animated.View style={[styles.ring, { borderColor: paid ? T.accent : C.track }, style]} accessible accessibilityLabel={`${text} points`}>
      <Text style={styles.ringText} maxFontSizeMultiplier={1.2}>
        {text}
      </Text>
      <Text style={styles.ringSub} maxFontSizeMultiplier={1.2}>
        PTS
      </Text>
    </Animated.View>
  );
}

type Verdict = "right" | "wrong" | "late" | null;

function CinemaSingle({ kicker, question, picked, verdict, right, voice, onPick }: { kicker: string | null; question: AttemptQuestion; picked: number | null; verdict: Verdict; right: number | null; voice: boolean; onPick: (i: number) => void }) {
  return (
    <View style={{ gap: 14 }}>
      {kicker ? (
        <Rise i={3}>
          <Text style={styles.kickerMuted}>{kicker.toUpperCase()}</Text>
        </Rise>
      ) : null}
      {question.clue ? (
        <Rise i={3} style={styles.cluePill}>
          <Text style={styles.clueText} accessibilityLabel={`Emoji clue: ${question.clue}`} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {question.clue}
          </Text>
        </Rise>
      ) : null}
      <Rise i={4}>
        <Text style={styles.question} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {question.q}
        </Text>
      </Rise>
      <AnswerGrid id={question.id} choices={question.choices} picked={picked} verdict={verdict} right={right} onPick={onPick} />
      {voice && picked === null ? (
        <>
          <Text style={styles.hint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Tap an answer to lock it in.
          </Text>
          <SayItButton key={question.id} choices={question.choices} removed={[]} onPick={onPick} />
        </>
      ) : null}
    </View>
  );
}

function AnswerGrid({ id, choices, picked, verdict, right, onPick }: { id: string; choices: string[]; picked: number | null; verdict: Verdict; right: number | null; onPick: (i: number) => void }) {
  const { width } = useWindowDimensions();
  const pills = choices.length === 2;
  const gap = pills ? 12 : TRIVIA_SIZE.answerGap;
  return (
    <View style={[styles.grid, { gap }]}>
      {choices.map((c, i) => (
        <Animated.View key={`${id}-${i}`} entering={FadeInDown.delay(380 + 70 * i).duration(320)} style={{ width: halfWidth(width, gap) }}>
          <AnswerCard pill={pills} letter={letterOf(i)} text={c} mark={cardMark(i, picked, verdict, right)} onPress={() => onPick(i)} />
        </Animated.View>
      ))}
    </View>
  );
}

/**
 * One answer, dark glass. The pick takes a magenta rim while the server marks it; then the right one
 * fills magenta with a tick and settles a touch bigger (yours, or the one you missed), a wrong pick
 * keeps a rose rim with a short shake, and the rest dim away so the picture shows through.
 */
function AnswerCard({ letter, text, mark, pill, onPress }: { letter: string; text: string; mark: CardMark; pill?: boolean; onPress: () => void }) {
  const reduce = useReducedMotion();
  const scale = useSharedValue(1);
  const shake = useSharedValue(0);
  const fade = useSharedValue(1);
  const lit = mark === "right" || mark === "missed-right";
  useEffect(() => {
    if (lit) scale.set(reduce ? 1 : withSequence(withTiming(0.97, { duration: 90 }), withSpring(1.04, SETTLE)));
    else if (mark === "dim") scale.set(withTiming(reduce ? 1 : 0.96, { duration: 320 }));
    else scale.set(withSpring(1, SETTLE));
    if (mark === "wrong" && !reduce) shake.set(withSequence(withTiming(-7, { duration: 50 }), withTiming(7, { duration: 70 }), withTiming(-4, { duration: 60 }), withTiming(0, { duration: 60 })));
    fade.set(withTiming(mark === "dim" ? 0.22 : mark === "waiting" ? 0.55 : mark === "wrong" ? 0.9 : 1, { duration: 420 }));
  }, [mark, lit, reduce, scale, shake, fade]);
  const anim = useAnimatedStyle(() => ({ opacity: fade.get(), transform: [{ translateX: shake.get() }, { scale: scale.get() }] }));
  const wrong = mark === "wrong";
  const picked = mark === "picked";
  const spoken =
    mark === "right" ? `${letter}. ${text}, your answer, correct` : mark === "missed-right" ? `${letter}. ${text}, the right answer` : wrong ? `${letter}. ${text}, your answer, wrong` : picked ? `${letter}. ${text}, locked in` : `${letter}. ${text}`;
  return (
    <Animated.View style={[{ flexGrow: 1 }, anim]}>
      <Pressable
        onPressIn={() => mark === "idle" && pressFeedback()}
        onPress={onPress}
        disabled={mark !== "idle"}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityState={{ selected: picked || mark === "right" || wrong, disabled: mark !== "idle" }}
        style={({ pressed }) => [
          styles.answer,
          pill && styles.answerPill,
          lit && styles.answerRight,
          wrong && styles.answerWrong,
          picked && styles.answerPicked,
          pressed && mark === "idle" && { backgroundColor: C.glassStrong, transform: [{ scale: 0.98 }] },
        ]}>
        {pill ? null : (
          <View style={styles.answerTop}>
            <Text style={[styles.letter, { color: lit ? "rgba(255,255,255,0.9)" : wrong ? C.miss : C.muted }]}>{letter}</Text>
            {lit ? <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" /> : null}
            {wrong ? <Ionicons name="close-circle-outline" size={20} color={C.miss} /> : null}
            {picked ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
          </View>
        )}
        <Text style={[styles.answerText, pill && styles.pillText]} numberOfLines={pill ? 2 : 3} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {text}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/** Quick-fire: five questions on one clock, each over its own picture; the marks come back together, as glass rows. */
function CinemaBlitz({
  attemptId,
  shareable,
  questions,
  showing,
  answers,
  marks,
  correct,
  voice,
  onPick,
}: {
  attemptId: string;
  shareable: boolean;
  questions: AttemptQuestion[];
  showing: number;
  answers: number[];
  marks: boolean[] | null;
  correct: number[] | null;
  voice: boolean;
  onPick: (i: number) => void;
}) {
  const s = useRun();
  const q = questions[Math.min(showing, questions.length - 1)];
  return (
    <View style={{ gap: 14 }}>
      <View style={styles.pips} accessible accessibilityLabel={marks ? `${marks.filter(Boolean).length} of ${questions.length} right` : `Quick-fire ${Math.min(showing + 1, questions.length)} of ${questions.length}`}>
        {questions.map((x, i) => (
          <View key={x.id} style={[styles.pip, { backgroundColor: marks ? (marks[i] ? T.accent : C.miss) : i < showing || answers[i] >= 0 ? T.accent : i === showing ? "rgba(255,255,255,0.7)" : C.track }]} />
        ))}
      </View>
      {marks ? (
        <View style={{ gap: 8 }}>
          {questions.map((x, i) => {
            const ok = !!marks[i];
            const right = correct && correct[i] >= 0 ? x.choices[correct[i]] : null;
            const key = `${attemptId}:${i}`;
            return (
              <Animated.View key={x.id} entering={FadeInDown.delay(70 * i).duration(300)} style={styles.row} accessible={!shareable} accessibilityLabel={`${x.q}${right ? `, answer ${right}` : ""}, ${ok ? "right" : "wrong"}`}>
                <Ionicons name={ok ? "checkmark-circle" : "close-circle"} size={20} color={ok ? "#FFFFFF" : C.miss} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.rowQ}>{x.q}</Text>
                  {right ? <Text style={styles.rowA}>{right}</Text> : null}
                </View>
                {shareable ? (
                  <Pressable onPress={() => void runModel.shareQuestion(attemptId, i)} disabled={!!s.sharingQuestion} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Share this question: ${x.q}`} style={styles.rowShare}>
                    {s.sharingQuestion === key ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="share-social-outline" size={18} color="#FFFFFF" />}
                  </Pressable>
                ) : null}
              </Animated.View>
            );
          })}
        </View>
      ) : q ? (
        <View key={q.id} style={{ gap: 14 }}>
          <Rise i={3}>
            <Text style={styles.kickerMuted}>
              QUICK-FIRE {Math.min(showing + 1, questions.length)} OF {questions.length}
            </Text>
          </Rise>
          {q.clue ? (
            <Rise i={3} style={styles.cluePill}>
              <Text style={styles.clueText}>{q.clue}</Text>
            </Rise>
          ) : null}
          <Rise i={4}>
            <Text style={styles.question} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {q.q}
            </Text>
          </Rise>
          <AnswerGrid id={q.id} choices={q.choices} picked={null} verdict={null} right={null} onPick={onPick} />
          {voice ? <SayItButton key={q.id} choices={q.choices} removed={[]} onPick={onPick} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const REORDER = LinearTransition.duration(240);

function Beat({ text, n, locked, onPress, tone }: { text: string; n: number; locked: boolean; onPress?: () => void; tone?: "right" | "miss" }) {
  return (
    <Animated.View layout={REORDER}>
      <Pressable
        onPress={onPress}
        disabled={locked || !onPress}
        accessibilityRole={onPress ? "button" : "text"}
        accessibilityLabel={`${text}${n ? `, number ${n}` : ""}`}
        style={({ pressed }) => [styles.beat, n > 0 && styles.beatOn, tone === "right" && { borderColor: T.accent }, tone === "miss" && { borderColor: C.miss }, pressed && { transform: [{ scale: 0.98 }] }]}>
        <View style={[styles.beatBadge, n > 0 && { backgroundColor: T.accent, borderColor: T.accent }]}>
          <Text style={styles.beatBadgeText}>{n || ""}</Text>
        </View>
        <Text style={styles.beatText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {text}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/** Put-in-order: the moments as glass rows; after the answer, the right order, each row marked against yours. */
function CinemaSequence({ prompt, beats, order, locked, right }: { prompt: string; beats: { id: string; text: string }[]; order: string[]; locked: boolean; right: string[] | null }) {
  const mine = order.map((id) => beats.find((b) => b.id === id)?.text ?? "");
  return (
    <View style={{ gap: 10 }}>
      <Rise i={4}>
        <Text style={styles.question} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {prompt}
        </Text>
      </Rise>
      {locked && right ? (
        <>
          <Text style={styles.kickerMuted}>THE RIGHT ORDER</Text>
          {right.map((t, i) => (
            <Beat key={`${i}-${t}`} text={t} n={i + 1} locked tone={mine[i] === t ? "right" : "miss"} />
          ))}
        </>
      ) : locked ? (
        order.map((id, i) => <Beat key={id} text={beats.find((b) => b.id === id)?.text ?? ""} n={i + 1} locked />)
      ) : (
        <Text style={styles.hint}>Tap them in order, first to last.</Text>
      )}
    </View>
  );
}

// ---------- the end ----------

/** "That's a wrap!" over the run's best picture, blurred and dimmed, in Wale's card made dark. */
export function CinemaResults({ result, board, art, onDone, onAgain, againLeft }: { result: RunFinish; board: RunBoard | null; art: TriviaArt; onDone: () => void; onAgain: (() => void) | null; againLeft: number | null }) {
  const insets = useSafeAreaInsets();
  const s = useRun();
  const profile = useGame((g) => g.profile);
  const run = result.run;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const target = run.score;
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setShown(Math.round((target * i) / 30));
      if (i >= 30) clearInterval(t);
    }, 28);
    announce(`That's a wrap. ${target} points.`);
    return () => clearInterval(t);
  }, [run.score]);
  const { right, total } = rightOf(run);
  const topics = topicsPlayed(run);
  const name = profile?.handle?.trim() || "You";
  const place = result.board_place != null ? boardPlaceText(result.board_place, { approx: board?.you?.approx, world: (board ? isWorldBoard(board) : false) || run.region === "world" || run.region === "global" }) : null;
  const out = againLeft === 0 || !onAgain;
  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <ArtBackdrop art={art} blurred />
      <CinemaTopBar title="Quiz results" onBack={onDone} backLabel="Back to trivia" onClose={onDone} closeLabel="Done" />
      <ScrollView contentContainerStyle={[styles.pad, { flexGrow: 1, justifyContent: "center", paddingTop: 12, paddingBottom: insets.bottom + 20, gap: 0 }]} showsVerticalScrollIndicator={false}>
        <Rise i={0} style={{ alignItems: "center", gap: 6 }}>
          <View style={styles.metaRight}>
            <Ionicons name="sparkles" size={15} color="#FFFFFF" />
            <Text style={styles.kicker}>DAILY TRIVIA COMPLETE</Text>
          </View>
          <Text style={styles.wrap} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
            That&apos;s a wrap!
          </Text>
          <Text style={styles.lead}>{name}, on today&apos;s board.</Text>
        </Rise>

        <Rise i={2} style={[styles.card, { marginTop: 22 }]}>
          <View style={styles.meta}>
            <Text style={styles.kickerMuted}>FINAL SCORE</Text>
            <View style={styles.metaRight} accessible accessibilityLabel={`${right} of ${total} right`}>
              <Ionicons name="checkmark-circle" size={15} color="#FFFFFF" />
              <Text style={[styles.metaText, { color: C.ink }]}>
                {right} of {total} right
              </Text>
            </View>
          </View>
          <Text style={styles.score} accessibilityLabel={`${run.score} points`} testID="trivia-score">
            {shown}
          </Text>
          <Text style={styles.scoreLabel}>POINTS</Text>
          {topics.length ? (
            <View style={styles.topicRow} accessible accessibilityLabel={`Topics played: ${topics.join(", ")}`}>
              {topics.map((t) => (
                <View key={t} style={styles.topicChipQuiet}>
                  <Text style={styles.topicText}>{t.toUpperCase()}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <View style={styles.rule} />
          <View style={{ gap: 10 }}>
            {place ? <Row label="Place today" value={place.replace(/ today$/, "")} /> : null}
            <Row label="Level" value={`Level ${result.after.level}${result.leveled_up ? " (up!)" : ""}`} />
            <Row label="XP earned" value={`+${result.reward.xp}`} />
          </View>
        </Rise>

        <Rise i={4} style={{ gap: 12, marginTop: 22 }}>
          <TriviaButton title="Share" kind="quiet" icon="share-social-outline" iconSide="left" busy={s.busy} onPress={() => void runModel.share()} testID="trivia-share" />
          {s.share ? (
            <Text style={styles.link} selectable accessibilityLabel={`Your link: ${s.share.url}`}>
              {s.share.url}
            </Text>
          ) : null}
          {s.notice ? <Text style={styles.notice}>{s.notice}</Text> : null}
          <TriviaButton title="Take another quiz" icon="refresh" iconSide="left" disabled={out} onPress={() => onAgain?.()} testID="trivia-again" />
          {out ? <Text style={styles.link}>{triviaSub(0)}</Text> : null}
        </Rise>
        <Text style={styles.footer}>COSQUEST  /  DAILY TRIVIA</Text>
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.rowPlain} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const shadowText = { textShadowColor: "rgba(0,0,0,0.55)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 };

const styles = StyleSheet.create({
  pad: { paddingHorizontal: TRIVIA_SIZE.pad },
  scrimTop: { position: "absolute", left: 0, right: 0, top: 0, height: 220 },
  scrimBottom: { position: "absolute", left: 0, right: 0, bottom: 0, height: "78%" },
  bar: { flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 20, paddingBottom: 10 },
  square: { width: TRIVIA_SIZE.square, height: TRIVIA_SIZE.square, borderRadius: TRIVIA_RADIUS.icon, alignItems: "center", justifyContent: "center", backgroundColor: C.glass, borderWidth: 1, borderColor: C.rim },
  brand: { fontFamily: FONTS.extrabold, fontSize: 10, lineHeight: 14, letterSpacing: 1.5, color: "#FFD3EC", ...shadowText },
  barTitle: { fontFamily: FONTS.bold, fontSize: 20, lineHeight: 26, color: C.ink, ...shadowText },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: TRIVIA_RADIUS.pill, backgroundColor: C.glass, borderWidth: 1, borderColor: C.rim },
  chipText: { fontFamily: FONTS.semibold, fontSize: 12, lineHeight: 16, color: C.ink, fontVariant: ["tabular-nums"] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  topicChip: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 8, backgroundColor: T.accent, borderWidth: 1, borderColor: "rgba(255,255,255,0.5)" },
  topicChipQuiet: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: "rgba(184,65,143,0.85)" },
  topicText: { fontFamily: FONTS.bold, fontSize: 10.5, lineHeight: 15, letterSpacing: 1.5, color: "#FFFFFF" },
  kicker: { fontFamily: FONTS.bold, fontSize: 11, lineHeight: 15, letterSpacing: 1.8, color: C.ink, ...shadowText },
  kickerMuted: { fontFamily: FONTS.bold, fontSize: 11, lineHeight: 15, letterSpacing: 1.6, color: C.muted, ...shadowText },
  meta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  metaRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontFamily: FONTS.medium, fontSize: 12, lineHeight: 16, fontVariant: ["tabular-nums"], ...shadowText },
  loading: { paddingVertical: 48, alignItems: "center" },
  question: { fontFamily: FONTS.bold, fontSize: 29, lineHeight: 36, color: C.ink, letterSpacing: -0.4, marginTop: 4, ...shadowText },
  hint: { fontFamily: FONTS.regular, fontSize: 12, lineHeight: 17, color: C.muted, textAlign: "center", ...shadowText },
  cluePill: { alignSelf: "center", paddingHorizontal: 22, paddingVertical: 8, borderRadius: 999, backgroundColor: C.glass, borderWidth: 1.5, borderColor: C.rimStrong },
  clueText: { fontSize: 58, lineHeight: 72, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center" },
  answer: { flexGrow: 1, minHeight: TRIVIA_SIZE.answer, paddingHorizontal: 13, paddingVertical: 12, gap: 4, borderRadius: TRIVIA_RADIUS.card, backgroundColor: C.glass, borderWidth: 1.5, borderColor: C.rim },
  answerPill: { minHeight: TRIVIA_SIZE.pill, borderRadius: TRIVIA_SIZE.pill / 2, paddingVertical: 8, alignItems: "center", justifyContent: "center" },
  answerRight: { backgroundColor: T.accent, borderColor: "#FFFFFF", borderWidth: 2.5 },
  answerWrong: { borderColor: C.miss, borderWidth: 2 },
  answerPicked: { borderColor: T.accent, borderWidth: 2.5, backgroundColor: C.glassStrong },
  answerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 20 },
  letter: { fontFamily: FONTS.bold, fontSize: 10, lineHeight: 14, letterSpacing: 1 },
  answerText: { fontFamily: FONTS.semibold, fontSize: 16, lineHeight: 21, color: C.ink },
  pillText: { fontSize: 13.5, lineHeight: 17, textAlign: "center" },
  feedback: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4 },
  feedbackText: { fontFamily: FONTS.bold, fontSize: 17, lineHeight: 23, textAlign: "center", flexShrink: 1, ...shadowText },
  ring: { width: TRIVIA_SIZE.ring, height: TRIVIA_SIZE.ring, borderRadius: TRIVIA_SIZE.ring / 2, alignItems: "center", justifyContent: "center", borderWidth: 3, backgroundColor: C.glassStrong, alignSelf: "center" },
  ringText: { fontFamily: FONTS.bold, fontSize: 16, lineHeight: 20, color: C.ink, fontVariant: ["tabular-nums"] },
  ringSub: { fontFamily: FONTS.semibold, fontSize: 9, lineHeight: 11, letterSpacing: 1, color: C.muted },
  extras: { fontFamily: FONTS.medium, fontSize: 12, lineHeight: 16, color: C.muted, textAlign: "center", ...shadowText },
  notice: { fontFamily: FONTS.medium, fontSize: 13.5, lineHeight: 19, color: C.ink, textAlign: "center", ...shadowText },
  pips: { flexDirection: "row", gap: 6 },
  pip: { flex: 1, height: 6, borderRadius: 3 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: TRIVIA_RADIUS.card, backgroundColor: C.glass, borderWidth: 1, borderColor: C.rim },
  rowQ: { fontFamily: FONTS.medium, fontSize: 14.5, lineHeight: 19, color: C.ink },
  rowA: { fontFamily: FONTS.bold, fontSize: 13.5, lineHeight: 18, color: "#FFD3EC" },
  rowShare: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  beat: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: TRIVIA_RADIUS.card, backgroundColor: C.glass, borderWidth: 1.5, borderColor: C.rim },
  beatOn: { backgroundColor: C.glassStrong, borderColor: "rgba(255,255,255,0.45)" },
  beatBadge: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: C.rimStrong },
  beatBadgeText: { fontFamily: FONTS.bold, fontSize: 15, lineHeight: 20, color: "#FFFFFF" },
  beatText: { flex: 1, fontFamily: FONTS.semibold, fontSize: 15.5, lineHeight: 21, color: C.ink },
  wrap: { fontFamily: FONTS.bold, fontSize: 36, lineHeight: 44, color: C.ink, letterSpacing: -0.5, textAlign: "center", ...shadowText },
  lead: { fontFamily: FONTS.regular, fontSize: 14, lineHeight: 20, color: C.muted, textAlign: "center", ...shadowText },
  card: { padding: 20, borderRadius: 20, backgroundColor: C.glassStrong, borderWidth: 1.5, borderColor: C.rim },
  score: { fontFamily: FONTS.extrabold, fontSize: 56, lineHeight: 66, color: C.ink, fontVariant: ["tabular-nums"], textAlign: "center", marginTop: 14 },
  scoreLabel: { fontFamily: FONTS.semibold, fontSize: 11, lineHeight: 15, letterSpacing: 1.5, color: C.muted, textAlign: "center" },
  topicRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: 16 },
  rule: { height: 1, backgroundColor: "rgba(255,255,255,0.16)", marginTop: 18, marginBottom: 16 },
  rowPlain: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  rowLabel: { fontFamily: FONTS.regular, fontSize: 13, lineHeight: 18, color: C.muted },
  rowValue: { fontFamily: FONTS.bold, fontSize: 13.5, lineHeight: 18, color: C.ink },
  link: { fontFamily: FONTS.regular, fontSize: 12, lineHeight: 17, color: C.muted, textAlign: "center" },
  footer: { fontFamily: FONTS.semibold, fontSize: 9.5, lineHeight: 13, letterSpacing: 2, color: C.muted, textAlign: "center", marginTop: 24 },
});
