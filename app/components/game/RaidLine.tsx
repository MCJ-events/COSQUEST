// A line on a boss point's sheet: "BOSS RAID · 3 players · 12 min left".
// Nothing for any other point. costquest-ios Features/RaidsFeature.swift
// RaidLine, placed in Roam/RoamHomeView.swift PointCard (line ~1240).
import { StyleSheet, Text, View } from "react-native";

import { isRaidPoint, RAID_COLOR, raidLineText } from "@/features/game/raids";
import type { QuestPoint } from "@/features/game/wire";

import { useMinuteClock } from "./RaidBanner";
import { RaidCrown } from "./RaidParts";
import { GF } from "./theme";

export default function RaidLine({ point }: { point: QuestPoint }) {
  if (!isRaidPoint(point)) return null;
  return <Line point={point} />;
}

function Line({ point }: { point: QuestPoint }) {
  const now = useMinuteClock();
  const text = raidLineText(point, now);
  return (
    <View style={styles.row} accessible accessibilityLabel={text.replace(/ · /g, ", ")}>
      <RaidCrown size={16} color={RAID_COLOR} />
      <Text style={styles.text} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.4}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  text: { flexShrink: 1, fontFamily: GF.bold, fontSize: 14, color: RAID_COLOR },
});
