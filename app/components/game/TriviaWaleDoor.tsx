// The trivia front door in Wale's look (his "Choose your character" phone
// screen, cosquest-review/forge-quality/wale-docs/trivia-ui-screens 59281),
// and the whole trivia flow behind it: start, 3-2-1, one question after
// another, the board behind the back button, the results. Drawn when WALE_UI
// is on; TriviaFrontDoor.tsx hands over to it and is otherwise unchanged.
//
// The game is the one the old door plays: the same server run, the same name
// on the board, the same daily allowance, the same top players read again
// every 20 s. Only the look and the order of the screens are his.
//
// His start screen picks a character and searches characters. The game has
// no trivia characters (and his cards show other companies' art), so:
//   - his title block is ours ("Today's trivia" and the allowance line);
//   - his search field's slot holds the name you play under;
//   - his four pastel cards show today's top four players (not tappable);
//   - his bottom bar reads "PLAYING AS <name>" with the run's length.
import { Ionicons } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SchemeOverride } from "@/constants/chatTheme";
import { FONTS } from "@/constants/fonts";
import { triviaOnlyWeb } from "@/features/game/config";
import { isLive, isTrivia, triviaSub } from "@/features/game/run";
import { gameStore, useGame } from "@/features/game/runtime";
import { halfWidth, nextTriviaPoint, pointsText, runLength, type StarCard, starCards, TRIVIA, TRIVIA_RADIUS, TRIVIA_SIZE } from "@/features/game/triviaLook";
import { useAppSelector } from "@/store/hooks";

import { GAME_FONTS } from "./fonts";
import { announce, MAX_FONT_SCALE } from "./kit";
import { impact } from "./prefs";
import { runModel, useRun } from "./runModel";
import { POP_IN_COUNT, usePopIn } from "./sheetMotion";
import { playSound } from "./sound";
import { Glass, Kicker, TriviaBackdrop, TriviaButton, TriviaTopBar, triviaShadow } from "./TriviaKit";
import { TopPlayers, TriviaBoard, TriviaChallenge, TriviaResults } from "./TriviaPlay";

const T = TRIVIA;
/** The public web page (<game server>/play): trivia is the whole site, nothing to close to. */
const TRIVIA_ONLY = triviaOnlyWeb(process.env.EXPO_PUBLIC_TRIVIA_WEB, Platform.OS);
/** How often the board is read again while you watch it. */
const WATCH_MS = 20000;
/** A trivia run as the server deals it today: ten questions on a 15 minute clock. */
const RUN_QUESTIONS = 10;
const RUN_MINUTES = 15;

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

export default function TriviaWaleDoor() {
  // His screens are light only, so everything inside is drawn light whatever the map's time of day.
  return (
    <SchemeOverride.Provider value="light">
      <Door />
    </SchemeOverride.Provider>
  );
}

function Door() {
  const [fontsReady, fontsError] = useFonts(GAME_FONTS);
  const session = useGame((g) => g.session);
  const profile = useGame((g) => g.profile);
  const chatToken = useAppSelector((st) => st.auth.token);
  const s = useRun();
  const live = isLive(s.run);
  /** The question on screen (its idx in the run); null is the board, the door or the results. */
  const [current, setCurrent] = useState<number | null>(null);
  const [counting, setCounting] = useState<number | null>(null);
  const [name, setName] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    runModel.clearProblem();
    return () => {
      alive.current = false;
    };
  }, []);

  // A guest: no chat login, so this phone's own key is the player.
  useEffect(() => {
    if (!session && !chatToken) void gameStore.playOnThisPhone();
  }, [session, chatToken]);

  // A player: pick up a run already on (or one that ended while away), and today's runs left.
  const playerKey = session?.playerKey ?? null;
  useEffect(() => {
    if (!playerKey) return;
    void runModel.resume();
    void runModel.loadAllowance();
  }, [playerKey]);

  // Today's top players, read again every 20 s while nobody is mid-run: the thing to watch.
  useEffect(() => {
    if (live) return;
    void runModel.loadTriviaBoard();
    const t = setInterval(() => void runModel.loadTriviaBoard(), WATCH_MS);
    return () => clearInterval(t);
  }, [live, playerKey]);

  // The run's end: the old look's HUD asks the server at 0:00; his screens have no HUD, so the door does.
  const runId = live && s.run && isTrivia(s.run) ? s.run.run_id : null;
  useEffect(() => {
    if (!runId) return;
    return runModel.watchEnd();
  }, [runId]);

  // A run just settled: one of today's runs is used, so "Take New Quiz" knows what is left.
  const settled = s.finished?.run.run_id ?? null;
  useEffect(() => {
    if (settled) void runModel.loadAllowance();
  }, [settled]);

  const saved = profile?.handle ?? "";
  const shownName = name ?? saved;

  const play = async () => {
    // The name on the board and on a shared card: saved only when it changed (2 to 24 letters).
    const want = shownName.trim();
    if (want.length >= 2 && want !== saved) {
      try {
        await (profile?.avatar ? gameStore.saveProfile(want.slice(0, 24), profile.avatar) : gameStore.saveProfile(want.slice(0, 24)));
        // The server keeps the name it may show in public; the field shows that from now on.
        if (alive.current) setName(null);
      } catch {
        // Plays on as "Player"; the name can be set next time.
      }
    }
    if (!(await runModel.start("trivia", null))) return;
    for (const n of [3, 2, 1]) {
      if (!alive.current) return;
      setCounting(n);
      announce(String(n));
      playSound("tap");
      impact(Haptics.ImpactFeedbackStyle.Heavy);
      await new Promise((r) => setTimeout(r, 650));
    }
    if (!alive.current) return;
    setCounting(0);
    announce("Go!");
    await new Promise((r) => setTimeout(r, 450));
    if (!alive.current) return;
    // Straight into question 1, as his flow goes (the board is behind the back button).
    setCurrent(nextTriviaPoint(runModel.get().run)?.idx ?? null);
    setCounting(null);
  };

  /** After an answer: the next question in the deal; none left to open means the board (a hidden bonus) or the score. */
  const next = (after: number | null) => {
    const st = runModel.get();
    const n = isLive(st.run) ? nextTriviaPoint(st.run, after) : null;
    if (n) return setCurrent(n.idx);
    setCurrent(null);
    if (isLive(st.run) && !st.run?.points.some((p) => !p.done)) void runModel.finish();
  };

  const closeResults = () => {
    runModel.close();
    void runModel.loadAllowance();
    void runModel.loadTriviaBoard();
  };

  if (!fontsReady && !fontsError) {
    return (
      <Frame>
        <Centre>
          <ActivityIndicator color={T.accent} size="large" />
        </Centre>
      </Frame>
    );
  }

  const exit = TRIVIA_ONLY ? null : leave;
  const otherRun = live && s.run && !isTrivia(s.run);
  const point = current !== null && s.run && isTrivia(s.run) ? (s.run.points.find((p) => p.idx === current) ?? null) : null;

  if (!session) {
    return (
      <Frame bar={<TriviaTopBar title="Daily trivia" onBack={exit} onClose={exit} />}>
        {chatToken ? (
          <AccountNotLoaded />
        ) : (
          <Centre>
            <ActivityIndicator color={T.accent} size="large" />
          </Centre>
        )}
      </Frame>
    );
  }
  if (counting !== null) return <Countdown n={counting} />;
  if (otherRun) {
    return (
      <Frame bar={<TriviaTopBar title="Daily trivia" onBack={exit} onClose={exit} />}>
        <Centre>
          <Text style={styles.title}>A Quest Run is on</Text>
          <Text style={[styles.lead, { textAlign: "center" }]}>Finish it in the game first, then come back for trivia.</Text>
          {exit ? <TriviaButton title="Back" icon="arrow-back" iconSide="left" onPress={exit} style={{ alignSelf: "stretch" }} /> : null}
        </Centre>
      </Frame>
    );
  }
  if (point) {
    return (
      <View style={styles.fill}>
        {/* One question to the next: the new one fades in over the old as it fades out (a crossfade between pictures). */}
        <Animated.View key={point.idx} entering={FadeIn.duration(point.topic ? 420 : 220)} exiting={point.topic ? FadeOut.duration(420) : undefined} style={StyleSheet.absoluteFill}>
          <TriviaChallenge point={point} onBoard={() => setCurrent(null)} onNext={() => next(point.idx)} onLeave={exit} />
        </Animated.View>
      </View>
    );
  }
  if (s.finished && isTrivia(s.finished.run)) {
    return (
      <View style={styles.fill}>
        <Animated.View entering={FadeIn.duration(220)} style={StyleSheet.absoluteFill}>
          <TriviaResults
            result={s.finished}
            board={s.board}
            againLeft={s.triviaLeft}
            onDone={closeResults}
            onAgain={() => {
              runModel.close();
              void play();
            }}
          />
        </Animated.View>
      </View>
    );
  }
  // The last answer ended the run and the results are on their way: wait here, not on the start screen.
  if (s.run && isTrivia(s.run) && s.run.finished && s.busy) {
    return (
      <Frame bar={<TriviaTopBar title="Quiz results" />}>
        <Centre>
          <ActivityIndicator color={T.accent} size="large" />
        </Centre>
      </Frame>
    );
  }
  if (live) {
    return (
      <View style={styles.fill}>
        <TriviaBoard onPick={(p) => setCurrent(p.idx)} onNext={() => next(null)} onLeave={exit} />
      </View>
    );
  }
  return <StartView name={shownName} onName={setName} onPlay={() => void play()} onLeave={exit} />;
}

function Frame({ bar, children }: { bar?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.fill}>
      <TriviaBackdrop />
      {bar}
      {children}
    </View>
  );
}

function Centre({ children }: { children: ReactNode }) {
  return <View style={styles.centre}>{children}</View>;
}

/** 3, 2, 1, GO! on the sky (the old door starts the run and never shows it). */
function Countdown({ n }: { n: number }) {
  const countIn = usePopIn(POP_IN_COUNT);
  return (
    <Frame>
      <Centre>
        <Kicker>GET READY</Kicker>
        <Animated.Text key={n} entering={countIn} exiting={FadeOut} style={[styles.count, n === 0 && { color: T.accent }]} testID="trivia-count">
          {n === 0 ? "GO!" : n}
        </Animated.Text>
      </Centre>
    </Frame>
  );
}

/** His start screen with what the game really has: your name, today's top players, Start trivia. */
function StartView({ name, onName, onPlay, onLeave }: { name: string; onName: (v: string) => void; onPlay: () => void; onLeave: (() => void) | null }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const s = useRun();
  const out = s.triviaLeft === 0;
  const board = s.board && s.board.region === "global" ? s.board : null;
  const cards = starCards(board);
  const cardWidth = halfWidth(width, TRIVIA_SIZE.cardGap);
  const players = board?.entries.length ?? 0;
  return (
    <Frame bar={<TriviaTopBar title="Daily trivia" onBack={onLeave} onClose={onLeave} />}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.display} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
          Today&apos;s trivia
        </Text>
        <Text style={styles.lead} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {triviaSub(s.triviaLeft)}
        </Text>
        <View style={styles.field}>
          <Ionicons name="person-outline" size={18} color={T.muted} />
          <TextInput
            value={name}
            onChangeText={onName}
            placeholder="Your name on the board"
            placeholderTextColor={T.muted}
            maxLength={24}
            autoCorrect={false}
            returnKeyType="done"
            style={styles.fieldInput}
            accessibilityLabel="Your name on the board"
            testID="trivia-name"
          />
        </View>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            Today&apos;s top players
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Text style={styles.sectionCount}>{players === 1 ? "1 player" : `${players} players`}</Text>
            {board?.card_url ? (
              <Pressable
                onPress={() => void runModel.shareBoard()}
                disabled={s.sharingBoard}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Share today's board"
                testID="trivia-share-board-door"
                style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                {s.sharingBoard ? <ActivityIndicator size="small" color={T.accentText} /> : <Ionicons name="share-social-outline" size={16} color={T.accentText} />}
                <Text style={[styles.sectionCount, { color: T.accentText }]}>Share</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <View style={styles.cards}>
          {cards.map((c, i) => (
            <Animated.View key={i} entering={FadeInDown.delay(50 * i).duration(240)}>
              <PlayerCard card={c} face={i} width={cardWidth} />
            </Animated.View>
          ))}
        </View>
        {board && players > cards.length ? <TopPlayers board={board} title="Next on the board" from={cards.length} /> : null}
      </ScrollView>
      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 12) + 10 }]}>
        <View style={styles.dockRow}>
          <View style={{ flex: 1, gap: 3 }}>
            <Kicker>PLAYING AS</Kicker>
            <Text style={styles.dockName} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {name.trim() || "Player"}
            </Text>
          </View>
          <Text style={styles.dockMeta} maxFontSizeMultiplier={1.3}>
            {runLength(RUN_QUESTIONS, RUN_MINUTES)}
          </Text>
        </View>
        {s.problem ? <Text style={styles.problem}>{s.problem}</Text> : null}
        <TriviaButton title="Start trivia" icon="arrow-forward" disabled={out} busy={s.busy} onPress={onPlay} testID="trivia-play" />
      </View>
    </Frame>
  );
}

/**
 * One of his four pastel cards. His holds a character to pick; this holds one
 * of today's top players (the initial where his art is, the place where his
 * radio tick is, your own card with his magenta rim). It is not a button.
 */
function PlayerCard({ card, face, width }: { card: StarCard | null; face: number; width: number }) {
  const tone = T.pastelEdge[face % T.pastelEdge.length];
  const you = !!card?.you;
  return (
    <View
      style={[styles.card, { width, backgroundColor: T.pastel[face % T.pastel.length] }, you && styles.cardYou, !card && { opacity: 0.6 }]}
      accessible
      accessibilityLabel={card ? `Place ${card.place}: ${card.handle}${you ? ", you" : ""}, ${pointsText(card.score)}` : "An open place on today's board"}>
      <View style={styles.disc}>
        <Text style={[styles.discText, { color: tone }]} maxFontSizeMultiplier={1.1}>
          {card ? card.handle.slice(0, 1).toUpperCase() : "?"}
        </Text>
      </View>
      <View style={[styles.radio, you && { backgroundColor: T.accent, borderColor: T.accent }]}>
        {card ? (
          <Text style={[styles.radioText, { color: you ? T.onAccent : tone }]} maxFontSizeMultiplier={1.1}>
            {card.place}
          </Text>
        ) : null}
      </View>
      <Text style={styles.cardName} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {card ? (you ? `${card.handle} (you)` : card.handle) : "Open place"}
      </Text>
      <Text style={styles.cardSub} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {card ? pointsText(card.score) : "Be the first"}
      </Text>
    </View>
  );
}

/** Signed in to chat, but the game account did not come with it: the player chooses (as the old door asks). */
function AccountNotLoaded() {
  const problem = useGame((g) => g.ssoProblem);
  const [busy, setBusy] = useState(false);
  return (
    <Centre>
      <Glass strong style={{ padding: 20, gap: 14, alignSelf: "stretch" }}>
        <Text style={styles.title}>{problem ? "Your game account didn't load" : "Loading your game account"}</Text>
        <Text style={[styles.lead, { textAlign: "center" }]}>
          {problem?.message ?? "One moment."} You can try again, or play on this phone: trivia you play here stays on this phone.
        </Text>
        <TriviaButton
          title="Try again"
          icon="refresh"
          iconSide="left"
          busy={busy}
          onPress={() => {
            setBusy(true);
            void gameStore.retrySession().finally(() => setBusy(false));
          }}
        />
        <TriviaButton title="Play on this phone" kind="quiet" onPress={() => void gameStore.playOnThisPhone()} />
      </Glass>
    </Centre>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: T.skyBottom },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: TRIVIA_SIZE.pad },
  // His page: the title 27 pt bold 24 pt under the bar, the subtitle, the field, the section head, the cards.
  page: { paddingHorizontal: TRIVIA_SIZE.pad, paddingTop: 22, paddingBottom: 24 },
  display: { fontFamily: FONTS.bold, fontSize: 27, lineHeight: 34, letterSpacing: -0.3, color: T.ink },
  title: { fontFamily: FONTS.bold, fontSize: 22, lineHeight: 28, color: T.ink, textAlign: "center" },
  lead: { fontFamily: FONTS.regular, fontSize: 13.5, lineHeight: 19, color: T.muted, marginTop: 4 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: TRIVIA_SIZE.field,
    paddingHorizontal: 14,
    marginTop: 16,
    borderRadius: TRIVIA_RADIUS.button,
    backgroundColor: T.glassStrong,
    borderWidth: 1,
    borderColor: T.rim,
  },
  fieldInput: { flex: 1, fontFamily: FONTS.regular, fontSize: 14, lineHeight: 19, color: T.ink, paddingVertical: 10 },
  sectionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginTop: 22, marginBottom: 16 },
  sectionTitle: { fontFamily: FONTS.bold, fontSize: 14, lineHeight: 19, color: T.ink },
  sectionCount: { fontFamily: FONTS.regular, fontSize: 12, lineHeight: 17, color: T.muted },
  cards: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", columnGap: TRIVIA_SIZE.cardGap, rowGap: 22, marginBottom: 22 },
  card: { height: TRIVIA_SIZE.starCard, padding: 12, justifyContent: "flex-end", borderRadius: TRIVIA_RADIUS.card, borderWidth: 1.5, borderColor: T.rim, overflow: "hidden", ...triviaShadow.glass },
  cardYou: { borderWidth: 2.5, borderColor: T.accent },
  disc: { position: "absolute", alignSelf: "center", top: 16, width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.5)" },
  discText: { fontFamily: FONTS.extrabold, fontSize: 40, lineHeight: 48 },
  radio: { position: "absolute", top: 10, right: 10, width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.7)", borderWidth: 1, borderColor: T.rim },
  radioText: { fontFamily: FONTS.bold, fontSize: 11, lineHeight: 14 },
  cardName: { fontFamily: FONTS.bold, fontSize: 16, lineHeight: 21, color: T.ink },
  cardSub: { fontFamily: FONTS.regular, fontSize: 11, lineHeight: 15, color: T.muted },
  // His bottom bar: a lighter strip with a white rule, the kicker and name left, the run's length right, the button under.
  dock: { paddingHorizontal: TRIVIA_SIZE.pad, paddingTop: 18, gap: 14, backgroundColor: "rgba(240,247,250,0.92)", borderTopWidth: 1, borderTopColor: T.rim },
  dockRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  dockName: { fontFamily: FONTS.bold, fontSize: 16, lineHeight: 21, color: T.ink },
  dockMeta: { fontFamily: FONTS.regular, fontSize: 12.5, lineHeight: 17, color: T.muted },
  problem: { fontFamily: FONTS.medium, fontSize: 13, lineHeight: 18, color: T.miss, textAlign: "center" },
  count: { fontFamily: FONTS.extrabold, fontSize: 110, lineHeight: 126, color: T.ink },
});
