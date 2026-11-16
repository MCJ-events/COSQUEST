// A trivia run in Wale's look (cosquest-review/forge-quality/wale-docs/
// trivia-ui-screens): one question at a time under a hero band, "QUESTION 06 /
// 10" over segments that fill as you play, the question big, the answers as
// a 2 x 2 grid of frosted cards lettered A to D, the pick turning magenta,
// "Correct! Cherries it is." under it, then Next question. Behind the back
// button there is the run's board (TriviaBoard: every question, Radar, Surge,
// End run), and at the end TriviaResults ("That's a wrap!"). Drawn when
// WALE_UI is on (TriviaWaleDoor.tsx); the old look is TriviaFrontDoor.tsx.
//
// In his pictures and not here, because nothing in the game stands behind
// them: art of the question's subject (the band is the realm's colour), the
// 3 s ring that moves on by itself (the ring shows the points instead), the
// swap control between two answers, and the second player on the results.
//
// The game is the same as before: the server's trivia run (a Pocket Run with
// no fights), the same tiles, clocks, powers and scoring (Run.tsx useRunQuiz
// holds the challenge's state for both looks). What changed is the look, the
// feedback, and the flow: Next question opens the next tile instead of going
// back to the board.
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONTS } from "@/constants/fonts";
import {
  boardPlaceText,
  clock,
  isWorldBoard,
  resultChips,
  type RunBoard,
  triviaSub,
  type RunFinish,
  type RunPoint,
  type RunState,
  sequenceLine,
  signed,
  stakeLine,
  stakeOf,
  stakeText,
} from "@/features/game/run";
import { useGame } from "@/features/game/runtime";
import { settle } from "@/features/game/spring";
import { deadlineView } from "@/features/game/strike";
import { afterAnswer, feedbackLine, halfWidth, heroHeight, heroPlate, letterOf, nextTriviaPoint, questionNumber, scoredCount, segments, stopwatch, TRIVIA, TRIVIA_RADIUS, TRIVIA_SIZE, twoDigits } from "@/features/game/triviaLook";
import { attemptArts, bestArt, isTopicTile } from "@/features/game/triviaVisual";
import type { AttemptQuestion, TriviaArt } from "@/features/game/wire";

import AvatarView from "./AvatarView";
import { announce, MAX_FONT_SCALE, pressFeedback } from "./kit";
import { runModel, useRun } from "./runModel";
import { useRunQuiz } from "./Run";
import SayItButton from "./SayItButton";
import { challengeName, realmColor, realmIcon } from "./theme";
import { CinemaResults, CinemaQuestion } from "./TriviaCinema";
import { CountBadge, Glass, Kicker, PointsRing, Segments, TriviaBackdrop, TriviaButton, TriviaTopBar, triviaShadow } from "./TriviaKit";

const T = TRIVIA;
/** The pick settling into its colour: quick and dead-stop, as the rest of the game moves. */
const SETTLE = settle(0.28);

// ---------- one question ----------

/** One tile of the run: the Forbidden Zone's stake first when it is one, then the question. */
export function TriviaChallenge({ point, onBoard, onNext, onLeave }: { point: RunPoint; onBoard: () => void; onNext: () => void; onLeave: (() => void) | null }) {
  const s = useRun();
  const held = s.openedStakes[point.idx];
  const [stake, setStake] = useState<boolean | null>(held !== undefined ? held > 0 : point.forbidden ? null : false);
  if (stake === null) return <TriviaStake point={point} score={s.run?.score ?? 0} onChoose={setStake} onBoard={onBoard} onLeave={onLeave} />;
  return <TriviaQuestion point={point} staked={stake} onBoard={onBoard} onNext={onNext} onLeave={onLeave} />;
}

function Screen({ children, onBoard, onLeave, backDisabled }: { children: React.ReactNode; onBoard: (() => void) | null; onLeave: (() => void) | null; backDisabled?: boolean }) {
  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <TriviaBackdrop />
      <TriviaTopBar title="Daily trivia" onBack={backDisabled ? null : onBoard} backLabel="All questions" onClose={backDisabled ? null : onLeave} />
      {children}
    </View>
  );
}

function TriviaStake({ point, score, onChoose, onBoard, onLeave }: { point: RunPoint; score: number; onChoose: (stake: boolean) => void; onBoard: () => void; onLeave: (() => void) | null }) {
  const insets = useSafeAreaInsets();
  const stake = stakeOf(score);
  return (
    <Screen onBoard={onBoard} onLeave={onLeave}>
      <ScrollView contentContainerStyle={[styles.pad, { gap: 16, paddingTop: 0, paddingBottom: insets.bottom + 24 }]}>
        <Hero point={point} />
        <Kicker>FORBIDDEN ZONE</Kicker>
        <Text style={styles.question} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Stake your points on this one?
        </Text>
        <Text style={styles.lead} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {stakeText(stake, false)}
        </Text>
        {stake > 0 ? <TriviaButton title={`Stake ${stake}`} icon="flame" iconSide="left" onPress={() => onChoose(true)} testID="trivia-stake" /> : null}
        <TriviaButton title="Play it safe" kind="quiet" onPress={() => onChoose(false)} testID="trivia-safe" />
      </ScrollView>
    </Screen>
  );
}

/** The run's clock and score, small, on the hero band: the run is still timed while you read. */
function RunClock() {
  const s = useRun();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!s.run) return null;
  const left = s.localEnd !== null ? (s.localEnd - now) / 1000 : s.run.remaining_s;
  return (
    <View style={styles.heroChip} accessible accessibilityLabel={`Run: ${clock(left)} left, ${s.run.score} points`}>
      <Ionicons name="time-outline" size={14} color={T.ink} />
      <Text style={styles.heroChipText} maxFontSizeMultiplier={1.2}>
        {clock(left)} · {s.run.score} pts
      </Text>
    </View>
  );
}

/**
 * The band over the question. Wale's has the character's art; the questions
 * carry no art, so the band is the tile's realm colour with its mark, and the
 * realm's name on the plate where his subject's name is.
 */
function Hero({ point }: { point: RunPoint }) {
  const tint = realmColor(point.realm);
  const { height } = useWindowDimensions();
  return (
    <Animated.View entering={FadeIn.duration(260)} style={[styles.hero, { height: heroHeight(height) }]}>
      <LinearGradient colors={[tint, "#F3B6DA", T.skyTop]} locations={[0, 0.6, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Ionicons name={realmIcon(point.realm)} size={150} color="rgba(255,255,255,0.28)" style={styles.heroMark} />
      <View style={styles.heroTop}>
        <View style={styles.heroChip}>
          <Text style={styles.heroChipText} maxFontSizeMultiplier={1.2}>
            {challengeName(point.kind ?? "trivia")} · {point.value}
          </Text>
        </View>
        <RunClock />
      </View>
      <LinearGradient colors={["rgba(230,241,246,0)", "rgba(230,241,246,0.85)"]} style={styles.heroFade} />
      <View style={styles.plate}>
        <Text style={styles.plateText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
          {heroPlate(point)}
        </Text>
      </View>
    </Animated.View>
  );
}

/** The question's own clock, "00:20" by the counter; rose under six seconds. */
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
  const color = hot ? T.miss : T.accentText;
  return (
    <View style={styles.metaRight} accessible accessibilityRole="timer" accessibilityLabel={`${seconds} seconds left`}>
      <Ionicons name="stopwatch-outline" size={17} color={color} />
      <Text style={[styles.metaText, { color }]} maxFontSizeMultiplier={1.2}>
        {stopwatch(left)}
      </Text>
    </View>
  );
}

function TriviaQuestion({ point, staked: stakedAsked, onBoard, onNext, onLeave }: { point: RunPoint; staked: boolean; onBoard: () => void; onNext: () => void; onLeave: (() => void) | null }) {
  const insets = useSafeAreaInsets();
  const s = useRun();
  const q = useRunQuiz(point, stakedAsked);
  const { phase, attempt, result } = q;
  // The counter and segments as the run stood when this question opened: the answer marks it done.
  const [opened] = useState(() => ({ number: questionNumber(s.run), marks: segments(s.run, point.idx) }));
  const done = phase === "result";
  const marks = done && s.run ? segments(s.run, null) : opened.marks;
  const then = afterAnswer(s.run, point.idx);
  const question = attempt?.challenge.questions?.[0] ?? null;
  const pickedText = question && q.picked !== null ? (question.choices[q.picked] ?? null) : null;
  const line = done && result ? (attempt?.kind === "sequence" ? { tone: result.earned > 0 ? "right" : "miss", text: sequenceLine(result.reveal.positions_right ?? 0, attempt.challenge.beats?.length ?? 4) } : feedbackLine(result, pickedText)) : null;

  // A tile dealt by topic, or one with a picture: the question over its picture, full-bleed (TriviaCinema.tsx).
  if (isTopicTile(point) || !!point.art || attemptArts(attempt).length > 0) {
    return <CinemaQuestion point={point} q={q} number={opened.number} marks={marks} then={then} onBoard={onBoard} onNext={onNext} onLeave={onLeave} />;
  }

  return (
    <Screen onBoard={onBoard} onLeave={onLeave} backDisabled={phase === "submitting"}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 28 }} showsVerticalScrollIndicator={false}>
        <Hero point={point} />
        <View style={[styles.pad, { gap: 12 }]}>
          <View style={[styles.meta, { marginBottom: -4 }]}>
            <Kicker>
              QUESTION {twoDigits(opened.number.n)} / {twoDigits(opened.number.total)}
              {q.staked ? "  ·  STAKED" : ""}
            </Kicker>
            {phase === "playing" ? (
              <Stopwatch deadline={q.deadline} />
            ) : phase === "submitting" || phase === "result" ? (
              <Animated.View entering={FadeIn.duration(200)} style={styles.metaRight}>
                <Ionicons name="lock-closed-outline" size={15} color={T.muted} />
                <Text style={[styles.metaText, { color: T.muted }]}>Answer locked</Text>
              </Animated.View>
            ) : null}
          </View>
          <Segments marks={marks} />

          {phase === "opening" ? (
            <View style={styles.loading}>
              <ActivityIndicator color={T.accent} size="large" />
            </View>
          ) : typeof phase === "object" ? (
            <View style={{ gap: 16, paddingTop: 20 }}>
              <Text style={styles.question}>{phase.failed}</Text>
              <TriviaButton title="Back to the questions" onPress={onBoard} />
            </View>
          ) : attempt ? (
            <>
              {attempt.kind === "sequence" ? (
                <TriviaSequence
                  prompt={attempt.challenge.prompt ?? ""}
                  beats={attempt.challenge.beats ?? []}
                  order={q.order}
                  locked={phase !== "playing"}
                  onTap={q.tapBeat}
                />
              ) : attempt.kind === "blitz" ? (
                <TriviaBlitz questions={attempt.challenge.questions ?? []} showing={q.showing} answers={q.blitz} marks={q.reveal?.marks ?? null} correct={q.reveal?.correct ?? null} voice={phase === "playing"} onPick={q.pickBlitz} />
              ) : question ? (
                <TriviaSingle
                  kicker={attempt.kind === "quote" ? (attempt.challenge.prompt ?? "Who said it?") : null}
                  question={attempt.kind === "quote" ? { ...question, q: `“${question.q}”` } : question}
                  picked={q.picked}
                  verdict={done && result ? (result.late ? "late" : result.earned > 0 || result.correct > 0 ? "right" : "wrong") : null}
                  voice={phase === "playing"}
                  onPick={q.pickOne}
                />
              ) : null}

              {attempt.kind === "sequence" && phase === "playing" ? (
                <TriviaButton title="Lock it in" icon="lock-closed" iconSide="left" disabled={q.order.length < (attempt.challenge.beats?.length ?? 4)} onPress={q.submit} testID="trivia-lock" />
              ) : null}
              {phase === "submitting" ? <ActivityIndicator color={T.accent} /> : null}

              {done && result && line ? (
                <Animated.View entering={FadeInDown.duration(260)} style={{ gap: 10 }} accessibilityLiveRegion="polite">
                  <View style={styles.feedback}>
                    <Ionicons
                      name={line.tone === "right" ? "checkmark-circle-outline" : line.tone === "late" ? "time-outline" : "close-circle-outline"}
                      size={19}
                      color={line.tone === "right" ? T.accentText : T.miss}
                    />
                    <Text style={[styles.feedbackText, { color: line.tone === "right" ? T.accentText : T.miss }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                      {line.text}
                    </Text>
                  </View>
                  <PointsRing text={signed(result.earned)} paid={result.earned > 0} />
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
                </Animated.View>
              ) : null}
            </>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

/** What sits beside the points: the speed and Surge multipliers and a stake's outcome, when there were any. */
function extras(r: Parameters<typeof resultChips>[0] & { stake_result?: { stake: number; won: boolean } | null }): string[] {
  const out = resultChips(r).filter((c) => !/ of /.test(c));
  if (r.stake_result) out.push(stakeLine(r.stake_result));
  return out;
}

type Verdict = "right" | "wrong" | "late" | null;

/** A one-question tile (trivia, picture puzzle, famous quote): the question big, the answers as a 2 x 2 grid. */
function TriviaSingle({ kicker, question, picked, verdict, voice, onPick }: { kicker: string | null; question: AttemptQuestion; picked: number | null; verdict: Verdict; voice: boolean; onPick: (i: number) => void }) {
  return (
    <View style={{ gap: 14 }}>
      {kicker ? <Kicker tone="muted">{kicker.toUpperCase()}</Kicker> : null}
      {question.clue ? (
        <Glass style={styles.clue}>
          <Text style={styles.clueText} accessibilityLabel={`Emoji clue: ${question.clue}`} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {question.clue}
          </Text>
        </Glass>
      ) : null}
      <Text style={styles.question} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {question.q}
      </Text>
      <AnswerGrid id={question.id} choices={question.choices} picked={picked} verdict={verdict} onPick={onPick} />
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

function AnswerGrid({ id, choices, picked, verdict, onPick }: { id: string; choices: string[]; picked: number | null; verdict: Verdict; onPick: (i: number) => void }) {
  const { width } = useWindowDimensions();
  // Two answers: his two pills side by side (his swap control between them does nothing in the game, so it is left out).
  const pills = choices.length === 2;
  return (
    <View style={[styles.grid, { gap: pills ? 12 : TRIVIA_SIZE.answerGap }]}>
      {choices.map((c, i) => (
        <Animated.View key={`${id}-${i}`} entering={FadeInDown.delay(60 * i).duration(240)} style={{ width: halfWidth(width, pills ? 12 : TRIVIA_SIZE.answerGap) }}>
          <AnswerCard
            pill={pills}
            letter={letterOf(i)}
            text={c}
            state={picked === null ? "idle" : picked === i ? (verdict === "right" ? "right" : verdict === "wrong" || verdict === "late" ? "wrong" : "picked") : verdict ? "dim" : "waiting"}
            onPress={() => onPick(i)}
          />
        </Animated.View>
      ))}
    </View>
  );
}

type CardState = "idle" | "picked" | "waiting" | "right" | "wrong" | "dim";

/**
 * One answer. Picked: a magenta rim while the server marks it. Right: it fills
 * magenta with a tick and settles a touch bigger. Wrong: a rose rim and a short
 * shake. The rest step back. The server never says which one was right on a
 * miss, so no other card lights up.
 */
function AnswerCard({ letter, text, state, pill, onPress }: { letter: string; text: string; state: CardState; pill?: boolean; onPress: () => void }) {
  const reduce = useReducedMotion();
  const scale = useSharedValue(1);
  const shake = useSharedValue(0);
  const fade = useSharedValue(1);
  useEffect(() => {
    if (state === "right") scale.set(reduce ? 1 : withSequence(withTiming(0.97, { duration: 90 }), withSpring(1.03, SETTLE)));
    else scale.set(withSpring(1, SETTLE));
    if (state === "wrong" && !reduce) shake.set(withSequence(withTiming(-7, { duration: 50 }), withTiming(7, { duration: 70 }), withTiming(-4, { duration: 60 }), withTiming(0, { duration: 60 })));
    fade.set(withTiming(state === "dim" || state === "waiting" ? 0.5 : 1, { duration: 260 }));
  }, [state, reduce, scale, shake, fade]);
  const anim = useAnimatedStyle(() => ({ opacity: fade.get(), transform: [{ translateX: shake.get() }, { scale: scale.get() }] }));
  const right = state === "right";
  const wrong = state === "wrong";
  const lit = state === "picked";
  const ink = right ? T.onAccent : T.ink;
  const spoken = right ? `${letter}. ${text}, your answer, correct` : wrong ? `${letter}. ${text}, your answer, wrong` : lit ? `${letter}. ${text}, locked in` : `${letter}. ${text}`;
  return (
    <Animated.View style={[{ flexGrow: 1 }, anim]}>
      <Pressable
        onPressIn={() => state === "idle" && pressFeedback()}
        onPress={onPress}
        disabled={state !== "idle"}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityState={{ selected: lit || right || wrong, disabled: state !== "idle" }}
        style={({ pressed }) => [
          styles.answer,
          pill && styles.answerPill,
          right && styles.answerRight,
          wrong && styles.answerWrong,
          lit && styles.answerPicked,
          pressed && state === "idle" && { backgroundColor: T.glassStrong, transform: [{ scale: 0.98 }] },
        ]}>
        {pill ? null : (
          <View style={styles.answerTop}>
            <Text style={[styles.letter, { color: right ? "rgba(255,255,255,0.85)" : wrong ? T.miss : T.muted }]}>{letter}</Text>
            {right ? <Ionicons name="checkmark-circle-outline" size={20} color={T.onAccent} /> : null}
            {wrong ? <Ionicons name="close-circle-outline" size={20} color={T.miss} /> : null}
            {lit ? <ActivityIndicator size="small" color={T.accent} /> : null}
          </View>
        )}
        <Text style={[styles.answerText, pill && styles.pillText, { color: ink }]} numberOfLines={pill ? 2 : 3} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {text}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/** Quick-fire: five questions on one clock, each as a grid; the marks come back together at the end. */
function TriviaBlitz({
  questions,
  showing,
  answers,
  marks,
  correct,
  voice,
  onPick,
}: {
  questions: AttemptQuestion[];
  showing: number;
  answers: number[];
  marks: boolean[] | null;
  correct: number[] | null;
  voice: boolean;
  onPick: (i: number) => void;
}) {
  const q = questions[Math.min(showing, questions.length - 1)];
  return (
    <View style={{ gap: 14 }}>
      <View style={styles.pips} accessible accessibilityLabel={marks ? `${marks.filter(Boolean).length} of ${questions.length} right` : `Quick-fire ${Math.min(showing + 1, questions.length)} of ${questions.length}`}>
        {questions.map((x, i) => (
          <View
            key={x.id}
            style={[styles.pip, { backgroundColor: marks ? (marks[i] ? T.accent : T.miss) : i < showing || answers[i] >= 0 ? T.accent : i === showing ? T.accentRing : T.track }]}
          />
        ))}
      </View>
      {marks ? (
        <Glass style={{ padding: 14, gap: 12 }}>
          {questions.map((x, i) => {
            const ok = !!marks[i];
            const right = correct && correct[i] >= 0 ? x.choices[correct[i]] : null;
            return (
              <View key={x.id} style={styles.summaryRow} accessible accessibilityLabel={`${x.q}${right ? `, answer ${right}` : ""}, ${ok ? "right" : "wrong"}`}>
                <Ionicons name={ok ? "checkmark-circle" : "close-circle"} size={20} color={ok ? T.accentText : T.miss} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.summaryQ}>{x.q}</Text>
                  {right ? <Text style={[styles.summaryA, { color: T.accentText }]}>{right}</Text> : null}
                </View>
              </View>
            );
          })}
        </Glass>
      ) : q ? (
        <Animated.View key={q.id} entering={FadeInDown.duration(220)} style={{ gap: 14 }}>
          <Kicker tone="muted">
            QUICK-FIRE {Math.min(showing + 1, questions.length)} OF {questions.length}
          </Kicker>
          {q.clue ? (
            <Glass style={styles.clue}>
              <Text style={styles.clueText}>{q.clue}</Text>
            </Glass>
          ) : null}
          <Text style={styles.question} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {q.q}
          </Text>
          <AnswerGrid id={q.id} choices={q.choices} picked={null} verdict={null} onPick={onPick} />
          {voice ? <SayItButton key={q.id} choices={q.choices} removed={[]} onPick={onPick} /> : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

const REORDER = LinearTransition.duration(240);

/** Put-in-order: tap the moments first to last; a numbered one tapped again takes it back. */
function TriviaSequence({ prompt, beats, order, locked, onTap }: { prompt: string; beats: { id: string; text: string }[]; order: string[]; locked: boolean; onTap: (id: string) => void }) {
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.question} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {prompt}
      </Text>
      <Text style={styles.lead}>Tap them in order, first to last.</Text>
      {beats.map((b) => {
        const n = order.indexOf(b.id) + 1;
        return (
          <Animated.View key={b.id} layout={REORDER}>
            <Pressable
              onPress={() => onTap(b.id)}
              disabled={locked}
              accessibilityRole="button"
              accessibilityLabel={`${b.text}${n ? `, number ${n}` : ""}`}
              style={({ pressed }) => [styles.beat, n > 0 && styles.beatOn, pressed && { transform: [{ scale: 0.98 }] }]}>
              <View style={[styles.beatBadge, n > 0 && { backgroundColor: T.accent, borderColor: T.accent }]}>
                <Text style={[styles.beatBadgeText, { color: n ? T.onAccent : T.muted }]}>{n || ""}</Text>
              </View>
              <Text style={styles.beatText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {b.text}
              </Text>
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

// ---------- between questions ----------

const KIND_FACE: Record<string, number> = { trivia: 0, rebus: 1, quote: 2, blitz: 3, sequence: 1 };

/**
 * The run as a whole, for when a player steps back from a question: the
 * questions as pastel cards (played ones marked), Radar and Surge, End run,
 * and the button on to the next one.
 */
export function TriviaBoard({ onPick, onNext, onLeave }: { onPick: (p: RunPoint) => void; onNext: () => void; onLeave: (() => void) | null }) {
  const insets = useSafeAreaInsets();
  const s = useRun();
  const run = s.run;
  if (!run) return null;
  const next = nextTriviaPoint(run);
  const end = () => {
    const title = "End this run now?";
    const body = `You keep the ${run.score} points you have, and they go on today's board.`;
    // react-native-web's Alert.alert does nothing, so on the /play page End run never ended the run.
    if (Platform.OS === "web") {
      const ok = typeof globalThis.confirm === "function" ? globalThis.confirm(`${title}\n\n${body}`) : true;
      if (ok) void runModel.finish();
      return;
    }
    Alert.alert(title, body, [
      { text: "Keep playing", style: "cancel" },
      { text: "End run", style: "destructive", onPress: () => void runModel.finish() },
    ]);
  };
  const { n, total } = questionNumber(run);
  return (
    <View style={StyleSheet.absoluteFill}>
      <TriviaBackdrop />
      <TriviaTopBar title="Daily trivia" onClose={onLeave} />
      <ScrollView contentContainerStyle={[styles.pad, { gap: 14, paddingTop: 18, paddingBottom: 24 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.meta}>
          <Kicker>
            QUESTION {twoDigits(n)} / {twoDigits(total)}
          </Kicker>
          <RunClockInline run={run} localEnd={s.localEnd} />
        </View>
        <Segments marks={segments(run, null)} />
        <View style={styles.boardHead}>
          <Text style={styles.sectionTitle}>Your questions</Text>
          <Pressable onPress={end} hitSlop={8} accessibilityRole="button" testID="trivia-end">
            <Text style={styles.endLink}>End run</Text>
          </Pressable>
        </View>
        <View style={styles.tiles}>
          {[...run.points]
            .sort((a, b) => a.idx - b.idx)
            .map((p, i) => (
              <BoardTile key={p.idx} point={p} number={i + 1} onPress={() => onPick(p)} />
            ))}
        </View>
        <View style={styles.powers}>
          <Power icon="radio-outline" label="Radar" hint="Finds the hidden bonus question" left={run.powers.radar} lit={false} busy={s.busy} onPress={() => void runModel.use("radar")} />
          <Power
            icon="flash-outline"
            label={run.surge_armed ? "Surge armed" : "Surge"}
            hint="Your next answer counts one and a half times"
            left={run.powers.surge}
            lit={run.surge_armed}
            busy={s.busy}
            onPress={() => void runModel.use("surge")}
          />
        </View>
        {s.notice ? <Text style={styles.notice}>{s.notice}</Text> : null}
      </ScrollView>
      <View style={[styles.dock, { paddingBottom: insets.bottom + 14 }]}>
        <TriviaButton title={next ? "Next question" : "See your score"} icon="arrow-forward" busy={s.busy && !next} onPress={next ? onNext : () => void runModel.finish()} testID="trivia-continue" />
      </View>
    </View>
  );
}

function RunClockInline({ run, localEnd }: { run: RunState; localEnd: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = localEnd !== null ? (localEnd - now) / 1000 : run.remaining_s;
  const hot = left < 60;
  return (
    <View style={styles.metaRight} accessible accessibilityRole="timer" accessibilityLabel={`${clock(left)} left in the run, ${run.score} points`}>
      <Ionicons name="stopwatch-outline" size={17} color={hot ? T.miss : T.accentText} />
      <Text style={[styles.metaText, { color: hot ? T.miss : T.accentText }]}>
        {clock(left)} · {run.score} pts
      </Text>
    </View>
  );
}

function BoardTile({ point, number, onPress }: { point: RunPoint; number: number; onPress: () => void }) {
  const face = point.hidden ? "rgba(255,255,255,0.45)" : T.pastel[(KIND_FACE[point.kind ?? "trivia"] ?? 0) % T.pastel.length];
  const off = point.done || point.hidden;
  const label = point.hidden ? "Hidden bonus, use Radar to find it" : `Question ${number}, ${point.topic_name ? `${point.topic_name}, ` : ""}${challengeName(point.kind ?? "trivia")}, ${point.value} points${point.forbidden ? ", Forbidden Zone" : ""}${point.done ? `, done, ${signed(point.earned)}` : ""}`;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => !off && pressFeedback()}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off }}
      style={({ pressed }) => [styles.tile, { backgroundColor: face, opacity: point.done ? 0.62 : 1 }, pressed && { transform: [{ scale: 0.97 }] }]}>
      <View style={styles.tileTop}>
        <Text style={styles.tileNumber}>{point.hidden ? "?" : twoDigits(number)}</Text>
        {point.done ? (
          <Ionicons name={point.earned > 0 ? "checkmark-circle" : "close-circle"} size={22} color={point.earned > 0 ? T.accentText : T.miss} />
        ) : point.forbidden ? (
          <Ionicons name="flame" size={20} color={T.miss} />
        ) : (
          <View style={styles.tileDot} />
        )}
      </View>
      <Text style={styles.tileKind} numberOfLines={1}>
        {point.hidden ? "Hidden bonus" : point.topic_name ? point.topic_name : challengeName(point.kind ?? "trivia")}
      </Text>
      <Text style={styles.tileSub} numberOfLines={1}>
        {point.hidden ? "Use Radar" : point.done ? `${signed(point.earned)} pts` : `${point.topic_name ? `${challengeName(point.kind ?? "trivia")} · ` : ""}${point.value} pts${point.forbidden ? " · Stake" : ""}`}
      </Text>
    </Pressable>
  );
}

function Power({ icon, label, hint, left, lit, busy, onPress }: { icon: "radio-outline" | "flash-outline"; label: string; hint: string; left: number; lit: boolean; busy: boolean; onPress: () => void }) {
  const off = left === 0 || busy;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => !off && pressFeedback()}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityValue={{ text: lit ? "armed" : left > 0 ? "1 left" : "used" }}
      style={({ pressed }) => [styles.power, lit && { backgroundColor: T.accent, borderColor: T.accent }, off && !lit && { opacity: 0.45 }, pressed && { transform: [{ scale: 0.96 }] }]}>
      <Ionicons name={icon} size={18} color={lit ? T.onAccent : T.ink} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.powerTitle, lit && { color: T.onAccent }]}>{label}</Text>
        <Text style={[styles.powerHint, lit && { color: "rgba(255,255,255,0.85)" }]} numberOfLines={2}>
          {left > 0 || lit ? hint : "Used"}
        </Text>
      </View>
    </Pressable>
  );
}

// ---------- the end ----------

/**
 * "That's a wrap!" in Wale's layout, for one player: his card has two players
 * side by side and the gap between their scores; a trivia run is played alone
 * onto the day's board, so the card is yours (level, name, your avatar in the
 * ring with your place on the badge, the points counting up) and his "Score
 * difference" row is your place today, then the XP it paid.
 */
type ResultsProps = { result: RunFinish; board: RunBoard | null; onDone: () => void; onAgain: (() => void) | null; againLeft: number | null };

/** The results: over the run's best picture when its questions had pictures (TriviaCinema.tsx), else Wale's light card. */
export function TriviaResults(props: ResultsProps) {
  const s = useRun();
  const run = props.result.run;
  const seen: Record<number, TriviaArt | null | undefined> = {};
  for (const p of run.points) if (p.art) seen[p.idx] = p.art;
  const art = bestArt(run, { ...seen, ...s.arts });
  if (art) return <CinemaResults {...props} art={art} />;
  return <LightResults {...props} />;
}

function LightResults({ result, board, onDone, onAgain, againLeft }: ResultsProps) {
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
  const scored = scoredCount(run);
  const name = profile?.handle?.trim() || "You";
  const place = result.board_place != null ? boardPlaceText(result.board_place, { approx: board?.you?.approx, world: (board ? isWorldBoard(board) : false) || run.region === "world" || run.region === "global" }) : null;
  const out = againLeft === 0 || !onAgain;
  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <TriviaBackdrop />
      <TriviaTopBar title="Quiz results" onBack={onDone} backLabel="Back to trivia" onClose={onDone} closeLabel="Done" />
      <ScrollView contentContainerStyle={[styles.pad, { paddingTop: 26, paddingBottom: insets.bottom + 20 }]} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(280)} style={{ alignItems: "center", gap: 6 }}>
          <View style={styles.metaRight}>
            <Ionicons name="sparkles" size={15} color={T.accentText} />
            <Kicker>DAILY TRIVIA COMPLETE</Kicker>
          </View>
          <Text style={styles.wrap} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
            That&apos;s a wrap!
          </Text>
          <Text style={styles.lead}>Your score, on today&apos;s board.</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(120).duration(300)} style={{ marginTop: 24 }}>
          <Glass strong style={styles.scoreCard}>
            <View style={styles.meta}>
              <Kicker tone="muted">FINAL SCORE</Kicker>
              <View style={styles.metaRight} accessible accessibilityLabel={`Scored on ${scored} of ${run.points.length} questions`}>
                <Ionicons name="checkmark-circle-outline" size={15} color={T.accentText} />
                <Text style={[styles.metaText, { color: T.accentText, fontSize: 12 }]}>
                  {scored} / {run.points.length}
                </Text>
              </View>
            </View>
            <View style={{ alignItems: "center", marginTop: 22 }}>
              <Text style={styles.levelLine}>Level {result.after.level}</Text>
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>
              <View style={styles.ring}>
                <View style={styles.ringFace}>{profile?.avatar ? <AvatarView avatar={profile.avatar} size={84} /> : <Text style={styles.initial}>{name.slice(0, 1).toUpperCase()}</Text>}</View>
                {result.board_place != null && result.board_place < 1000 ? (
                  <View style={styles.ringBadge} accessible accessibilityLabel={`Place ${result.board_place} today`}>
                    <CountBadge n={result.board_place} />
                  </View>
                ) : null}
              </View>
              <Text style={styles.score} accessibilityLabel={`${run.score} points`} testID="trivia-score">
                {shown}
              </Text>
              <Text style={styles.scoreLabel}>POINTS</Text>
            </View>
            <View style={styles.rule} />
            <View style={{ gap: 10 }}>
              {place ? <Row label="Place today" value={place.replace(/ today$/, "")} /> : null}
              <Row label="XP earned" value={`+${result.reward.xp}`} />
              {result.leveled_up ? <Row label="Level up" value={`Level ${result.after.level}!`} accent /> : null}
            </View>
          </Glass>
        </Animated.View>

        <TriviaButton title="Share Results" kind="quiet" icon="share-social-outline" iconSide="left" busy={s.busy} onPress={() => void runModel.share()} testID="trivia-share" style={{ marginTop: 25 }} />
        {s.share ? (
          <Text style={[styles.link, { marginTop: 8 }]} selectable accessibilityLabel={`Your link: ${s.share.url}`}>
            {s.share.url}
          </Text>
        ) : null}
        {s.notice ? <Text style={[styles.notice, { marginTop: 8 }]}>{s.notice}</Text> : null}
        <TriviaButton title="Take New Quiz" icon="refresh" iconSide="left" disabled={out} onPress={() => onAgain?.()} testID="trivia-again" style={{ marginTop: 12 }} />
        {out ? <Text style={[styles.link, { marginTop: 8 }]}>{triviaSub(0)}</Text> : null}
        <Text style={styles.footer}>COSQUEST  /  DAILY TRIVIA</Text>
      </ScrollView>
    </View>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, accent && { color: T.accentText }]}>{value}</Text>
    </View>
  );
}

/** Today's global board as a frosted list: the top four on pastel faces, then the rest. */
export function TopPlayers({ board, title = "Today's top players", from = 0 }: { board: RunBoard; title?: string; from?: number }) {
  const entries = board.entries.slice(from, 10);
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.boardHead}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
        {from === 0 ? (
          <Text style={styles.count}>
            {board.entries.length} {board.entries.length === 1 ? "player" : "players"}
          </Text>
        ) : null}
      </View>
      {entries.length === 0 ? (
        <Glass style={{ padding: 16 }}>
          <Text style={styles.lead}>No one on the board yet today. Be the first.</Text>
        </Glass>
      ) : (
        <Glass style={{ paddingVertical: 6 }}>
          {entries.map((e, i) => (
            <Animated.View
              key={`${e.place}-${e.handle}`}
              entering={FadeIn.delay(40 * i).duration(200)}
              style={[styles.playerRow, i > 0 && styles.playerRule, e.you && { backgroundColor: T.accentSoft }]}
              accessible
              accessibilityLabel={`${e.place}. ${e.handle}${e.you ? ", you" : ""}, ${e.score}`}>
              <Text style={[styles.place, e.place <= 3 && { color: T.accentText }]}>{e.place}</Text>
              <View style={[styles.face, { backgroundColor: T.pastel[(i + from) % T.pastel.length] }]}>
                <Text style={[styles.faceText, { color: T.pastelEdge[(i + from) % T.pastelEdge.length] }]}>{e.handle.slice(0, 1).toUpperCase()}</Text>
              </View>
              <Text style={[styles.playerName, e.you && { fontFamily: FONTS.bold }]} numberOfLines={1}>
                {e.you ? `${e.handle} (you)` : e.handle}
              </Text>
              <Text style={styles.playerScore}>{e.score}</Text>
            </Animated.View>
          ))}
        </Glass>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: TRIVIA_SIZE.pad },
  lead: { fontFamily: FONTS.regular, fontSize: 14, lineHeight: 20, color: T.muted },
  hint: { fontFamily: FONTS.regular, fontSize: 12, lineHeight: 17, color: T.muted, textAlign: "center" },
  extras: { fontFamily: FONTS.medium, fontSize: 12, lineHeight: 16, color: T.muted, textAlign: "center" },
  scoreCard: { paddingHorizontal: 19, paddingTop: 22, paddingBottom: 22, borderRadius: 20 },
  ringFace: { width: 88, height: 88, borderRadius: 44, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: T.pastel[0] },
  answerPill: { minHeight: TRIVIA_SIZE.pill, borderRadius: TRIVIA_SIZE.pill / 2, paddingVertical: 8, alignItems: "center", justifyContent: "center", backgroundColor: T.glassStrong },
  pillText: { fontSize: 13, lineHeight: 17, textAlign: "center" },
  loading: { paddingVertical: 60, alignItems: "center" },
  hero: { height: TRIVIA_SIZE.hero, overflow: "hidden", justifyContent: "flex-end", marginBottom: 12 },
  heroMark: { position: "absolute", right: -10, top: 10 },
  heroTop: { position: "absolute", top: 12, left: 16, right: 16, flexDirection: "row", justifyContent: "space-between", gap: 8 },
  heroFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 70 },
  heroChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: TRIVIA_RADIUS.pill, backgroundColor: T.glassStrong },
  heroChipText: { fontFamily: FONTS.semibold, fontSize: 12, lineHeight: 16, color: T.ink },
  plate: { alignSelf: "flex-start", marginLeft: TRIVIA_SIZE.pad, marginBottom: 15, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: T.glassStrong, borderWidth: 1, borderColor: T.rim, maxWidth: "88%" },
  plateText: { fontFamily: FONTS.bold, fontSize: 10, lineHeight: 14, letterSpacing: 1.5, color: T.ink },
  meta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  metaRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontFamily: FONTS.medium, fontSize: 12, lineHeight: 16, fontVariant: ["tabular-nums"] },
  question: { fontFamily: FONTS.bold, fontSize: 26, lineHeight: 32, color: T.ink, letterSpacing: -0.3, marginTop: 4 },
  clue: { alignItems: "center", paddingVertical: 10 },
  clueText: { fontSize: 54, lineHeight: 66 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center" },
  answer: { flexGrow: 1, minHeight: TRIVIA_SIZE.answer, paddingHorizontal: 13, paddingVertical: 12, gap: 4, borderRadius: TRIVIA_RADIUS.card, backgroundColor: T.glass, borderWidth: 1.5, borderColor: T.rim, ...triviaShadow.glass },
  answerRight: { backgroundColor: T.accent, borderColor: "#FFFFFF", borderWidth: 2.5, ...triviaShadow.accent },
  answerWrong: { backgroundColor: "#FFFFFF", borderColor: T.miss, borderWidth: 2 },
  answerPicked: { backgroundColor: T.glassStrong, borderColor: T.accent, borderWidth: 2 },
  answerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 20 },
  letter: { fontFamily: FONTS.bold, fontSize: 10, lineHeight: 14, letterSpacing: 1 },
  answerText: { fontFamily: FONTS.semibold, fontSize: 15.5, lineHeight: 20 },
  feedback: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 2 },
  feedbackText: { fontFamily: FONTS.semibold, fontSize: 13.5, lineHeight: 19, textAlign: "center", flexShrink: 1 },
  pips: { flexDirection: "row", gap: 6 },
  pip: { flex: 1, height: 8, borderRadius: 4 },
  summaryRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  summaryQ: { fontFamily: FONTS.medium, fontSize: 15, lineHeight: 20, color: T.ink },
  summaryA: { fontFamily: FONTS.semibold, fontSize: 14, lineHeight: 19 },
  beat: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: TRIVIA_RADIUS.card, backgroundColor: T.glass, borderWidth: 1.5, borderColor: T.rim },
  beatOn: { borderColor: T.accentRing, backgroundColor: T.glassStrong },
  beatBadge: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: T.track, backgroundColor: "#FFFFFF" },
  beatBadgeText: { fontFamily: FONTS.bold, fontSize: 16, lineHeight: 20 },
  beatText: { flex: 1, fontFamily: FONTS.semibold, fontSize: 16, lineHeight: 22, color: T.ink },
  boardHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 },
  sectionTitle: { fontFamily: FONTS.bold, fontSize: 16, lineHeight: 22, color: T.ink },
  count: { fontFamily: FONTS.regular, fontSize: 13, lineHeight: 18, color: T.muted },
  endLink: { fontFamily: FONTS.semibold, fontSize: 14, lineHeight: 18, color: T.miss },
  tiles: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 },
  tile: { width: "48.5%", minHeight: 104, padding: 14, gap: 4, borderRadius: TRIVIA_RADIUS.card, borderWidth: 1.5, borderColor: T.rim, ...triviaShadow.glass },
  tileTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  tileNumber: { fontFamily: FONTS.bold, fontSize: 22, lineHeight: 28, color: T.ink, fontVariant: ["tabular-nums"] },
  tileDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(255,255,255,0.7)", borderWidth: 1.5, borderColor: T.rim },
  tileKind: { fontFamily: FONTS.bold, fontSize: 16, lineHeight: 21, color: T.ink },
  tileSub: { fontFamily: FONTS.regular, fontSize: 13, lineHeight: 18, color: T.muted },
  powers: { flexDirection: "row", gap: 12 },
  power: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: TRIVIA_RADIUS.button, backgroundColor: T.glass, borderWidth: 1.5, borderColor: T.rim },
  powerTitle: { fontFamily: FONTS.bold, fontSize: 14, lineHeight: 18, color: T.ink },
  powerHint: { fontFamily: FONTS.regular, fontSize: 11, lineHeight: 14, color: T.muted },
  notice: { fontFamily: FONTS.medium, fontSize: 14, lineHeight: 19, color: T.miss, textAlign: "center" },
  dock: { paddingHorizontal: TRIVIA_SIZE.pad, paddingTop: 14, backgroundColor: "rgba(240,247,250,0.92)", borderTopWidth: 1, borderTopColor: T.rim },
  wrap: { fontFamily: FONTS.bold, fontSize: 33, lineHeight: 42, color: T.ink, letterSpacing: -0.5, textAlign: "center" },
  levelLine: { fontFamily: FONTS.regular, fontSize: 11, lineHeight: 15, color: T.muted },
  name: { fontFamily: FONTS.bold, fontSize: 16, lineHeight: 22, color: T.ink, marginTop: 2 },
  ring: { width: TRIVIA_SIZE.avatarRing, height: TRIVIA_SIZE.avatarRing, borderRadius: TRIVIA_SIZE.avatarRing / 2, alignItems: "center", justifyContent: "center", borderWidth: 2.5, borderColor: T.accent, backgroundColor: "#FFFFFF", marginTop: 12 },
  ringBadge: { position: "absolute", right: -2, bottom: 0 },
  initial: { fontFamily: FONTS.bold, fontSize: 40, lineHeight: 48, color: T.accentText },
  score: { fontFamily: FONTS.extrabold, fontSize: 40, lineHeight: 48, color: T.ink, fontVariant: ["tabular-nums"], marginTop: 14 },
  scoreLabel: { fontFamily: FONTS.regular, fontSize: 11, lineHeight: 15, letterSpacing: 0.5, color: T.muted },
  rule: { height: 1, backgroundColor: "rgba(31,58,74,0.14)", marginTop: 22, marginBottom: 20 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  rowLabel: { fontFamily: FONTS.regular, fontSize: 12.5, lineHeight: 18, color: T.muted },
  rowValue: { fontFamily: FONTS.bold, fontSize: 13, lineHeight: 18, color: T.ink },
  link: { fontFamily: FONTS.regular, fontSize: 12, lineHeight: 17, color: T.muted, textAlign: "center" },
  footer: { fontFamily: FONTS.semibold, fontSize: 9.5, lineHeight: 13, letterSpacing: 2, color: T.muted, textAlign: "center", marginTop: 28 },
  playerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  playerRule: { borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.9)" },
  place: { width: 22, fontFamily: FONTS.bold, fontSize: 15, lineHeight: 20, color: T.muted, fontVariant: ["tabular-nums"] },
  face: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#FFFFFF" },
  faceText: { fontFamily: FONTS.bold, fontSize: 15, lineHeight: 20 },
  playerName: { flex: 1, fontFamily: FONTS.medium, fontSize: 15, lineHeight: 20, color: T.ink },
  playerScore: { fontFamily: FONTS.bold, fontSize: 16, lineHeight: 21, color: T.ink, fontVariant: ["tabular-nums"] },
});
