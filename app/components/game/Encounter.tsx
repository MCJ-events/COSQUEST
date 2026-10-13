// A quiz point, played: trivia, an emoji rebus, a sequence or a blitz,
// against the server's deadline (not a local timer, so a slow network or a
// backgrounded app cannot buy time). The answers go to the server, which
// marks them; the reveal shows its key. costquest-ios Roam/EncounterView.swift
// and Roam/ChallengeViews.swift.
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInRight, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { gameStore } from "@/features/game/runtime";
import { arriveMoment, hintMoment, lateMoment, levelMoment, reactionMoment } from "@/features/game/warden";
import type { AttemptQuestion, QuestPoint, RoamAnswer, RoamAttempt, RoamVerdict } from "@/features/game/wire";
import { parseServerDate } from "@/features/game/wire";

import { GameButton, GameTitle, ProgressBar } from "./kit";
import { type RewardSummary, rewardFromVerdict } from "./Reward";
import { challengeName, CHOICE_COLORS, edgeOf, GF, GP, realmColor } from "./theme";
import { wardenVoice } from "./wardenVoice";

type Phase = "opening" | "playing" | "submitting" | "reveal" | { failed: string };

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
  const [phase, setPhase] = useState<Phase>("opening");
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
  const [now, setNow] = useState(() => Date.now());
  // What the player has answered so far, for the clock's own submit.
  const answersRef = useRef<{ picked: number | null; order: string[]; blitz: number[] }>({ picked: null, order: [], blitz: [] });

  const ctx = () => ({ me: gameStore.get().me, playerName: gameStore.playerName() });
  const color = realmColor(point.realm);

  const startWith = useCallback((a: RoamAttempt) => {
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
  }, []);

  // Open the point: the server judges reach and hands out the challenge.
  useEffect(() => {
    let cancelled = false;
    wardenVoice.speak(arriveMoment(ctx(), point), 4000).catch(() => {});
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
    if (!attempt) return;
    setPhase((p) => (p === "playing" ? "submitting" : p));
    const { picked: pk, order: od, blitz: bz } = answersRef.current;
    const answers: RoamAnswer[] = attempt.kind === "sequence" ? od : attempt.kind === "blitz" ? bz : [pk ?? -1];
    try {
      const v = await gameStore.submit(attempt, answers);
      const win = v.correct > 0 && !v.late;
      Haptics.notificationAsync(win ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
      setVerdict(v);
      setPhase("reveal");
      const m = v.late ? lateMoment(ctx(), point) : reactionMoment(ctx(), win, point, attempt.kind, attempt.kind === "blitz" ? v : null);
      wardenVoice.speak(m, 5000).catch(() => {});
    } catch (error) {
      setPhase({ failed: `Couldn't send your answer: ${(error as Error).message}. Open the point again to retry.` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, point]);

  // The server's clock: when it runs out, send whatever was answered.
  useEffect(() => {
    if (phase !== "playing" || !deadline) return;
    const tick = setInterval(() => setNow(Date.now()), 200);
    const wait = Math.max(0, deadline - Date.now());
    const timer = setTimeout(() => submit(), wait);
    return () => {
      clearInterval(tick);
      clearTimeout(timer);
    };
  }, [phase, deadline, submit]);

  const question = attempt?.kind === "blitz" ? showing : 0;

  const buy = async (kind: "fifty" | "time") => {
    if (!attempt) return;
    setHinting(true);
    setHintProblem(null);
    try {
      const h = await gameStore.hint(attempt, kind, question);
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
      startWith(await gameStore.client.retry(attempt.attempt_id, here.lat, here.lng, here.accuracy));
    } catch (error) {
      setHintProblem((error as Error).message);
    }
  };

  const collect = () => {
    if (!verdict) return;
    const reward = rewardFromVerdict(verdict, point);
    if (verdict.leveled_up) wardenVoice.speak(levelMoment(ctx(), verdict.after, verdict.rank_up), 5000).catch(() => {});
    onReward(reward);
  };

  const left = Math.max(0, (deadline - now) / 1000);
  const total = (attempt?.seconds ?? 20) + (boughtTime ? gameStore.get().config?.hints?.time_s ?? 10 : 0);
  const prices = gameStore.get().config?.hints;
  const coins = gameStore.get().me?.coins ?? 0;
  const reveal = phase === "reveal" ? verdict?.reveal ?? null : null;

  return (
    <View style={[styles.root, { backgroundColor: color, paddingTop: insets.top + 8 }]}>
      <View style={styles.top}>
        <Pressable onPress={onClose} style={styles.leave} accessibilityRole="button" accessibilityLabel="Leave" hitSlop={8}>
          <Ionicons name="close" size={22} color="#FFF" />
        </Pressable>
        <Text style={styles.place} numberOfLines={1}>
          {point.name.toUpperCase()}
        </Text>
        <Text style={styles.kind}>{challengeName(attempt?.kind ?? point.challenge)}</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        {phase === "opening" ? (
          <View style={styles.center}>
            <ActivityIndicator color="#FFF" size="large" />
            <Text style={styles.openingText}>The shrine is waking…</Text>
          </View>
        ) : typeof phase === "object" ? (
          <View style={styles.center}>
            <Ionicons name="alert-circle" size={44} color="#FFF" />
            <Text style={styles.failed}>{phase.failed}</Text>
            <GameButton title="Back to the map" color={GP.navy} onPress={onClose} />
          </View>
        ) : attempt ? (
          <>
            {phase !== "reveal" ? (
              <>
                <DeadlineBar left={left} total={total} />
                {phase === "playing" && prices ? (
                  <View style={styles.hints}>
                    <HintButton
                      label={`50/50 · ${prices.fifty}`}
                      icon="cut"
                      disabled={hinting || attempt.kind === "sequence" || !!removed[question] || coins < prices.fifty}
                      onPress={() => buy("fifty")}
                    />
                    <HintButton label={`+${prices.time_s}s · ${prices.time}`} icon="time" disabled={hinting || boughtTime || coins < prices.time} onPress={() => buy("time")} />
                  </View>
                ) : null}
                {hintProblem ? <Text style={styles.hintProblem}>{hintProblem}</Text> : null}
              </>
            ) : verdict ? (
              <Animated.View entering={ZoomIn.springify()} style={{ gap: 6 }}>
                <GameTitle
                  text={verdict.late ? "Time's up!" : verdict.kind === "blitz" ? `${verdict.correct} of ${verdict.total}!` : verdict.correct > 0 ? "Correct!" : "The crystal resisted"}
                  size={verdict.correct > 0 && !verdict.late ? 38 : 30}
                  edge={edgeOf(verdict.correct > 0 && !verdict.late ? GP.mint : GP.berry)}
                />
                {verdict.grade ? <Text style={styles.grade}>{verdict.grade}</Text> : null}
              </Animated.View>
            ) : null}

            {attempt.kind === "sequence" ? (
              <SequenceCard
                prompt={attempt.challenge.prompt ?? ""}
                beats={attempt.challenge.beats ?? []}
                order={order}
                reveal={reveal?.correct_order ?? null}
                onTap={(id) => {
                  if (phase !== "playing") return;
                  Haptics.selectionAsync().catch(() => {});
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
            {phase === "submitting" ? <ActivityIndicator color="#FFF" style={{ marginTop: 12 }} /> : null}
            {phase === "reveal" && verdict?.can_retry ? (
              <GameButton title="Second chance" color={GP.rare} onPress={retry} icon={<Ionicons name="refresh" size={18} color="#FFF" />} />
            ) : null}
            {phase === "reveal" ? (
              <Animated.View entering={FadeIn.delay(300)}>
                <GameButton title="Collect" color={GP.sun} onPress={collect} />
              </Animated.View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function DeadlineBar({ left, total }: { left: number; total: number }) {
  const hot = left < 6;
  return (
    <View style={styles.deadline} accessibilityLabel={`${Math.ceil(left)} seconds left`}>
      <Ionicons name="timer" size={18} color={hot ? GP.berry : "#FFF"} />
      <View style={{ flex: 1 }}>
        <ProgressBar value={total > 0 ? left / total : 0} color={hot ? GP.berry : GP.sun} height={12} />
      </View>
      <Text style={[styles.deadlineText, hot && { color: GP.berry }]}>{Math.ceil(left)}</Text>
    </View>
  );
}

function HintButton({ label, icon, disabled, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.hint, disabled && { opacity: 0.45 }]} accessibilityRole="button" accessibilityLabel={`Hint: ${label} coins`}>
      <Ionicons name={icon} size={15} color={GP.ink} />
      <Text style={styles.hintText}>{label}</Text>
    </Pressable>
  );
}

function ChoiceButton({ text, index, state, onPress }: { text: string; index: number; state: "idle" | "picked" | "right" | "wrong" | "dim" | "removed"; onPress: () => void }) {
  const face =
    state === "right" ? GP.mint : state === "wrong" ? GP.berry : state === "dim" ? "#8C8C8C" : CHOICE_COLORS[index % CHOICE_COLORS.length];
  return (
    <Pressable
      onPress={onPress}
      disabled={state === "removed"}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ selected: state === "picked" || state === "right" }}
      style={{ opacity: state === "removed" ? 0.22 : state === "dim" ? 0.5 : 1 }}>
      {({ pressed }) => (
        <View style={[styles.choiceEdge, { backgroundColor: edgeOf(face), paddingBottom: pressed ? 1 : 5, marginTop: pressed ? 4 : 0 }]}>
          <View style={[styles.choice, { backgroundColor: face }]}>
            <Text style={styles.choiceText} numberOfLines={2} adjustsFontSizeToFit>
              {text}
            </Text>
            {state === "right" ? <Ionicons name="checkmark-circle" size={22} color="#FFF" /> : null}
            {state === "wrong" ? <Ionicons name="close-circle" size={22} color="#FFF" /> : null}
            {state === "picked" ? <Ionicons name="checkmark" size={18} color="#FFF" /> : null}
          </View>
        </View>
      )}
    </Pressable>
  );
}

function TriviaCard({
  question,
  picked,
  removed,
  correct,
  onPick,
}: {
  question: AttemptQuestion;
  picked: number | null;
  removed: number[];
  correct: number | null;
  onPick: (i: number) => void;
}) {
  return (
    <View style={styles.card}>
      {question.clue ? (
        <View style={styles.clue}>
          <Text style={styles.clueText} accessibilityLabel="Emoji clue">
            {question.clue}
          </Text>
        </View>
      ) : null}
      <Text style={styles.question}>{question.q}</Text>
      {question.choices.map((choice, i) => {
        const state =
          correct !== null ? (i === correct ? "right" : i === picked ? "wrong" : "dim") : removed.includes(i) ? "removed" : picked === i ? "picked" : "idle";
        return <ChoiceButton key={`${question.id}-${i}`} text={choice} index={i} state={state} onPress={() => onPick(i)} />;
      })}
    </View>
  );
}

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
    <View style={styles.card}>
      <Text style={styles.question}>{prompt}</Text>
      <Text style={styles.sub}>{reveal ? "The right order:" : "Tap them in order, first to last."}</Text>
      {shown.map((beat) => {
        const n = order.indexOf(beat.id) + 1;
        const right = reveal ? reveal.indexOf(beat.id) + 1 : 0;
        const wasRight = !!reveal && n === right;
        const badge = reveal ? (wasRight ? GP.mint : GP.sunDeep) : n ? GP.skyDeep : "#B3B3B3";
        return (
          <Pressable key={beat.id} onPress={() => onTap(beat.id)} style={styles.beat} accessibilityRole="button" accessibilityLabel={`${beat.text}${n ? `, number ${n}` : ""}`}>
            <View style={[styles.beatBadge, { backgroundColor: badge }]}>
              <Text style={styles.beatBadgeText}>{reveal ? right : n || ""}</Text>
            </View>
            <Text style={styles.beatText}>{beat.text}</Text>
            {reveal ? <Ionicons name={wasRight ? "checkmark-circle" : "return-down-forward"} size={20} color={wasRight ? GP.mint : GP.sunDeep} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function BlitzCard({
  questions,
  showing,
  answers,
  removed,
  marks,
  correct,
  onPick,
}: {
  questions: AttemptQuestion[];
  showing: number;
  answers: number[];
  removed: Record<number, number[]>;
  marks: boolean[] | null;
  correct: number[] | null;
  onPick: (i: number) => void;
}) {
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.pips}>
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
        <View style={styles.card}>
          {questions.map((q, i) => (
            <View key={q.id} style={styles.summaryRow}>
              <Ionicons name={marks[i] ? "checkmark-circle" : "close-circle"} size={20} color={marks[i] ? GP.mint : GP.berry} />
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryQ}>{q.q}</Text>
                {correct && correct[i] >= 0 ? <Text style={styles.summaryA}>{q.choices[correct[i]]}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      ) : questions[showing] ? (
        <Animated.View key={showing} entering={FadeInRight.duration(220)}>
          <TriviaCard question={questions[showing]} picked={null} removed={removed[showing] ?? []} correct={null} onPick={onPick} />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill },
  top: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingBottom: 8 },
  leave: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(30,58,76,0.6)", alignItems: "center", justifyContent: "center" },
  place: { flex: 1, fontFamily: GF.display, fontSize: 13, letterSpacing: 1.3, color: "#FFF" },
  kind: { fontFamily: GF.bold, fontSize: 13, color: "rgba(255,255,255,0.9)" },
  content: { padding: 16, gap: 14 },
  center: { alignItems: "center", gap: 14, paddingTop: 80 },
  openingText: { fontFamily: GF.display, fontSize: 20, color: "#FFF" },
  failed: { fontFamily: GF.body, fontSize: 16, color: "#FFF", textAlign: "center" },
  deadline: { flexDirection: "row", alignItems: "center", gap: 8 },
  deadlineText: { fontFamily: GF.display, fontSize: 18, color: "#FFF", width: 30, textAlign: "right" },
  hints: { flexDirection: "row", gap: 8 },
  hint: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.92)" },
  hintText: { fontFamily: GF.bold, fontSize: 13, color: GP.ink },
  hintProblem: { fontFamily: GF.body, fontSize: 13, color: GP.sun },
  grade: { fontFamily: GF.display, fontSize: 16, color: GP.sun },
  card: { gap: 10 },
  clue: { alignItems: "center", paddingVertical: 14, borderRadius: 24, backgroundColor: GP.cream },
  clueText: { fontSize: 56 },
  question: {
    fontFamily: GF.display,
    fontSize: 24,
    color: "#FFF",
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 0.1,
  },
  sub: { fontFamily: GF.body, fontSize: 15, color: "rgba(255,255,255,0.88)" },
  choiceEdge: { borderRadius: 18 },
  choice: { minHeight: 56, borderRadius: 18, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 8 },
  choiceText: { flex: 1, fontFamily: GF.display, fontSize: 18, color: "#FFF" },
  beat: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 18, backgroundColor: GP.cream },
  beatBadge: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "rgba(255,255,255,0.7)" },
  beatBadgeText: { fontFamily: GF.display, fontSize: 18, color: "#FFF" },
  beatText: { flex: 1, fontFamily: GF.body, fontSize: 16, color: GP.ink },
  pips: { flexDirection: "row", gap: 6 },
  pip: { flex: 1, height: 8, borderRadius: 4 },
  summaryRow: { flexDirection: "row", gap: 10, padding: 10, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.92)" },
  summaryQ: { fontFamily: GF.body, fontSize: 14, color: GP.ink },
  summaryA: { fontFamily: GF.display, fontSize: 15, color: GP.mint },
});
