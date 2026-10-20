// A boss raid, played: join the boss's lobby where you stand, see the crew
// gather, START, then five shared questions against the clock while the
// boss's health drains with every hit the crew lands, and the result with
// what you were paid and the answers. costquest-ios Features/RaidsFeature.swift
// RaidView, presented full screen by Roam/RoamHomeView.swift (line ~252).
//
// The server marks every swing and keeps the HP and the clock; this screen
// polls once a second (features/game/raids.ts createRaidSession) and draws
// what it is told. Only for the quiz raid: with the server's raid_duel on, a
// boss is a Guardian Duel (DuelScreen) and the quiz routes refuse.
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInRight, useReducedMotion, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  createRaidSession,
  crewByDamage,
  currentQuestion,
  lobbyClockText,
  RAID_COLOR,
  type RaidQuestion,
  type RaidSession,
  type RaidSnapshot,
  type RaidState,
  revealRows,
  rewardItems,
  rulesText,
  secondsLeft,
} from "@/features/game/raids";
import { gameStore, useGame } from "@/features/game/runtime";
import type { QuestPoint } from "@/features/game/wire";

import { announce, Chip, GameButton, GameIconButton, GameTitle, MAX_FONT_SCALE, pressFeedback, withAlpha } from "./kit";
import { GameBackdrop } from "./GameBackdrop";
import { RaidCrown, RaidHPBar } from "./RaidParts";
import { playSound } from "./sound";
import { CHOICE_COLORS, edgeOf, GF, GP } from "./theme";
import { useOnScreen } from "./useOnScreen";
import { useRenderCount } from "@/utils/perfMarks";

/** White type sits straight on the light GameBackdrop (as on iOS): a soft navy shadow keeps it legible. */
const LEGIBLE = { textShadowColor: "rgba(30,58,76,0.45)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 } as const;

/** The world changed (a fight paid, a lobby grew): HUD and points catch up (iOS store.featureChanged()). */
function featureChanged() {
  void gameStore.refreshMe();
  void gameStore.refreshPoints(true);
}

export default function RaidScreen({ point, parked, onClose }: { point: QuestPoint; parked: boolean; onClose: () => void }) {
  useRenderCount("RaidScreen");
  const insets = useSafeAreaInsets();
  const onScreen = useOnScreen();
  const [session] = useState<RaidSession>(() =>
    createRaidSession({
      client: gameStore.client,
      pointId: point.id,
      fix: () => gameStore.get().fix,
      onFinished: (s) => {
        // Swift: the sound only (fanfare for a win, whoosh otherwise), no haptic.
        playSound(s.phase === "won" ? "fanfare" : "whoosh");
        announce(s.phase === "won" ? `Victory! ${s.boss_name} is down.` : `Defeated. ${s.boss_name} got away.`);
        featureChanged();
      },
      onSwing: (hit) => {
        playSound(hit ? "hit" : "tap");
        Haptics.notificationAsync(hit ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
      },
    }),
  );
  const snap = useSyncExternalStore(session.subscribe, session.get, session.get);

  // However the raid is left (its close button or Android Back), the HUD and
  // the boss's crew count catch up.
  useEffect(() => {
    void session.run();
    return () => {
      session.stop();
      featureChanged();
    };
  }, [session]);

  // No polling or ticking while the chat is in front.
  const away = parked || !onScreen;
  useEffect(() => {
    if (away) session.pause();
    else session.resume();
  }, [away, session]);

  const leave = () => {
    session.stop();
    onClose();
  };

  // The hit/miss flash and the notice are moments: VoiceOver has no live regions.
  useEffect(() => {
    if (snap.lastHit !== null) announce(snap.lastHit ? `Hit! ${snap.lastDamage} damage` : "Miss");
  }, [snap.swings]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (snap.notice) announce(snap.notice);
  }, [snap.notice]);

  const onStart = async () => {
    await session.start();
    if (session.get().state?.phase === "fight") playSound("whoosh");
  };

  const s = snap.state;
  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <GameBackdrop />
      <View style={styles.header}>
        <Chip text="Boss raid" color={RAID_COLOR} />
        <GameIconButton icon="close" color={withAlpha(GP.ink, 0.55)} diameter={40} onPress={leave} accessibilityLabel="Leave the raid" />
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 30 }]}>
        {snap.failure ? (
          <Failed name={point.name} why={snap.failure} onRetry={() => void session.retry()} onLeave={leave} />
        ) : !s ? (
          <View style={styles.joining}>
            <GameTitle text={point.name} size={34} edge={edgeOf(RAID_COLOR, 0.6)} />
            <ActivityIndicator color="#FFF" size="large" />
            <Text style={styles.joiningText}>Joining the raid…</Text>
          </View>
        ) : (
          // Phase changes cross-fade: `.animation(.smooth(duration: 0.3), value: phase)`.
          <Animated.View key={s.phase} entering={FadeIn.duration(300)}>
            {s.phase === "lobby" ? (
              <Lobby s={s} busy={snap.busy} paused={away} onStart={() => void onStart()} />
            ) : s.phase === "fight" ? (
              <Fight snap={snap} s={s} paused={away} onAnswer={(q, c) => void session.answer(q, c)} />
            ) : (
              <Result s={s} onLeave={leave} />
            )}
          </Animated.View>
        )}
        {snap.notice ? (
          <Animated.View entering={FadeIn} style={styles.notice} accessible>
            <Text style={styles.noticeText}>{snap.notice}</Text>
          </Animated.View>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ---------- phases ----------

function Failed({ name, why, onRetry, onLeave }: { name: string; why: string; onRetry: () => void; onLeave: () => void }) {
  return (
    <View style={[styles.stack, { paddingTop: 30 }]}>
      <GameTitle text={name} size={32} edge={edgeOf(RAID_COLOR, 0.6)} />
      <View style={styles.panel}>
        <View style={styles.rowGap}>
          <Ionicons name="warning" size={22} color={GP.berry} />
          <Text style={[styles.panelTitle, { color: GP.berry }]}>{"Can't join this raid"}</Text>
        </View>
        <Text style={styles.panelBody}>{why}</Text>
      </View>
      <GameButton title="Try again" color={RAID_COLOR} onPress={onRetry} icon={<Ionicons name="refresh" size={20} color="#FFF" />} />
      <GameButton title="Back to the map" color={GP.sky} onPress={onLeave} />
    </View>
  );
}

function BossTitle({ s }: { s: RaidState }) {
  const { config } = useGame();
  const realm = config?.factions.find((f) => f.id === s.realm)?.name ?? gameStore.factionName(s.realm);
  return (
    <View style={styles.bossTitle}>
      <RaidCrown size={38} color={GP.sun} />
      <GameTitle text={s.boss_name} size={34} edge={edgeOf(RAID_COLOR, 0.6)} />
      <Text style={styles.realm}>{`${realm} questions`}</Text>
    </View>
  );
}

function Lobby({ s, busy, paused, onStart }: { s: RaidState; busy: boolean; paused: boolean; onStart: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, [paused]);
  const clock = lobbyClockText(s, now);
  return (
    <View style={styles.stack}>
      <BossTitle s={s} />
      {clock ? <Text style={styles.white}>{clock}</Text> : null}
      <View style={styles.panel}>
        <View style={styles.spread}>
          <Text style={styles.panelTitle}>Crew</Text>
          <Text style={[styles.panelTitle, { color: RAID_COLOR }]} accessibilityLabel={`${s.players.length} of ${s.max_players} players`}>
            {`${s.players.length}/${s.max_players}`}
          </Text>
        </View>
        {s.players.map((p, i) => (
          <View key={`${p.handle}-${i}`} style={styles.rowGap}>
            <Ionicons name={p.you ? "person" : "person-outline"} size={18} color={p.you ? RAID_COLOR : "rgba(30,58,76,0.6)"} />
            <Text style={[styles.player, p.you && styles.you]}>{p.you ? `${p.handle} (you)` : p.handle}</Text>
          </View>
        ))}
        <Text style={styles.small}>Bosses need a crew — or try it solo. Everyone standing here can join before you start.</Text>
      </View>
      <Text style={[styles.white, { textAlign: "center" }]}>{rulesText(s)}</Text>
      <GameButton
        title={busy ? "Starting…" : "START"}
        color={RAID_COLOR}
        disabled={busy}
        onPress={onStart}
        icon={<Ionicons name="flash" size={20} color="#FFF" />}
        accessibilityLabel="Start the fight"
      />
    </View>
  );
}

function Fight({ snap, s, paused, onAnswer }: { snap: RaidSnapshot; s: RaidState; paused: boolean; onAnswer: (q: number, c: number) => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [paused]);
  const reduced = useReducedMotion();
  const left = secondsLeft(snap, now);
  const i = currentQuestion(snap);
  return (
    <View style={styles.stack}>
      <BossTitle s={s} />
      <RaidHPBar hp={s.hp} maxHp={s.max_hp} />
      <View style={styles.spread}>
        <View style={styles.rowGap} accessible accessibilityLabel={`${left} seconds left`}>
          <Ionicons name="timer" size={24} color={left <= 10 ? GP.sun : "#FFF"} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.clock, { color: left <= 10 ? GP.sun : "#FFF" }]}>{`${left} s`}</Text>
        </View>
        <View style={styles.rowGap}>
          <Ionicons name="flash" size={20} color="#FFF" />
          <Text style={styles.damage}>{`Your damage ${s.you.damage}`}</Text>
        </View>
      </View>
      {snap.lastHit !== null ? (
        <Animated.Text
          key={snap.swings}
          entering={reduced ? FadeIn : ZoomIn.springify()}
          style={[styles.flash, { color: snap.lastHit ? GP.sun : "rgba(255,255,255,0.85)" }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {snap.lastHit ? `HIT! −${snap.lastDamage}` : "Miss!"}
        </Animated.Text>
      ) : null}
      {i !== null && i < s.questions.length ? (
        <Question key={s.questions[i].id} q={s.questions[i]} index={i} total={s.questions.length} onPick={(c) => onAnswer(i, c)} />
      ) : (
        <View style={[styles.panel, { alignItems: "center" }]}>
          <Text style={styles.panelTitle}>All your swings are in!</Text>
          <Text style={styles.small}>Waiting for the crew and the clock…</Text>
        </View>
      )}
      <CrewDamage s={s} />
    </View>
  );
}

function Question({ q, index, total, onPick }: { q: RaidQuestion; index: number; total: number; onPick: (choice: number) => void }) {
  return (
    <Animated.View entering={FadeInRight.duration(220)} style={styles.stack}>
      <View style={styles.panel}>
        <Text style={[styles.kicker, { color: RAID_COLOR }]}>{`Question ${index + 1} of ${total}`}</Text>
        {q.clue ? (
          <Text style={styles.clue} accessibilityLabel="Emoji clue">
            {q.clue}
          </Text>
        ) : null}
        <Text style={styles.question}>{q.q}</Text>
      </View>
      {q.choices.map((text, c) => (
        <Choice key={`${q.id}-${c}`} text={text} index={c} onPress={() => onPick(c)} />
      ))}
    </Animated.View>
  );
}

function Choice({ text, index, onPress }: { text: string; index: number; onPress: () => void }) {
  const face = CHOICE_COLORS[index % CHOICE_COLORS.length];
  return (
    <Pressable onPressIn={pressFeedback} onPress={onPress} accessibilityRole="button" accessibilityLabel={text}>
      {({ pressed }) => (
        <View style={[styles.choiceEdge, { backgroundColor: edgeOf(face), paddingBottom: pressed ? 1 : 5, marginTop: pressed ? 4 : 0 }]}>
          <View style={[styles.choice, { backgroundColor: face }]}>
            <Text style={styles.choiceText} numberOfLines={2} adjustsFontSizeToFit maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {text}
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

function CrewDamage({ s }: { s: RaidState }) {
  return (
    <View style={[styles.panel, { gap: 6 }]}>
      <Text style={styles.panelTitleSmall}>Crew damage</Text>
      {crewByDamage(s.players).map((p, i) => (
        <View key={`${p.handle}-${i}`} style={styles.spread}>
          <Text style={[styles.crewName, p.you && styles.you]} numberOfLines={1}>
            {p.you ? `${p.handle} (you)` : p.handle}
          </Text>
          <Text style={styles.crewDamage}>{p.damage}</Text>
        </View>
      ))}
    </View>
  );
}

function Result({ s, onLeave }: { s: RaidState; onLeave: () => void }) {
  const reduced = useReducedMotion();
  const won = s.phase === "won";
  const r = s.reward;
  const [names, setNames] = useState<Record<string, string>>({});
  const hasItems = !!r && Object.keys(r.items ?? {}).length > 0;
  useEffect(() => {
    if (!hasItems) return;
    let live = true;
    gameStore.client
      .bag()
      .then((b) => live && setNames(b.names ?? {}))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [hasItems]);
  const answers = revealRows(s);
  return (
    <View style={styles.stack}>
      <Animated.View entering={reduced ? FadeIn : ZoomIn.springify()} style={{ alignItems: "center", paddingTop: 20 }}>
        <GameTitle text={won ? "VICTORY!" : "DEFEATED"} size={50} color={won ? GP.sun : "#FFF"} edge={won ? GP.sunDeep : GP.ink} />
      </Animated.View>
      <Text style={styles.outcome}>{won ? `${s.boss_name} is down!` : `${s.boss_name} got away.`}</Text>
      <View style={styles.panel}>
        {r ? (
          <>
            <Text style={styles.panelTitle}>Your reward</Text>
            <RewardRow icon="star" text={`${r.xp} XP`} color={GP.skyDeep} />
            {r.faction_points > 0 ? <RewardRow icon="flag" text={`${r.faction_points} faction points`} color={GP.berry} /> : null}
            {rewardItems(r, names).map((item) => (
              <RewardRow key={item.id} icon="cube" text={item.text} color={GP.mint} />
            ))}
          </>
        ) : (
          <>
            <Text style={styles.panelTitle}>No reward this time</Text>
            <Text style={styles.panelBody}>Only players who land a swing are paid. Next boss at the top of the hour.</Text>
          </>
        )}
        <Text style={styles.small}>{`You dealt ${s.you.damage} damage · crew of ${s.players.length}`}</Text>
      </View>
      {answers.length ? (
        <View style={[styles.panel, { gap: 10 }]}>
          <Text style={styles.panelTitleSmall}>The answers</Text>
          {answers.map((a, i) => (
            <View key={i} style={{ gap: 2 }}>
              <Text style={styles.revealQ}>{a.q}</Text>
              {a.answer !== null ? <Text style={styles.revealA}>{a.answer}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
      <GameButton title="Back to the map" color={GP.sky} onPress={onLeave} />
    </View>
  );
}

function RewardRow({ icon, text, color }: { icon: keyof typeof Ionicons.glyphMap; text: string; color: string }) {
  return (
    <View style={styles.rowGap}>
      <Ionicons name={icon} size={20} color={color} style={{ width: 24 }} />
      <Text style={styles.rewardText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: GP.ice },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingBottom: 8 },
  content: { paddingHorizontal: 18, gap: 18 },
  joining: { alignItems: "center", gap: 14, paddingTop: 80 },
  joiningText: { ...LEGIBLE, fontFamily: GF.display, fontSize: 20, color: "#FFF" },
  stack: { gap: 16 },
  bossTitle: { alignItems: "center", gap: 4 },
  realm: { ...LEGIBLE, fontFamily: GF.bold, fontSize: 15, color: "rgba(255,255,255,0.9)" },
  white: { ...LEGIBLE, fontFamily: GF.bold, fontSize: 15, color: "#FFF", textAlign: "center" },
  panel: { padding: 16, gap: 10, borderRadius: 20, backgroundColor: GP.cream },
  panelTitle: { fontFamily: GF.display, fontSize: 21, color: GP.ink },
  panelTitleSmall: { fontFamily: GF.display, fontSize: 18, color: GP.ink },
  panelBody: { fontFamily: GF.body, fontSize: 16, color: GP.ink },
  small: { fontFamily: GF.body, fontSize: 14, color: "rgba(30,58,76,0.7)" },
  spread: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  rowGap: { flexDirection: "row", alignItems: "center", gap: 10 },
  player: { fontFamily: GF.body, fontSize: 17, color: GP.ink },
  you: { fontFamily: GF.display },
  clock: { ...LEGIBLE, fontFamily: GF.display, fontSize: 24, fontVariant: ["tabular-nums"] },
  damage: { ...LEGIBLE, fontFamily: GF.display, fontSize: 19, color: "#FFF" },
  flash: { ...LEGIBLE, fontFamily: GF.display, fontSize: 26, textAlign: "center" },
  kicker: { fontFamily: GF.display, fontSize: 15 },
  clue: { fontSize: 44, textAlign: "center" },
  question: { fontFamily: GF.display, fontSize: 22, color: GP.ink },
  choiceEdge: { borderRadius: 18 },
  choice: { minHeight: 56, borderRadius: 18, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  choiceText: { fontFamily: GF.display, fontSize: 18, color: "#FFF", textAlign: "center" },
  crewName: { flex: 1, fontFamily: GF.body, fontSize: 15, color: GP.ink },
  crewDamage: { fontFamily: GF.display, fontSize: 17, color: RAID_COLOR },
  outcome: { ...LEGIBLE, fontFamily: GF.display, fontSize: 22, color: "#FFF", textAlign: "center" },
  rewardText: { fontFamily: GF.display, fontSize: 19, color: GP.ink },
  revealQ: { fontFamily: GF.body, fontSize: 14, color: "rgba(30,58,76,0.75)" },
  revealA: { fontFamily: GF.bold, fontSize: 16, color: GP.grass },
  notice: { alignSelf: "center", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: "rgba(30,58,76,0.75)" },
  noticeText: { fontFamily: GF.body, fontSize: 15, color: "#FFF", textAlign: "center" },
});
