// The game's chunky controls (costquest-ios UI/GameKit.swift): a raised
// button with a gloss and a darker edge that it sinks into, round icon
// buttons, outlined titles, chips, panels, a coin and a progress bar.
// Press feedback is on press-DOWN, as on iOS: the tap sound and a light
// impact the moment the finger lands, not when it lifts.
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import type { ComponentProps, ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { AccessibilityInfo, Platform, Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from "react-native";

import { playSound } from "./sound";
import { edgeOf, GF, GP } from "./theme";

/** The press-down moment every game control shares (GameButtonStyle.onChange(of: pressed)). */
export function pressFeedback() {
  playSound("tap");
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Say something to VoiceOver / TalkBack now (iOS has no live regions). */
export function announce(text: string) {
  if (!text) return;
  AccessibilityInfo.announceForAccessibility(text);
}

/** Large text may grow, but not so far that the game's fixed shapes clip it. */
export const MAX_FONT_SCALE = 1.4;

/** The map's HUD (top bar, rail, Nearby tray, banners) sits in fixed slots over the map: it grows less. */
export const HUD_FONT_SCALE = 1.2;

const DISABLED_FACE = "#9E9E9E";

type ButtonSize = "large" | "medium" | "small";

const SIZES: Record<ButtonSize, { font: number; padH: number; padV: number; radius: number; depth: number }> = {
  large: { font: 24, padH: 22, padV: 16, radius: 20, depth: 6 },
  medium: { font: 20, padH: 22, padV: 12, radius: 20, depth: 6 },
  small: { font: 16, padH: 14, padV: 8, radius: 14, depth: 4 },
};

export function GameButton({
  title,
  color = GP.sun,
  onPress,
  disabled,
  small,
  size,
  icon,
  style,
  accessibilityLabel,
  accessibilityHint,
}: {
  title: string;
  color?: string;
  onPress: () => void;
  disabled?: boolean;
  /** Same as size="small" (kept for the screens written before sizes). */
  small?: boolean;
  size?: ButtonSize;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const s = SIZES[size ?? (small ? "small" : "large")];
  const face = disabled ? DISABLED_FACE : color;
  const edge = edgeOf(face);
  return (
    <Pressable
      onPressIn={() => {
        if (!disabled) pressFeedback();
      }}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      style={style}>
      {({ pressed }) => (
        <View style={{ paddingBottom: s.depth, transform: [{ translateY: pressed ? 1 : 0 }] }}>
          <View style={[StyleSheet.absoluteFill, { top: s.depth, borderRadius: s.radius, backgroundColor: edge }]} />
          <LinearGradient
            colors={[withAlpha(face, 0.92), face]}
            style={[
              styles.face,
              {
                borderRadius: s.radius,
                paddingHorizontal: s.padH,
                paddingVertical: s.padV,
                transform: [{ translateY: pressed ? s.depth - 1 : 0 }],
              },
            ]}>
            {/* The gloss that makes it a toy, not a form. */}
            <View pointerEvents="none" style={[styles.gloss, { borderRadius: s.radius }]} />
            {icon}
            <Text style={[styles.title, { fontSize: s.font }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {title}
            </Text>
          </LinearGradient>
        </View>
      )}
    </Pressable>
  );
}

/** A round icon button in the same family (GameIconButtonStyle): rail, corners, More tiles. */
export function GameIconButton({
  icon,
  color = GP.navy,
  diameter = 46,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  badge,
  style,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  color?: string;
  diameter?: number;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  /** A count in a berry capsule at the top right (dailies left, cards). */
  badge?: number | string | null;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPressIn={pressFeedback}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${accessibilityLabel}, ${badge}` : accessibilityLabel}
      accessibilityHint={accessibilityHint}
      hitSlop={Math.max(0, (44 - diameter) / 2)}
      style={style}>
      {({ pressed }) => (
        <View style={{ width: diameter, height: diameter + 4, transform: [{ scale: pressed ? 0.94 : 1 }] }}>
          <View style={[styles.circle, { width: diameter, height: diameter, borderRadius: diameter / 2, top: 4, backgroundColor: edgeOf(color) }]} />
          <View
            style={[
              styles.circle,
              styles.iconFace,
              { width: diameter, height: diameter, borderRadius: diameter / 2, top: pressed ? 3 : 0, backgroundColor: color },
            ]}>
            <Ionicons name={icon} size={diameter * 0.44} color="#FFFFFF" />
          </View>
          {badge ? (
            <View style={styles.badge} pointerEvents="none">
              <Text style={styles.badgeText} maxFontSizeMultiplier={1.2}>
                {badge}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

/** A small caps label chip (GameChip): "LIVE", "FREE", "RARE". `light` is the white variant for dark faces. */
export function Chip({ text, color = GP.skyDeep, light }: { text: string; color?: string; light?: boolean }) {
  return (
    <View
      style={[
        styles.chip,
        light
          ? { backgroundColor: "rgba(255,255,255,0.92)", borderColor: "rgba(255,255,255,0.5)" }
          : { backgroundColor: color, borderColor: "rgba(255,255,255,0.5)", ...dropEdge(edgeOf(color), 3) },
      ]}>
      <Text style={[styles.chipText, { color: light ? color : "#FFFFFF" }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {text.toUpperCase()}
      </Text>
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

/**
 * A big title with a thick outline and a drop shadow (GameTitle): eight
 * offset copies make the outline, as on iOS (neither platform strokes text).
 * Read as one element. `edge` is the outline colour.
 */
export function GameTitle({ text, size = 40, color = "#FFFFFF", edge = GP.ink }: { text: string; size?: number; color?: string; edge?: string }) {
  const r = size * 0.06;
  const font = { fontFamily: GF.display, fontSize: size, lineHeight: size * 1.18, textAlign: "center" as const };
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={text} style={{ alignSelf: "center" }}>
      <View style={{ transform: [{ translateY: size * 0.09 }] }} importantForAccessibility="no-hide-descendants">
        <Text style={[font, { color: "rgba(0,0,0,0.3)" }]} maxFontSizeMultiplier={1.2}>
          {text}
        </Text>
      </View>
      {OUTLINE.map(([dx, dy], i) => (
        <View key={i} style={[StyleSheet.absoluteFill, { transform: [{ translateX: dx * r }, { translateY: dy * r }] }]} importantForAccessibility="no-hide-descendants">
          <Text style={[font, { color: edge }]} maxFontSizeMultiplier={1.2}>
            {text}
          </Text>
        </View>
      ))}
      <View style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants">
        <Text style={[font, { color }]} maxFontSizeMultiplier={1.2}>
          {text}
        </Text>
      </View>
    </View>
  );
}

const OUTLINE = Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)] as const);

/** A heading on a light page (GameHeading): heavy slate type, no outline. */
export function GameHeading({ text, size = 34 }: { text: string; size?: number }) {
  return (
    <Text
      accessibilityRole="header"
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      style={{ fontFamily: GF.display, fontSize: size, color: GP.ink, textShadowColor: "rgba(255,255,255,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 0.1 }}>
      {text}
    </Text>
  );
}

/** A raised card (GamePanel): cream face, a thick darker base, a white rim. */
export function GamePanel({ children, face = GP.cream, padding = 18, style }: { children: ReactNode; face?: string; padding?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ paddingBottom: 6 }, style]}>
      <View style={[StyleSheet.absoluteFill, { top: 6, borderRadius: 24, backgroundColor: withAlpha(edgeOf(face), 0.9) }]} />
      <View style={[styles.panel, { backgroundColor: face, padding }]}>{children}</View>
    </View>
  );
}

/** A coin, drawn (GameCoin), for CosCoin counts. */
export function GameCoin({ size = 26 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={[StyleSheet.absoluteFill, { top: size * 0.08, borderRadius: size / 2, backgroundColor: GP.coinDeep }]} />
      <LinearGradient colors={["#FFCC40", GP.coin]} style={[StyleSheet.absoluteFill, { borderRadius: size / 2, alignItems: "center", justifyContent: "center" }]}>
        <View
          style={{
            position: "absolute",
            top: size * 0.14,
            left: size * 0.14,
            right: size * 0.14,
            bottom: size * 0.14,
            borderRadius: size,
            borderWidth: size * 0.07,
            borderColor: "rgba(255,255,255,0.6)",
          }}
        />
        <Text style={{ fontFamily: GF.display, fontSize: size * 0.55, color: GP.coinDeep, lineHeight: size * 0.7 }} maxFontSizeMultiplier={1}>
          C
        </Text>
      </LinearGradient>
    </View>
  );
}

/** A hard drop edge under a shape (`.shadow(radius: 0, y:)` on iOS). */
export function dropEdge(color: string, y: number): ViewStyle {
  return Platform.OS === "ios"
    ? { shadowColor: color, shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: y } }
    : { borderBottomWidth: y, borderBottomColor: color };
}

/** `#RRGGBB` with an alpha. */
export function withAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

const styles = StyleSheet.create({
  face: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    overflow: "hidden",
  },
  gloss: {
    position: "absolute",
    top: 5,
    left: 10,
    right: 10,
    height: 10,
    backgroundColor: "rgba(255,255,255,0.28)",
  },
  title: {
    fontFamily: GF.display,
    color: "#FFFFFF",
    textShadowColor: "rgba(0,0,0,0.28)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 0.1,
  },
  circle: { position: "absolute", left: 0 },
  iconFace: { alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "rgba(255,255,255,0.35)" },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: GP.berry,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontFamily: GF.display, fontSize: 12, color: "#FFFFFF" },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1.5,
    alignSelf: "flex-start",
  },
  chipText: {
    fontFamily: GF.display,
    fontSize: 14,
    letterSpacing: 1,
  },
  panel: {
    borderRadius: 24,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.6)",
  },
});
