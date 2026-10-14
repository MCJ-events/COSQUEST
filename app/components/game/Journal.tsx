// The player's journal: today's dailies and streak, the Codex (the cards
// earned by playing points, sets, foils), and this week's faction war and
// leaders. The server decides every card and every number; this draws them.
// costquest-ios Features/CodexFeature.swift, Roam/RoamSheets.swift (dailies),
// Roam/HallPage.swift (war, leaders).
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { gameStore, useGame } from "@/features/game/runtime";
import { startWardenModel, useWardenModel } from "@/features/game/wardenModel";

import { wardenVoice } from "./wardenVoice";

import { ProgressBar } from "./kit";
import LiveStampCard from "./LiveStampCard";
import { GF, GP, realmColor, realmIcon, tierColor } from "./theme";

type Tab = "today" | "codex" | "war";

export default function Journal({ onClose, initial = "today" }: { onClose: () => void; initial?: Tab }) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>(initial);
  const { me, codex, war, leaders } = useGame();
  const [codexTried, setCodexTried] = useState(false);

  useEffect(() => {
    if (tab !== "codex") return;
    gameStore.refreshCodex().finally(() => setCodexTried(true));
  }, [tab]);
  useEffect(() => {
    void gameStore.refreshMe();
    void gameStore.refreshWar();
  }, []);

  return (
    <Animated.View entering={SlideInDown.springify().damping(20)} exiting={SlideOutDown.duration(180)} style={[styles.sheet, { top: insets.top + 40 }]}>
      <View style={styles.head}>
        <Text style={styles.title}>Journal</Text>
        <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close the journal" hitSlop={8}>
          <Ionicons name="close" size={20} color={GP.navy} />
        </Pressable>
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(["today", "codex", "war"] as Tab[]).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
            <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t === "today" ? "Dailies" : t === "codex" ? "Codex" : "Faction war"}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        {tab === "today" ? (
          <>
            {me ? (
              <View style={styles.streak}>
                <Ionicons name="flame" size={28} color={me.streak.played_today ? GP.sun : GP.slate} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.streakTitle}>{me.streak.days ? `${me.streak.days} day streak` : "Start a streak today"}</Text>
                  <Text style={styles.muted}>{me.streak.played_today ? "Played today. Come back tomorrow." : "Play one point today to keep it."} Best {me.streak.best}.</Text>
                </View>
              </View>
            ) : null}
            <LiveStampCard me={me} />
            {me?.dailies.map((d) => (
              <View key={d.id} style={styles.daily} accessibilityLabel={`${d.title}: ${d.progress} of ${d.target}${d.done ? ", done" : ""}`}>
                <Ionicons name={d.done ? "checkmark-circle" : "ellipse-outline"} size={24} color={d.done ? GP.mint : GP.slate} />
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={styles.row}>
                    <Text style={styles.dailyTitle}>{d.title}</Text>
                    <Text style={styles.reward}>+{d.reward.xp} XP</Text>
                  </View>
                  <ProgressBar value={d.progress / Math.max(1, d.target)} color={d.done ? GP.mint : GP.sun} track={GP.track} />
                  <Text style={styles.muted}>
                    {Math.min(d.progress, d.target)} / {d.target}
                  </Text>
                </View>
              </View>
            ))}
            <WardenCard />
            {me?.today ? (
              <Text style={styles.muted}>
                Today: {me.today.points_played} points, {me.today.correct} won, {me.today.xp} XP{me.today.best_place ? `. Best: ${me.today.best_place}` : ""}.
              </Text>
            ) : null}
          </>
        ) : tab === "codex" ? (
          !codexTried && !codex ? (
            <ActivityIndicator color={GP.navy} style={{ marginTop: 40 }} />
          ) : codex ? (
            <>
              <View style={styles.row}>
                <Text style={styles.big}>{codex.counts.total} cards</Text>
                <Text style={styles.muted}>{codex.counts.foils} foil</Text>
              </View>
              {codex.sets.map((s) => (
                <View key={s.id} style={{ gap: 4 }}>
                  <View style={styles.row}>
                    <Text style={styles.setTitle}>{s.title}</Text>
                    <Text style={styles.muted}>
                      {s.progress}/{s.target}
                    </Text>
                  </View>
                  <ProgressBar value={s.progress / Math.max(1, s.target)} color={s.done ? GP.mint : GP.skyDeep} track={GP.track} />
                </View>
              ))}
              <View style={styles.grid}>
                {codex.cards.map((c) => (
                  <View key={c.point_id} style={[styles.card, { borderColor: tierColor(c.tier) }]} accessibilityLabel={`${c.point_name}, ${c.tier}${c.foil ? ", foil" : ""}, played ${c.times} times`}>
                    <View style={[styles.cardArt, { backgroundColor: realmColor(c.realm) }]}>
                      <Ionicons name={realmIcon(c.realm)} size={26} color="#FFF" />
                      {c.foil ? <Ionicons name="sparkles" size={14} color={GP.sun} style={styles.foil} /> : null}
                    </View>
                    <Text style={styles.cardName} numberOfLines={2}>
                      {c.point_name}
                    </Text>
                    <Text style={styles.cardMeta}>×{c.times}</Text>
                  </View>
                ))}
              </View>
              {!codex.cards.length ? <Text style={styles.muted}>Play a Quest Point to earn your first card.</Text> : null}
            </>
          ) : (
            <Text style={styles.muted}>The Codex is not available right now.</Text>
          )
        ) : (
          <>
            {war ? (
              <>
                <Text style={styles.big}>This week in {war.region}</Text>
                {war.standings.map((s, i) => (
                  <View key={s.faction} style={{ gap: 4 }}>
                    <View style={styles.row}>
                      <Text style={[styles.setTitle, me?.faction === s.faction && { color: realmColor(s.faction) }]}>
                        {i + 1}. {s.name}
                        {me?.faction === s.faction ? " (you)" : ""}
                      </Text>
                      <Text style={styles.muted}>{s.points} pts</Text>
                    </View>
                    <ProgressBar value={s.share} color={realmColor(s.faction)} track={GP.track} />
                  </View>
                ))}
              </>
            ) : (
              <Text style={styles.muted}>No war data here yet.</Text>
            )}
            {leaders?.leaders.length ? (
              <View style={{ gap: 6, marginTop: 10 }}>
                <Text style={styles.big}>Leaders</Text>
                {leaders.leaders.slice(0, 10).map((l) => (
                  <View key={l.place} style={[styles.leader, l.you && { backgroundColor: "rgba(242,153,46,0.15)" }]}>
                    <Text style={styles.place}>{l.place}</Text>
                    <Text style={styles.leaderName} numberOfLines={1}>
                      {l.handle}
                    </Text>
                    <Text style={styles.muted}>
                      Lv {l.level} · {l.week_xp} XP
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </Animated.View>
  );
}

/** The Warden's voice on this phone: fetch the model, and what it measures. */
function WardenCard() {
  const model = useWardenModel();
  const mb = model.bytes ? Math.round(model.bytes / 1048576) : null;
  const text =
    model.phase === "unsupported"
      ? "The Warden speaks its written lines on this phone."
      : model.phase === "too-small"
        ? "This phone is too small to hold the Warden's model, so it speaks its written lines."
        : model.phase === "off"
          ? "Let the Warden write its own lines here, on this phone, with no network. A one-time download."
          : model.phase === "downloading"
            ? `Downloading ${model.label ?? "the model"}: ${Math.round((model.progress ?? 0) * 100)}%${mb ? ` of ${mb} MB` : ""}`
            : model.phase === "verifying"
              ? "Checking every byte…"
              : model.phase === "loading"
                ? "Waking the Warden…"
                : model.phase === "ready"
                  ? `${model.label} is writing lines here.${model.tokensPerSecond ? ` ${model.tokensPerSecond.toFixed(1)} words a second, first word in ${((model.firstTokenMs ?? 0) / 1000).toFixed(1)} s.` : ""} ${model.written} written, ${model.rejected} rejected.`
                  : `The model could not start: ${model.error ?? "unknown"}. The written lines speak meanwhile.`;
  return (
    <View style={styles.streak}>
      <Ionicons name="eye" size={26} color={GP.skyDeep} />
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={styles.streakTitle}>{"The Warden's voice"}</Text>
        <Text style={styles.muted}>{text}</Text>
        {model.phase === "downloading" ? <ProgressBar value={model.progress ?? 0} color={GP.skyDeep} track={GP.track} /> : null}
        {model.phase === "off" || model.phase === "failed" ? (
          <Pressable
            onPress={() => startWardenModel((w) => wardenVoice.setWriter(w))}
            style={styles.wardenButton}
            accessibilityRole="button"
            accessibilityLabel="Download the Warden's model">
            <Text style={styles.wardenButtonText}>{model.phase === "failed" ? "Try again" : "Download"}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wardenButton: { alignSelf: "flex-start", paddingHorizontal: 14, height: 32, borderRadius: 16, backgroundColor: GP.skyDeep, justifyContent: "center" },
  wardenButtonText: { fontFamily: GF.bold, fontSize: 13, color: "#FFF" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: GP.cream, elevation: 18 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 16 },
  title: { fontFamily: GF.display, fontSize: 26, color: GP.ink },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: GP.ice, alignItems: "center", justifyContent: "center" },
  tabs: { flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  tab: { paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: GP.ice, justifyContent: "center" },
  tabOn: { backgroundColor: GP.navy },
  tabText: { fontFamily: GF.bold, fontSize: 13, color: GP.ink },
  tabTextOn: { color: "#FFF" },
  body: { paddingHorizontal: 16, gap: 14 },
  streak: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18, backgroundColor: "#FFF" },
  streakTitle: { fontFamily: GF.display, fontSize: 17, color: GP.ink },
  daily: { flexDirection: "row", gap: 12, padding: 14, borderRadius: 18, backgroundColor: "#FFF" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  dailyTitle: { fontFamily: GF.bold, fontSize: 15, color: GP.ink, flexShrink: 1 },
  reward: { fontFamily: GF.display, fontSize: 13, color: GP.sunDeep },
  muted: { fontFamily: GF.body, fontSize: 13, color: GP.mist },
  big: { fontFamily: GF.display, fontSize: 19, color: GP.ink },
  setTitle: { fontFamily: GF.bold, fontSize: 14, color: GP.ink },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  card: { width: "30%", padding: 8, borderRadius: 14, borderWidth: 2, backgroundColor: "#FFF", gap: 4 },
  cardArt: { height: 56, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  foil: { position: "absolute", top: 4, right: 4 },
  cardName: { fontFamily: GF.bold, fontSize: 11, color: GP.ink },
  cardMeta: { fontFamily: GF.regular, fontSize: 10, color: GP.mist },
  leader: { flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: 12 },
  place: { fontFamily: GF.display, fontSize: 15, color: GP.ink, width: 24 },
  leaderName: { flex: 1, fontFamily: GF.bold, fontSize: 14, color: GP.ink },
});
