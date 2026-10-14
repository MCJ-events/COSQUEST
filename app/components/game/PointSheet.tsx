// A Quest Point, tapped: who guards it (or which challenge waits), how far,
// and Play once in reach. The Play button follows the distance; the server
// decides (its refusal is shown in its words). Share sends it to a chat as a
// game invite card. costquest-ios Roam/RoamSheets.swift PointCard.
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { distanceText } from "@/features/game/geo";
import { isRaidPoint, RAID_COLOR } from "@/features/game/raids";
import { useGame } from "@/features/game/runtime";
import { parseServerDate, type QuestPoint } from "@/features/game/wire";

import { Chip, GameButton } from "./kit";
import RaidLine from "./RaidLine";
import { challengeName, difficultyName, GF, GP, realmColor, realmIcon, tierColor } from "./theme";

function minutesLeft(until: string | null | undefined): number {
  const t = parseServerDate(until);
  return t ? Math.max(1, Math.ceil((t - Date.now()) / 60000)) : 0;
}

export default function PointSheet({
  point,
  distance,
  inReach,
  cooling,
  asDuel,
  factionName,
  onPlay,
  onShare,
  onClose,
}: {
  point: QuestPoint;
  distance: number | null;
  inReach: boolean;
  cooling: boolean;
  asDuel: boolean;
  factionName: (id: string) => string;
  onPlay: () => void;
  onShare: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const boss = isRaidPoint(point);
  const color = boss ? RAID_COLOR : realmColor(point.realm);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!cooling) return;
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [cooling]);
  const guardian = point.extra?.guardian;
  const holder = point.extra?.holder_name ?? (point.extra?.holder ? factionName(point.extra.holder) : null);
  const { me } = useGame();
  const ours = !!point.extra?.holder && point.extra.holder === me?.faction;
  const playLabel = cooling
    ? `Recharging · ${minutesLeft(point.cooling_until)} min`
    : inReach
      ? boss
        ? "Fight the boss"
        : asDuel
        ? "Fight the Guardian"
        : `Play ${challengeName(point.challenge)}`
      : `Walk closer · ${distanceText(distance)}`;

  return (
    <Animated.View entering={SlideInDown.springify().damping(18)} exiting={SlideOutDown.duration(180)} style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
      <View style={[styles.header, { backgroundColor: color }]}>
        <Ionicons name={asDuel ? "shield" : realmIcon(point.realm)} size={120} color="rgba(0,0,0,0.10)" style={styles.watermark} />
        <View style={styles.headerRow}>
          <Text style={styles.kicker}>{boss ? "BOSS RAID" : `${factionName(point.realm)} ${asDuel ? "Guardian" : "Quest Point"}`.toUpperCase()}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
            <Ionicons name="close" size={20} color="#FFF" />
          </Pressable>
        </View>
        <Text style={styles.name} numberOfLines={2}>
          {point.name}
        </Text>
        {asDuel && guardian ? (
          <Text style={styles.guardian} numberOfLines={1}>
            {guardian}
          </Text>
        ) : null}
      </View>
      <View style={styles.body}>
        <RaidLine point={point} />
        <View style={styles.chips}>
          <Chip text={point.tier.toUpperCase()} color={tierColor(point.tier)} />
          <Chip text={boss ? (asDuel ? "Boss fight" : "Boss Trivia") : asDuel ? `Guardian Duel · ${difficultyName(point.tier)}` : challengeName(point.challenge)} color={GP.navy} />
          <Chip text={distanceText(distance)} color={inReach ? GP.mint : GP.slate} />
        </View>
        <Text style={styles.blurb}>
          {boss
            ? "A boss: fight it with your crew. It leaves at half past."
            : ours
            ? `Held by your faction. ${asDuel ? "Beat its Guardian" : "Win here"} to defend ${point.name}.`
            : holder
            ? `${holder} holds ${point.name}. ${asDuel ? "Beat its Guardian" : "Win here"} to take it for your faction.`
            : asDuel
              ? `Beat its Guardian to take ${point.name} for your faction.`
              : `Answer right to earn XP and faction points at ${point.name}.`}
        </Text>
        <GameButton
          title={playLabel}
          color={cooling ? GP.slate : inReach ? (boss ? RAID_COLOR : GP.sun) : GP.skyDeep}
          disabled={cooling || !inReach}
          onPress={onPlay}
          icon={<Ionicons name={asDuel ? "flash" : "play"} size={20} color="#FFF" />}
        />
        <Pressable style={styles.share} onPress={onShare} accessibilityRole="button" accessibilityLabel={`Invite a chat to ${point.name}`}>
          <Ionicons name="chatbubbles" size={18} color={GP.skyDeep} />
          <Text style={styles.shareText}>Invite a chat here</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: GP.cream,
    overflow: "hidden",
    elevation: 16,
  },
  header: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18, overflow: "hidden" },
  watermark: { position: "absolute", right: -20, top: -10 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kicker: { fontFamily: GF.display, fontSize: 12, letterSpacing: 1.4, color: "rgba(255,255,255,0.92)" },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(30,58,76,0.55)", alignItems: "center", justifyContent: "center" },
  name: { fontFamily: GF.display, fontSize: 30, color: "#FFF", marginTop: 6 },
  guardian: { fontFamily: GF.bold, fontSize: 14, color: "rgba(255,255,255,0.9)", marginTop: 2 },
  body: { padding: 16, gap: 14 },
  chips: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  blurb: { fontFamily: GF.body, fontSize: 15, color: "rgba(30,58,76,0.75)" },
  share: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 6 },
  shareText: { fontFamily: GF.bold, fontSize: 14, color: GP.skyDeep },
});
