// What a point paid: XP counting up, each line the server itemised, the
// level bar moving (and a level-up), dailies completed, and what features
// added (a Codex card, a Relic). The numbers are the server's.
// costquest-ios Roam/RewardView.swift.
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { DuelOutcome, QuestPoint, RoamExtra, RoamStanding, RoamVerdict } from "@/features/game/wire";

import { GameButton, GameTitle, ProgressBar } from "./kit";
import { edgeOf, GF, GP, realmColor } from "./theme";

export type RewardSummary = {
  pointName: string;
  realm: string;
  win: boolean;
  headline: string;
  xp: number;
  coins: number;
  factionPoints: number;
  lines: { label: string; xp: number; coins: number; factionPoints: number }[];
  before: RoamStanding | null;
  after: RoamStanding | null;
  leveledUp: boolean;
  rankUp: boolean;
  dailiesCompleted: string[];
  extras: RoamExtra[];
  /** Held: the server would not pay this fight, and says why. */
  note?: string | null;
};

export function rewardFromVerdict(v: RoamVerdict, point: QuestPoint): RewardSummary {
  const win = v.correct > 0 && !v.late;
  return {
    pointName: v.point_name || point.name,
    realm: point.realm,
    win,
    headline: v.late ? "Time's up" : v.kind === "blitz" ? `${v.correct} of ${v.total}` : win ? "Point taken!" : "Not this time",
    xp: v.reward.xp,
    coins: v.reward.coins,
    factionPoints: v.reward.faction_points,
    lines: v.reward.lines.map((l) => ({ label: l.label, xp: l.xp, coins: l.coins, factionPoints: l.faction_points })),
    before: v.before,
    after: v.after,
    leveledUp: v.leveled_up,
    rankUp: v.rank_up,
    dailiesCompleted: v.dailies_completed,
    extras: v.extras ?? [],
  };
}

export function rewardFromDuel(o: DuelOutcome, point: QuestPoint, before: RoamStanding | null, after: RoamStanding | null): RewardSummary {
  const pay = o.point?.reward ?? null;
  const won = o.status === "won";
  return {
    pointName: point.name,
    realm: point.realm,
    win: won,
    headline: o.status === "held" ? "Fight held" : won ? "Guardian down!" : "The Guardian held",
    xp: pay?.xp ?? o.reward?.xp ?? 0,
    coins: 0,
    factionPoints: pay?.faction_points ?? o.reward?.faction_points ?? 0,
    lines: (pay?.lines ?? []).map((l) => ({ label: l.label, xp: l.xp ?? 0, coins: 0, factionPoints: l.faction_points ?? 0 })),
    before,
    after,
    leveledUp: !!o.point?.leveled_up || (!!before && !!after && after.level > before.level),
    rankUp: !!before && !!after && after.rank !== before.rank,
    dailiesCompleted: [],
    extras: o.point?.extras ?? [],
    note: o.status === "held" ? o.message ?? "The server couldn't confirm this fight, so it paid nothing." : null,
  };
}

function useCountUp(target: number, ms = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => {
      const f = Math.min(1, (Date.now() - start) / ms);
      setValue(Math.round(target * (1 - (1 - f) ** 3)));
      if (f >= 1) clearInterval(t);
    }, 30);
    return () => clearInterval(t);
  }, [target, ms]);
  return value;
}

export default function Reward({ reward, onDone }: { reward: RewardSummary; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const xp = useCountUp(reward.xp);
  useEffect(() => {
    Haptics.notificationAsync(reward.win ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }, [reward.win]);
  const s = reward.after;
  return (
    <View style={[styles.root, { backgroundColor: reward.win ? GP.navy : "#2A3A46", paddingTop: insets.top + 24 }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Animated.View entering={ZoomIn.springify()} style={styles.hero}>
          <View style={[styles.crest, { backgroundColor: realmColor(reward.realm) }]}>
            <Ionicons name={reward.win ? "trophy" : "shield-half"} size={44} color="#FFF" />
          </View>
          <GameTitle text={reward.headline} size={34} edge={edgeOf(reward.win ? GP.sun : GP.slate)} />
          <Text style={styles.place}>{reward.pointName}</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(150)} style={styles.xpRow} accessibilityLabel={`${reward.xp} XP`}>
          <Text style={styles.xp}>+{xp}</Text>
          <Text style={styles.xpUnit}>XP</Text>
          {reward.factionPoints > 0 ? <Text style={styles.fp}>+{reward.factionPoints} faction</Text> : null}
          {reward.coins > 0 ? <Text style={styles.fp}>+{reward.coins} coins</Text> : null}
        </Animated.View>

        {reward.note ? <Text style={styles.note}>{reward.note}</Text> : null}

        {reward.lines.length ? (
          <Animated.View entering={FadeInDown.delay(250)} style={styles.lines}>
            {reward.lines.map((l, i) => (
              <View key={`${l.label}-${i}`} style={styles.line}>
                <Text style={styles.lineLabel}>{l.label}</Text>
                <Text style={styles.lineValue}>{[l.xp ? `+${l.xp} XP` : "", l.factionPoints ? `+${l.factionPoints} FP` : "", l.coins ? `+${l.coins} c` : ""].filter(Boolean).join("  ")}</Text>
              </View>
            ))}
          </Animated.View>
        ) : null}

        {s ? (
          <Animated.View entering={FadeInDown.delay(350)} style={styles.level}>
            <View style={styles.levelHead}>
              <Text style={styles.levelText}>Level {s.level}</Text>
              <Text style={styles.rank}>{s.rank}</Text>
            </View>
            <ProgressBar value={s.into_level / Math.max(1, s.level_span)} height={12} />
            <Text style={styles.toNext}>{s.max_level ? "Max level" : `${s.level_span - s.into_level} XP to level ${s.level + 1}`}</Text>
          </Animated.View>
        ) : null}

        {reward.leveledUp && s ? (
          <Animated.View entering={ZoomIn.delay(500).springify()} style={styles.banner}>
            <Ionicons name="arrow-up-circle" size={26} color={GP.navy} />
            <Text style={styles.bannerText}>{reward.rankUp ? `New rank: ${s.rank}!` : `Level ${s.level}!`}</Text>
          </Animated.View>
        ) : null}

        {reward.dailiesCompleted.length ? (
          <Animated.View entering={FadeInDown.delay(450)} style={styles.dailies}>
            {reward.dailiesCompleted.map((d) => (
              <View key={d} style={styles.daily}>
                <Ionicons name="checkmark-done-circle" size={20} color={GP.mint} />
                <Text style={styles.dailyText}>Daily complete: {d}</Text>
              </View>
            ))}
          </Animated.View>
        ) : null}

        {reward.extras.map((e, i) => (
          <Animated.View key={`${e.kind}-${i}`} entering={FadeInDown.delay(550 + i * 80)} style={styles.extra}>
            <Ionicons name={e.kind === "relic" ? "diamond" : e.kind === "codex" ? "albums" : "sparkles"} size={22} color={GP.sun} />
            <View style={{ flex: 1 }}>
              <Text style={styles.extraTitle}>{e.title}</Text>
              {e.subtitle ? <Text style={styles.extraSub}>{e.subtitle}</Text> : null}
            </View>
            {e.new ? <Text style={styles.newTag}>NEW</Text> : null}
          </Animated.View>
        ))}

        <GameButton title="Continue" color={GP.sun} onPress={onDone} style={{ marginTop: 8 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill },
  content: { padding: 20, gap: 16 },
  hero: { alignItems: "center", gap: 8 },
  crest: { width: 92, height: 92, borderRadius: 46, alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: "#FFF" },
  place: { fontFamily: GF.bold, fontSize: 15, color: "rgba(255,255,255,0.8)" },
  xpRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", gap: 6, flexWrap: "wrap" },
  xp: { fontFamily: GF.display, fontSize: 56, color: GP.sun },
  xpUnit: { fontFamily: GF.display, fontSize: 22, color: GP.sun },
  fp: { fontFamily: GF.bold, fontSize: 15, color: "rgba(255,255,255,0.85)", marginLeft: 8 },
  note: { fontFamily: GF.body, fontSize: 14, color: GP.ice, textAlign: "center" },
  lines: { borderRadius: 18, backgroundColor: "rgba(255,255,255,0.08)", padding: 12, gap: 8 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  lineLabel: { fontFamily: GF.body, fontSize: 14, color: "#FFF", flexShrink: 1 },
  lineValue: { fontFamily: GF.bold, fontSize: 14, color: GP.sun },
  level: { gap: 6 },
  levelHead: { flexDirection: "row", justifyContent: "space-between" },
  levelText: { fontFamily: GF.display, fontSize: 18, color: "#FFF" },
  rank: { fontFamily: GF.bold, fontSize: 15, color: GP.ice },
  toNext: { fontFamily: GF.regular, fontSize: 12, color: "rgba(255,255,255,0.7)" },
  banner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 12, borderRadius: 18, backgroundColor: GP.sun },
  bannerText: { fontFamily: GF.display, fontSize: 20, color: GP.navy },
  dailies: { gap: 6 },
  daily: { flexDirection: "row", alignItems: "center", gap: 8 },
  dailyText: { fontFamily: GF.bold, fontSize: 14, color: "#FFF" },
  extra: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.1)" },
  extraTitle: { fontFamily: GF.display, fontSize: 15, color: "#FFF" },
  extraSub: { fontFamily: GF.regular, fontSize: 12, color: "rgba(255,255,255,0.75)" },
  newTag: { fontFamily: GF.display, fontSize: 11, color: GP.navy, backgroundColor: GP.sun, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },
});
