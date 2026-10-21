// The boss's pieces, shared by the raid screen, the banner and a boss fought
// as a duel: the crown (iOS draws SF Symbol crown.fill; Ionicons has none, so
// it is a small SVG here) and the big HP bar that drains as the crew lands
// hits. costquest-ios Features/RaidsFeature.swift (RaidHPBar, RaidLook).
import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { RAID_COLOR } from "@/features/game/raids";
import { SPRING_RAID_HP } from "@/features/game/spring";

import { MAX_FONT_SCALE } from "./kit";
import { GF, GP } from "./theme";
import { themedStyles, useThemedStyles } from "@/constants/chatTheme";

export function RaidCrown({ size = 20, color = "#FFFFFF" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      <Path d="M2.5 7.5 L7.5 12 L12 4 L16.5 12 L21.5 7.5 L19.5 18 H4.5 Z M4.5 19.5 H19.5 V21.5 H4.5 Z" fill={color} />
    </Svg>
  );
}

/** A round badge with the crown on it (the banner's and the map's boss mark). */
export function RaidBadge({ size = 34 }: { size?: number }) {
  const styles = useThemedStyles(STYLE_PAIR);
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2 }]}>
      <RaidCrown size={size * 0.56} />
    </View>
  );
}

/** The boss's health: a big bar that drains as the crew lands hits. */
export function RaidHPBar({ hp, maxHp, compact }: { hp: number; maxHp: number; compact?: boolean }) {
  const styles = useThemedStyles(STYLE_PAIR);
  const left = Math.max(0, hp);
  const share = left / Math.max(1, maxHp);
  const reduced = useReducedMotion();
  const width = useSharedValue(share);
  useEffect(() => {
    // RaidHPBar `.spring(response: 0.45, dampingFraction: 0.7)`; a plain fade-length move under Reduce Motion.
    width.set(reduced ? withTiming(share, { duration: 150 }) : withSpring(share, SPRING_RAID_HP));
  }, [share, width, reduced]);
  const fill = useAnimatedStyle(() => ({ width: `${Math.max(0, Math.min(1, width.get())) * 100}%` }));
  const height = compact ? 6 : 30;
  return (
    <View accessible accessibilityLabel={`Boss health ${left} of ${maxHp}`} style={{ gap: 6 }}>
      <View style={[styles.track, { height, borderRadius: height / 2, borderWidth: compact ? 0 : 3 }]}>
        <Animated.View style={[styles.fill, { borderRadius: height / 2, minWidth: share > 0 && !compact ? 18 : 0 }, fill]}>
          {/* berry to the raid colour, left to right, across the fill (Swift RaidHPBar). */}
          <LinearGradient colors={[GP.berry, RAID_COLOR]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
          {!compact ? <View style={styles.shine} /> : null}
        </Animated.View>
      </View>
      {!compact ? <Text style={styles.label} maxFontSizeMultiplier={MAX_FONT_SCALE}>{`HP ${left} / ${maxHp}`}</Text> : null}
    </View>
  );
}

const STYLE_PAIR = themedStyles({
  badge: { backgroundColor: RAID_COLOR, alignItems: "center", justifyContent: "center" },
  track: { backgroundColor: "rgba(30,58,76,0.6)", borderColor: "rgba(255,255,255,0.7)", overflow: "hidden" },
  fill: { height: "100%", overflow: "hidden" },
  shine: { position: "absolute", top: 3, left: 8, right: 8, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.3)" },
  label: { textShadowColor: "rgba(30,58,76,0.45)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3, fontFamily: GF.display, fontSize: 18, color: "#FFF", textAlign: "center", fontVariant: ["tabular-nums"] },
});
