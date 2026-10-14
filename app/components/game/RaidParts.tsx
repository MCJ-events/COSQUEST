// The boss's pieces, shared by the raid screen, the banner and a boss fought
// as a duel: the crown (iOS draws SF Symbol crown.fill; Ionicons has none, so
// it is a small SVG here) and the big HP bar that drains as the crew lands
// hits. costquest-ios Features/RaidsFeature.swift (RaidHPBar, RaidLook).
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { RAID_COLOR } from "@/features/game/raids";

import { GF, GP } from "./theme";

export function RaidCrown({ size = 20, color = "#FFFFFF" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      <Path d="M2.5 7.5 L7.5 12 L12 4 L16.5 12 L21.5 7.5 L19.5 18 H4.5 Z M4.5 19.5 H19.5 V21.5 H4.5 Z" fill={color} />
    </Svg>
  );
}

/** A round badge with the crown on it (the banner's and the map's boss mark). */
export function RaidBadge({ size = 34 }: { size?: number }) {
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2 }]}>
      <RaidCrown size={size * 0.56} />
    </View>
  );
}

/** The boss's health: a big bar that drains as the crew lands hits. */
export function RaidHPBar({ hp, maxHp, compact }: { hp: number; maxHp: number; compact?: boolean }) {
  const left = Math.max(0, hp);
  const share = left / Math.max(1, maxHp);
  const width = useSharedValue(share);
  useEffect(() => {
    width.set(withSpring(share, { damping: 14, stiffness: 120 }));
  }, [share, width]);
  const fill = useAnimatedStyle(() => ({ width: `${Math.max(0, Math.min(1, width.get())) * 100}%` }));
  const height = compact ? 6 : 30;
  return (
    <View accessible accessibilityLabel={`Boss health ${left} of ${maxHp}`} style={{ gap: 6 }}>
      <View style={[styles.track, { height, borderRadius: height / 2, borderWidth: compact ? 0 : 3 }]}>
        <Animated.View style={[styles.fill, { borderRadius: height / 2, minWidth: share > 0 && !compact ? 18 : 0, borderRightWidth: compact ? 0 : 6 }, fill]}>
          {!compact ? <View style={styles.shine} /> : null}
        </Animated.View>
      </View>
      {!compact ? <Text style={styles.label}>{`HP ${left} / ${maxHp}`}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { backgroundColor: RAID_COLOR, alignItems: "center", justifyContent: "center" },
  track: { backgroundColor: "rgba(30,58,76,0.6)", borderColor: "rgba(255,255,255,0.7)", overflow: "hidden" },
  // iOS draws berry → raid colour; one colour with a berry edge reads the same without a gradient dependency.
  fill: { height: "100%", backgroundColor: RAID_COLOR, borderRightColor: GP.berry },
  shine: { position: "absolute", top: 3, left: 8, right: 8, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.3)" },
  label: { fontFamily: GF.display, fontSize: 18, color: "#FFF", textAlign: "center", fontVariant: ["tabular-nums"] },
});
