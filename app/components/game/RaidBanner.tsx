// A banner under the top bar while a boss is out near the player: its name,
// its shared health when the server puts it on the point (a boss fought as
// duels), how far, and "Fight the boss", which opens the boss point's sheet
// (where reach is judged). costquest-ios Features/RaidsFeature.swift
// RaidBanner, placed by Roam/RoamHomeView.swift worldBanners (line ~109).
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";

import { distanceM, distanceText, type LatLng } from "@/features/game/geo";
import { nearestBoss, RAID_COLOR, raidHp } from "@/features/game/raids";
import type { QuestPoint } from "@/features/game/wire";

import { GameButton } from "./kit";
import { RaidBadge, RaidHPBar } from "./RaidParts";
import { GF } from "./theme";

/** Re-reads the clock every `ms` (the boss's window is minutes long; iOS ticks every 30 s). */
export function useMinuteClock(ms = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export default function RaidBanner({
  points,
  fix,
  onFight,
}: {
  /** Nearby points, nearest first (GameRoot's `nearby`). */
  points: QuestPoint[];
  /** Where the player is (the store's `fix`): a value, so the distance re-renders with it. */
  fix: LatLng | null;
  /** Opens the boss point's sheet. Omit to show no button. */
  onFight?: (boss: QuestPoint) => void;
}) {
  const now = useMinuteClock();
  const boss = nearestBoss(points, now);
  if (!boss) return null;
  const hp = raidHp(boss);
  const away = distanceText(fix ? distanceM(fix, boss) : null);
  return (
    <Animated.View
      entering={FadeInUp.duration(250)}
      exiting={FadeOutUp.duration(180)}
      style={styles.banner}
      accessibilityLiveRegion="polite">
      <RaidBadge />
      <View style={styles.body} accessible accessibilityLabel={`A boss has appeared: ${boss.name}. ${away}.${hp ? ` Boss health ${Math.max(0, hp.left)} of ${hp.max}.` : ""}`}>
        {/* Two lines, not shrunk to fit: Android ignores minimumFontScale and
            shrank the name to nothing beside the button. */}
        <Text style={styles.title} numberOfLines={2}>
          {boss.name}
        </Text>
        {hp ? <RaidHPBar hp={hp.left} maxHp={hp.max} compact /> : null}
        <Text style={styles.sub}>{away}</Text>
      </View>
      {onFight ? (
        <GameButton title="Fight" small color={RAID_COLOR} onPress={() => onFight(boss)} accessibilityLabel={`Fight the boss: ${boss.name}`} />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // A block in GameRoot's banner column (under the top bar, left of the rail).
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 16,
    backgroundColor: "rgba(30,58,76,0.92)",
    elevation: 6,
  },
  body: { flex: 1, gap: 3 },
  title: { fontFamily: GF.display, fontSize: 15, color: "#FFF" },
  sub: { fontFamily: GF.bold, fontSize: 12, color: "rgba(255,255,255,0.8)" },
});
