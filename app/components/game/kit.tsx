// The game's chunky controls (costquest-ios UI/GameKit.swift): a raised
// button with a darker edge that presses down, chips, a progress bar.
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from "react-native";

import { edgeOf, GF, GP } from "./theme";

export function GameButton({
  title,
  color = GP.sun,
  onPress,
  disabled,
  small,
  icon,
  style,
  accessibilityLabel,
}: {
  title: string;
  color?: string;
  onPress: () => void;
  disabled?: boolean;
  small?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const edge = edgeOf(color);
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!disabled }}
      style={[{ opacity: disabled ? 0.5 : 1 }, style]}>
      {({ pressed }) => (
        <View style={[styles.edge, { backgroundColor: edge, paddingBottom: pressed ? 1 : 5, marginTop: pressed ? 4 : 0 }]}>
          <View style={[styles.face, small && styles.faceSmall, { backgroundColor: color }]}>
            {icon}
            <Text style={[styles.title, small && styles.titleSmall]} numberOfLines={1} adjustsFontSizeToFit>
              {title}
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

export function Chip({ text, color = GP.skyDeep, light }: { text: string; color?: string; light?: boolean }) {
  return (
    <View style={[styles.chip, { backgroundColor: light ? "rgba(255,255,255,0.9)" : color }]}>
      <Text style={[styles.chipText, { color: light ? color : "#FFFFFF" }]}>{text}</Text>
    </View>
  );
}

export function ProgressBar({ value, color = GP.sun, track = "rgba(255,255,255,0.25)", height = 8 }: { value: number; color?: string; track?: string; height?: number }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: track, overflow: "hidden" }}>
      <View style={{ width: `${v * 100}%`, height, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}

/** A display title with a hard drop edge (GameTitle). */
export function GameTitle({ text, size = 32, color = "#FFFFFF", edge = GP.navyEdge }: { text: string; size?: number; color?: string; edge?: string }) {
  return (
    <Text
      style={{
        fontFamily: GF.display,
        fontSize: size,
        color,
        textShadowColor: edge,
        textShadowOffset: { width: 0, height: 3 },
        textShadowRadius: 0.1,
      }}
      accessibilityRole="header">
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  edge: {
    borderRadius: 18,
  },
  face: {
    minHeight: 54,
    borderRadius: 18,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  faceSmall: {
    minHeight: 40,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  title: {
    fontFamily: GF.display,
    fontSize: 19,
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },
  titleSmall: {
    fontSize: 15,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: "flex-start",
  },
  chipText: {
    fontFamily: GF.bold,
    fontSize: 12,
    letterSpacing: 0.4,
  },
});
