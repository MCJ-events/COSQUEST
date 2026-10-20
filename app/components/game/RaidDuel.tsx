// A boss fought as a Guardian Duel (the server's raid_duel knob; staging has
// it on): the briefing DuelScreen shows for a boss instead of a Guardian's,
// and the reward summary of what the fight did to the crew's shared pool.
// The fight itself is DuelScreen's arena, unchanged: mode "raid" of
// /v1/duel/start, judged by the server like any duel.
// costquest-ios Features/DuelFeature.swift (DuelView with .raid(point):
// title "Boss raid · ...", raidPanel, the raid subtitle lines).
import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { distanceM, distanceText } from "@/features/game/geo";
import { RAID_COLOR, raidDuelBlurb, raidDuelReward, raidHp, raidLineText } from "@/features/game/raids";
import { gameStore, useGame } from "@/features/game/runtime";
import type { DuelOutcome, QuestPoint, RoamStanding } from "@/features/game/wire";

import { announce, GameButton, MAX_FONT_SCALE, pressFeedback } from "./kit";
import { useMinuteClock } from "./RaidBanner";
import { RaidCrown, RaidHPBar } from "./RaidParts";
import type { RewardSummary } from "./Reward";
import { edgeOf, GF, GP } from "./theme";

/** DuelScreen's reward for a raid fight (typed here so a drift from Reward.tsx fails the typecheck). */
export function raidDuelRewardSummary(o: DuelOutcome, point: QuestPoint, before: RoamStanding | null, after: RoamStanding | null): RewardSummary {
  return raidDuelReward(o, point, before, after);
}

/** The briefing for a boss: same props as DuelScreen's own Briefing. */
export function RaidDuelBriefing({
  point,
  busy,
  problem,
  onFight,
  onClose,
}: {
  point: QuestPoint;
  busy: boolean;
  problem: string | null;
  onFight: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const now = useMinuteClock();
  const hp = raidHp(point);
  // Values from the store's snapshot, never read off the singleton in render (React Compiler).
  const { me, fix, config } = useGame();
  const realm = config?.factions.find((f) => f.id === point.realm)?.name ?? gameStore.factionName(point.realm);
  // iOS has no live regions: say a refusal when it arrives.
  useEffect(() => {
    if (problem) announce(problem);
  }, [problem]);
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.emblem}>
          <RaidCrown size={280} color="rgba(0,0,0,0.12)" />
        </View>
        <View style={styles.topBar}>
          <Pressable onPressIn={pressFeedback} onPress={onClose} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Leave" hitSlop={8}>
            <Ionicons name="close" size={22} color="#FFF" />
          </Pressable>
          <Text style={styles.placeChip} numberOfLines={1}>
            BOSS RAID
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <Animated.View entering={FadeIn.duration(400)} style={{ gap: 8 }}>
          <Text style={styles.kicker}>{raidLineText(point, now)}</Text>
          <Text style={styles.boss} numberOfLines={3} adjustsFontSizeToFit maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header">
            {point.name}
          </Text>
          {hp ? <RaidHPBar hp={hp.left} maxHp={hp.max} /> : null}
        </Animated.View>
      </View>
      <View style={[styles.lower, { paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.facts}>
          <Fact label="BOSS" value={realm} color={RAID_COLOR} />
          <View style={styles.divider} />
          <Fact label="YOU" value={me ? `Lv ${me.standing.level}` : "-"} color={GP.ink} />
          <View style={styles.divider} />
          <Fact label="DISTANCE" value={distanceText(fix ? distanceM(fix, point) : null)} color={GP.ink} />
        </View>
        <Text style={styles.blurb}>{raidDuelBlurb(point)}</Text>
        <Text style={styles.howto}>Tap to strike · Hold to block, keep holding to charge · Flick toward to dash, away to dodge · Drag to walk</Text>
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        {busy ? (
          <ActivityIndicator color={GP.navy} />
        ) : (
          <GameButton title="Fight the boss" color={RAID_COLOR} onPress={onFight} icon={<RaidCrown size={20} />} />
        )}
      </View>
    </View>
  );
}

function Fact({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${label.toLowerCase()}: ${value}`}>
      <Text style={styles.factLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>{label}</Text>
      <Text style={[styles.factValue, { color }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: GP.cream },
  header: { flex: 1, paddingHorizontal: 16, paddingBottom: 26, overflow: "hidden", backgroundColor: RAID_COLOR },
  emblem: { position: "absolute", right: -60, top: 30 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(30,58,76,0.85)", alignItems: "center", justifyContent: "center" },
  placeChip: {
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
  kicker: { fontFamily: GF.display, fontSize: 13, letterSpacing: 1.2, color: "rgba(255,255,255,0.92)" },
  boss: { fontFamily: GF.display, fontSize: 40, color: "#FFF", textShadowColor: edgeOf(RAID_COLOR, 0.5), textShadowOffset: { width: 0, height: 3 }, textShadowRadius: 0.1 },
  lower: { paddingHorizontal: 16, paddingTop: 22, gap: 16, borderTopWidth: 5, borderTopColor: GP.navy },
  facts: { flexDirection: "row", alignItems: "center", paddingVertical: 14, borderRadius: 16, backgroundColor: "#FFF", borderWidth: 1.5, borderColor: "rgba(30,58,76,0.12)" },
  fact: { flex: 1, alignItems: "center", gap: 4 },
  factLabel: { fontFamily: GF.display, fontSize: 11, letterSpacing: 1.2, color: GP.mist },
  factValue: { fontFamily: GF.display, fontSize: 20 },
  divider: { width: 1.5, height: 36, backgroundColor: "rgba(30,58,76,0.12)" },
  blurb: { fontFamily: GF.body, fontSize: 15, color: "rgba(30,58,76,0.7)" },
  howto: { fontFamily: GF.regular, fontSize: 12, color: GP.mist },
  problem: { fontFamily: GF.body, fontSize: 14, color: GP.berry },
});
