// The shared pieces of the screens built from Wale's Figma file (11 Nov 2026).
//
// Wale is firm about his layouts, so every screen is drawn on a canvas the
// size of his frame (403 or 430 wide) with each block at the position and size
// measured from the frame, and the whole canvas is scaled to the phone's
// width. At the frame's own width one unit is one Figma pixel, which is how
// the screens are checked (cosquest-review/realism-20261111/experiments/screens).
//
// Colours are read off his frames. His Homepage and Settings frames are set in
// Poppins, which the app already loads. His other frames use Inter, which the
// app does not ship, so they are in Poppins too until that is decided.
import { Ionicons } from "@expo/vector-icons";
import { Image, type ImageSource } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, ScrollView, type StyleProp, Text, type TextStyle, View, type ViewStyle, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Ellipse, Path, Rect } from "react-native-svg";

import { FONTS } from "@/constants/fonts";

export type IconName = ComponentProps<typeof Ionicons>["name"];

/** Wale's palette, sampled from the frames. */
export const W = {
  pink: "#C34E9C",
  pinkDeep: "#B0307F",
  pinkTint: "#FBE9F4",
  ink: "#28424E",
  inkSoft: "#4F6E7C",
  slate: "#6D8B99",
  line: "rgba(255,255,255,0.85)",
  hair: "#BAD1DB",
  bgTop: "#B8DBE7",
  bgDeep: "#B3D8E5",
  bgLight: "#E9F5FA",
  band: "#DAECF3",
  card: "rgba(255,255,255,0.45)",
  cardSolid: "#FFFFFF",
  green: "#628F0A",
  purple: "#8E35B7",
  purpleDeep: "#6F2796",
  chip: "#7EAABB",
} as const;

const WEIGHT = { 400: FONTS.regular, 500: FONTS.medium, 600: FONTS.semibold, 700: FONTS.bold, 800: FONTS.extrabold } as const;

/**
 * Text on the canvas. Font scaling is off because the canvas is a fixed
 * drawing that is scaled as a whole; the labels stay readable to a screen
 * reader through the buttons' own labels.
 */
export function T({
  children,
  size,
  weight = 600,
  color = W.ink,
  spacing,
  italic,
  align,
  lines = 1,
  style,
  testID,
  upper,
}: {
  children: ReactNode;
  size: number;
  weight?: keyof typeof WEIGHT;
  color?: string;
  spacing?: number;
  italic?: boolean;
  align?: TextStyle["textAlign"];
  lines?: number;
  style?: StyleProp<TextStyle>;
  testID?: string;
  upper?: boolean;
}) {
  return (
    <Text
      allowFontScaling={false}
      numberOfLines={lines}
      testID={testID}
      style={[
        {
          fontFamily: WEIGHT[weight],
          fontSize: size,
          lineHeight: Math.round(size * 1.3),
          color,
          letterSpacing: spacing,
          fontStyle: italic ? "italic" : "normal",
          textAlign: align,
          textTransform: upper ? "uppercase" : "none",
          includeFontPadding: false,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** A block at a measured place on the canvas. */
export function At({ x, y, w, h, style, children, testID, pointerEvents }: { x: number; y: number; w?: number; h?: number; style?: StyleProp<ViewStyle>; children?: ReactNode; testID?: string; pointerEvents?: ViewStyle["pointerEvents"] }) {
  return (
    <View testID={testID} pointerEvents={pointerEvents} style={[{ position: "absolute", left: x, top: y, width: w, height: h }, style]}>
      {children}
    </View>
  );
}

/** A button at a measured place. Always a real button to a screen reader. */
export function Tap({
  x,
  y,
  w,
  h,
  label,
  onPress,
  style,
  children,
  testID,
  selected,
  disabled,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  testID?: string;
  selected?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [{ position: "absolute", left: x, top: y, width: w, height: h, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 }, style]}
    >
      {children}
    </Pressable>
  );
}

/** His frosted panel: a pale fill with a white hairline. */
export const glass = (radius: number, fill: string = W.card): ViewStyle => ({ backgroundColor: fill, borderRadius: radius, borderWidth: 1, borderColor: W.line });

/**
 * The frame-sized canvas, scaled to the phone's width. Frames taller than the
 * screen scroll. `fixedBottom` is drawn over the bottom edge and does not
 * scroll (not used by his frames today; kept for the footer if he asks).
 */
export function DesignCanvas({ width, height, children, colors, horizontal, testID }: { width: number; height: number; children: ReactNode; colors?: readonly [string, string, ...string[]]; horizontal?: boolean; testID?: string }) {
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scale = win.width / width;
  const grad = colors ?? ([W.bgTop, W.bgLight] as const);
  return (
    <View style={{ flex: 1, backgroundColor: grad[0] }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom }} bounces={false} showsVerticalScrollIndicator={false} testID={testID ? `${testID}-scroll` : undefined}>
        <View style={{ width: win.width, height: height * scale, overflow: "hidden" }}>
          <View testID={testID} style={{ position: "absolute", left: 0, top: 0, width, height, transformOrigin: "top left", transform: [{ scale }] }}>
            <LinearGradient colors={grad} start={horizontal ? { x: 0, y: 0.5 } : { x: 0.5, y: 0 }} end={horizontal ? { x: 1, y: 0.5 } : { x: 0.5, y: 1 }} style={{ position: "absolute", left: 0, top: 0, width, height }} />
            {children}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

/** A horizontal band of flat colour (his lighter header and footer bands). */
export function Band({ y, h, w, color = W.band, line }: { y: number; h: number; w: number; color?: string; line?: "top" | "bottom" }) {
  return <View style={{ position: "absolute", left: 0, top: y, width: w, height: h, backgroundColor: color, borderColor: W.line, borderBottomWidth: line === "bottom" ? 1 : 0, borderTopWidth: line === "top" ? 1 : 0 }} />;
}

/** The square icon button in his headers (back, close, shirt, menu). */
export function IconTile({ x, y, size, icon, label, onPress, testID, tone = "white", iconSize, radius = 10 }: { x: number; y: number; size: number; icon: IconName; label: string; onPress?: () => void; testID?: string; tone?: "white" | "pink" | "bare"; iconSize?: number; radius?: number }) {
  const style: ViewStyle = tone === "bare" ? {} : tone === "pink" ? { backgroundColor: "rgba(255,255,255,0.75)", borderRadius: radius, borderWidth: 1, borderColor: W.pink } : { backgroundColor: "rgba(255,255,255,0.75)", borderRadius: radius };
  return (
    <Tap x={x} y={y} w={size} h={size} label={label} onPress={onPress} testID={testID} style={style}>
      <Ionicons name={icon} size={iconSize ?? Math.round(size * 0.45)} color={W.ink} />
    </Tap>
  );
}

/** "COSQUEST / ARMORY" on the left and "Connected" on the right, at the foot of his long frames. */
export function Footer({ y, w, path, testID, x = 20.5 }: { y: number; w: number; path: string; testID?: string; x?: number }) {
  return (
    <>
      <At x={x} y={y - 4.5}>
        <T size={8} weight={700} color={W.inkSoft} spacing={0.4} style={{ lineHeight: 10 }} testID={testID}>
          {path}
        </T>
      </At>
      <At x={w - 20 - 70} y={y - 7} w={70} style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 4 }}>
        <Ionicons name="wifi" size={11} color={W.slate} />
        <T size={9} weight={400} color={W.slate}>
          Connected
        </T>
      </At>
    </>
  );
}

/** The pink "saved" tick with its label, and DONE (the foot of every customiser tab). */
export function Check({ size = 11, color = W.pink }: { size?: number; color?: string }) {
  return <Ionicons name="checkmark" size={size} color={color} />;
}

// ---------- the character preview slot ----------

export type PreviewTint = { skin: string; hair: string; outfit: string; eye: string };

/**
 * Where the character goes. It takes a 3D model (any node, for example
 * components/game/ForgeModel) or a picture; with neither it draws a neutral
 * figure tinted with the look's colours, so a choice is visible before the
 * real art exists. Wale's own art in the Figma is stylised and is NOT copied
 * in: the hyper-real characters from the realism track go in this slot.
 */
export function PreviewSlot({
  w,
  h,
  shape,
  tint,
  model,
  image,
  label,
  testID,
  headwear,
  hairStyle,
}: {
  w: number;
  h: number;
  /** "body" = head to toe, "bust" = head and shoulders. */
  shape: "body" | "bust";
  tint?: Partial<PreviewTint>;
  model?: ReactNode;
  image?: ImageSource | number | null;
  label: string;
  testID?: string;
  /** Index of the headwear worn (0 = hood). Only changes the placeholder's outline. */
  headwear?: number | null;
  hairStyle?: number | null;
}) {
  const t: PreviewTint = { skin: tint?.skin ?? "#8C9AA3", hair: tint?.hair ?? "#51616B", outfit: tint?.outfit ?? "#9FB4BF", eye: tint?.eye ?? "#FFFFFF" };
  return (
    <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: w, height: h, alignItems: "center", justifyContent: "flex-end" }}>
      {model ? (
        model
      ) : image ? (
        <Image source={image} style={{ width: w, height: h }} contentFit="contain" />
      ) : shape === "body" ? (
        <Svg width={w} height={h} viewBox="0 0 100 250" preserveAspectRatio="xMidYMax meet">
          <Ellipse cx={50} cy={244} rx={34} ry={5} fill="rgba(40,66,78,0.12)" />
          <Path d="M36 146 L32 236 Q32 242 38 242 L46 242 L50 160 L54 242 L62 242 Q68 242 68 236 L64 146 Z" fill={t.outfit} opacity={0.8} />
          <Path d="M26 70 Q50 56 74 70 L82 128 Q83 136 76 136 L72 104 L68 152 L32 152 L28 104 L24 136 Q17 136 18 128 Z" fill={t.outfit} />
          <Rect x={44} y={52} width={12} height={14} rx={4} fill={t.skin} />
          <Circle cx={50} cy={36} r={20} fill={t.skin} />
          <HeadTop cx={50} cy={36} r={20} hair={t.hair} headwear={headwear} hairStyle={hairStyle} outfit={t.outfit} />
          <Circle cx={43} cy={37} r={2.4} fill={t.eye} />
          <Circle cx={57} cy={37} r={2.4} fill={t.eye} />
        </Svg>
      ) : (
        <Svg width={w} height={h} viewBox="0 0 100 100" preserveAspectRatio="xMidYMax meet">
          <Path d="M8 100 Q10 72 34 68 L66 68 Q90 72 92 100 Z" fill={t.outfit} />
          <Rect x={42} y={56} width={16} height={16} rx={5} fill={t.skin} />
          <Circle cx={50} cy={38} r={24} fill={t.skin} />
          <HeadTop cx={50} cy={38} r={24} hair={t.hair} headwear={headwear} hairStyle={hairStyle} outfit={t.outfit} />
          <Circle cx={41.5} cy={40} r={3} fill={t.eye} />
          <Circle cx={58.5} cy={40} r={3} fill={t.eye} />
        </Svg>
      )}
    </View>
  );
}

/** The placeholder's hair or hat: a few plain outlines so eight options do not look identical. Not art. */
function HeadTop({ cx, cy, r, hair, headwear, hairStyle, outfit }: { cx: number; cy: number; r: number; hair: string; headwear?: number | null; hairStyle?: number | null; outfit: string }) {
  if (headwear !== null && headwear !== undefined) {
    const k = headwear % 4;
    if (k === 0) return <Path d={`M${cx - r - 4} ${cy + r} Q${cx - r - 6} ${cy - r - 8} ${cx} ${cy - r - 8} Q${cx + r + 6} ${cy - r - 8} ${cx + r + 4} ${cy + r} L${cx + r - 3} ${cy + 2} Q${cx} ${cy - r + 2} ${cx - r + 3} ${cy + 2} Z`} fill={outfit} />;
    if (k === 1) return <Rect x={cx - r} y={cy - r * 0.55} width={r * 2} height={r * 0.45} rx={3} fill={hair} />;
    if (k === 2) return <Path d={`M${cx - r} ${cy - 4} Q${cx - r} ${cy - r - 6} ${cx} ${cy - r - 6} Q${cx + r} ${cy - r - 6} ${cx + r} ${cy - 4} Z`} fill={hair} />;
    return <Path d={`M${cx - r - 8} ${cy - r * 0.35} L${cx} ${cy - r - 10} L${cx + r + 8} ${cy - r * 0.35} Z`} fill={hair} />;
  }
  const k = (hairStyle ?? 0) % 4;
  if (k === 0) return <Path d={`M${cx - r} ${cy - 6} Q${cx - r} ${cy - r - 2} ${cx} ${cy - r - 2} Q${cx + r} ${cy - r - 2} ${cx + r} ${cy - 6} Q${cx} ${cy - r + 4} ${cx - r} ${cy - 6} Z`} fill={hair} />;
  if (k === 1) return <Path d={`M${cx - r - 2} ${cy - 2} Q${cx - r - 2} ${cy - r - 8} ${cx} ${cy - r - 8} Q${cx + r + 2} ${cy - r - 8} ${cx + r + 2} ${cy - 2} Q${cx} ${cy - r + 6} ${cx - r - 2} ${cy - 2} Z`} fill={hair} />;
  if (k === 2) return <Path d={`M${cx - 5} ${cy - r + 4} L${cx - 3} ${cy - r - 12} L${cx + 3} ${cy - r - 12} L${cx + 5} ${cy - r + 4} Z`} fill={hair} />;
  return <Path d={`M${cx - r - 3} ${cy + r * 0.6} Q${cx - r - 5} ${cy - r - 6} ${cx} ${cy - r - 6} Q${cx + r + 5} ${cy - r - 6} ${cx + r + 3} ${cy + r * 0.6} L${cx + r - 2} ${cy - 4} Q${cx} ${cy - r + 4} ${cx - r + 2} ${cy - 4} Z`} fill={hair} />;
}

/** A small "placeholder" tag for data that is not real yet, so nobody mistakes it for live numbers. */
export function PlaceholderTag({ x, y, text = "PLACEHOLDER" }: { x: number; y: number; text?: string }) {
  return (
    <At x={x} y={y} style={{ backgroundColor: "rgba(40,66,78,0.55)", borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 }} pointerEvents="none">
      <T size={6} weight={700} color="#FFFFFF" spacing={0.5}>
        {text}
      </T>
    </At>
  );
}
