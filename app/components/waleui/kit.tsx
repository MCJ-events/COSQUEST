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
import { useGlobalSearchParams } from "expo-router";
import { type ComponentProps, createContext, type ReactNode, useContext, useState } from "react";
import { Pressable, ScrollView, type StyleProp, Text, type TextStyle, View, type ViewStyle, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Ellipse, Path, Polygon, Rect } from "react-native-svg";

import { FONTS } from "@/constants/fonts";
import { TAB_BAR_HEIGHT, tabBarBottom } from "@/constants/tabBar";
import { fitFrame, pinnedBarTop } from "@/features/waleui/fit";
import { useIsDesktop } from "@/hooks/useDesktop";

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
 * screen scroll.
 *
 * `fit` (build 27) is for his one-screen frames (the Homepage): the canvas is
 * as tall as the room between the status bar and the bottom ("tabs": the top of
 * the floating tab bar; "screen": the home bar inset), so it never leaves an
 * empty band on a tall phone. The frame keeps the phone's width and gets the
 * spare height as extra frame px under it (read with useCanvasExtra); on a phone
 * too short for it the frame is scaled to the height and centred instead
 * (features/waleui/fit.ts). The background runs edge to edge behind the bars.
 *
 * `footer` (build 27) is for his frames that are one Pro Max screen tall with an
 * action bar at the foot (customiser DONE, weapon page TRY, lobby tabs and chat,
 * the Faction button): on a shorter phone the frame from `footer.y` down stays
 * on screen above the home bar, at his size, and the rest scrolls above it. At
 * his frame's own size the bar is exactly where his frame has it.
 */
export type CanvasFooter = {
  /** Frame y where the pinned bar starts. */
  y: number;
  /** Its height in frame px (default: to the foot of the frame). */
  h?: number;
  /** Colour under the bar, behind the home bar inset (default: the gradient's last colour). */
  base?: string;
  children: ReactNode;
};
const SHOTS = process.env.EXPO_PUBLIC_E2E === "1";

const CanvasExtra = createContext(0);

/** Frame px the fitted canvas adds under the frame's own height (0 for scrolling frames and at his frame's size). */
export function useCanvasExtra(): number {
  return useContext(CanvasExtra);
}

export function DesignCanvas({ width, height, children, colors, horizontal, testID, fit, footer }: { width: number; height: number; children: ReactNode; colors?: readonly [string, string, ...string[]]; horizontal?: boolean; testID?: string; fit?: "tabs" | "screen"; footer?: CanvasFooter }) {
  if (fit) {
    return (
      <FittedCanvas width={width} height={height} colors={colors} horizontal={horizontal} testID={testID} fit={fit}>
        {children}
      </FittedCanvas>
    );
  }
  return (
    <ScrollingCanvas width={width} height={height} colors={colors} horizontal={horizontal} testID={testID} footer={footer}>
      {children}
    </ScrollingCanvas>
  );
}

function ScrollingCanvas({ width, height, children, colors, horizontal, testID, footer }: { width: number; height: number; children: ReactNode; colors?: readonly [string, string, ...string[]]; horizontal?: boolean; testID?: string; footer?: CanvasFooter }) {
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scale = win.width / width;
  const grad = colors ?? ([W.bgTop, W.bgLight] as const);
  // Test builds only: `?shotY=<frame px>` opens a tall frame already scrolled there, so the
  // measuring tools can photograph a whole frame in steps (experiments/build23-ui/tools).
  const { shotY } = useGlobalSearchParams<{ shotY?: string }>();
  const startY = SHOTS && shotY ? Math.max(0, Number(shotY) || 0) * scale : 0;
  const gradStart = horizontal ? { x: 0, y: 0.5 } : { x: 0.5, y: 0 };
  const gradEnd = horizontal ? { x: 1, y: 0.5 } : { x: 0.5, y: 1 };
  // with a pinned bar the scrolling part ends where the bar starts, and leaves room under it for the bar
  const bodyH = footer ? footer.y : height;
  const barH = footer ? (footer.h ?? height - footer.y) : 0;
  // the bar sits right under the frame when the whole frame fits, else on the home bar inset
  const [roomH, setRoomH] = useState<number | null>(null);
  const screenH = roomH ?? win.height;
  const barTop = pinnedBarTop({ screenH, top: insets.top, bottom: insets.bottom, scale, barY: bodyH, barH });
  return (
    <View
      style={{ flex: 1, backgroundColor: grad[0] }}
      onLayout={footer ? (e) => {
        const h = e.nativeEvent.layout.height;
        if (h > 0 && (roomH === null || Math.abs(roomH - h) > 0.5)) setRoomH(h);
      } : undefined}
    >
      <ScrollView key={startY} contentOffset={{ x: 0, y: startY }} style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + barH * scale }} bounces={false} showsVerticalScrollIndicator={false} testID={testID ? `${testID}-scroll` : undefined}>
        <View style={{ width: win.width, height: bodyH * scale, overflow: "hidden" }}>
          <View testID={testID} style={{ position: "absolute", left: 0, top: 0, width, height, transformOrigin: "top left", transform: [{ scale }] }}>
            <LinearGradient colors={grad} start={gradStart} end={gradEnd} style={{ position: "absolute", left: 0, top: 0, width, height }} />
            {children}
          </View>
        </View>
      </ScrollView>
      {footer ? (
        <View style={{ position: "absolute", left: 0, right: 0, top: barTop, bottom: 0, backgroundColor: footer.base ?? grad[grad.length - 1] }}>
          <View style={{ width: win.width, height: barH * scale, overflow: "hidden" }}>
            {/* the same frame, shifted so his y = footer.y is the bar's top edge */}
            <View testID={testID ? `${testID}-pinned` : undefined} style={{ position: "absolute", left: 0, top: -footer.y * scale, width, height, transformOrigin: "top left", transform: [{ scale }] }}>
              <LinearGradient colors={grad} start={gradStart} end={gradEnd} style={{ position: "absolute", left: 0, top: 0, width, height }} />
              {footer.children}
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function FittedCanvas({ width, height, children, colors, horizontal, testID, fit }: { width: number; height: number; children: ReactNode; colors?: readonly [string, string, ...string[]]; horizontal?: boolean; testID?: string; fit: "tabs" | "screen" }) {
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const desktop = useIsDesktop();
  // the screen's own size once laid out (the window until then): right on split screens and in a resized browser
  const [room, setRoom] = useState<{ w: number; h: number } | null>(null);
  const bottom = fit === "tabs" && !desktop ? tabBarBottom(insets.bottom) + TAB_BAR_HEIGHT : insets.bottom;
  const f = fitFrame({ width: room?.w ?? win.width, height: room?.h ?? win.height, top: insets.top, bottom, frameW: width, frameH: height });
  const grad = colors ?? ([W.bgTop, W.bgLight] as const);
  const h = height + f.extra;
  return (
    <View
      style={{ flex: 1, backgroundColor: grad[0], overflow: "hidden" }}
      onLayout={(e) => {
        const { width: w, height: hh } = e.nativeEvent.layout;
        if (w > 0 && hh > 0 && (!room || Math.abs(room.w - w) > 0.5 || Math.abs(room.h - hh) > 0.5)) setRoom({ w, h: hh });
      }}
    >
      {/* his gradient from the top of the screen to the bottom, behind the status bar and the tab bar */}
      <LinearGradient colors={grad} start={horizontal ? { x: 0, y: 0.5 } : { x: 0.5, y: 0 }} end={horizontal ? { x: 1, y: 0.5 } : { x: 0.5, y: 1 }} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
      <View style={{ position: "absolute", left: f.left, top: insets.top, width: width * f.scale, height: h * f.scale }}>
        <View testID={testID} style={{ position: "absolute", left: 0, top: 0, width, height: h, transformOrigin: "top left", transform: [{ scale: f.scale }] }}>
          <CanvasExtra.Provider value={f.extra}>{children}</CanvasExtra.Provider>
        </View>
      </View>
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

// ---------- Wale's own art (build 23) ----------

/**
 * A picture cut out of Wale's Figma (assets/images/waleui), at its measured box. Decoration only: it never takes a
 * tap, so the button under or around it keeps working.
 */
export function Art({ x, y, w, h, source, testID, opacity }: { x: number; y: number; w: number; h: number; source: ImageSource | number; testID?: string; opacity?: number }) {
  return (
    <View testID={testID} pointerEvents="none" style={{ position: "absolute", left: x, top: y, width: w, height: h, opacity }}>
      <Image source={source} style={{ width: w, height: h }} contentFit="fill" />
    </View>
  );
}

/** The same picture inside a row (a button's icon), at its Figma size. */
export function ArtIcon({ w, h, source, style }: { w: number; h: number; source: ImageSource | number; style?: StyleProp<ViewStyle> }) {
  return (
    <View pointerEvents="none" style={[{ width: w, height: h }, style]}>
      <Image source={source} style={{ width: w, height: h }} contentFit="fill" />
    </View>
  );
}

/**
 * The line icons in his Armory, weapon page and Social lobby frames are the Lucide set (ISC licence,
 * lucide.dev), which the app does not ship as a font, so the few he uses are drawn here from the same
 * 24 px paths. Each entry: paths, then circles as [cx, cy, r], then rects as [x, y, w, h, rx].
 */
const LUCIDE = {
  users: { d: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"], c: [[9, 7, 4]] },
  "person-standing": { d: ["m9 20 3-6 3 6", "m6 8 6 2 6-2", "M12 10v4"], c: [[12, 5, 1]] },
  "message-square": { d: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"] },
  "message-circle": { d: ["M7.9 20A9 9 0 1 0 4 16.1L2 22Z"] },
  shirt: { d: ["M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"] },
  shield: { d: ["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"] },
  send: { d: ["m22 2-7 20-4-9-9-4Z", "M22 2 11 13"] },
  "map-pin": { d: ["M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"], c: [[12, 10, 3]] },
  flag: { d: ["M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z", "M4 22v-7"] },
  ticket: { d: ["M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z", "M13 5v2", "M13 17v2", "M13 11v2"] },
  // his frame has the coin with the "1" on the right, so this is the Lucide drawing mirrored (the 1 kept the right way round)
  coins: { d: ["M5.91 10.37A6 6 0 1 0 13.66 18", "M15 6h1v4", "m7.29 13.88-.7.71 2.82 2.82"], c: [[16, 8, 6]] },
  move: { d: ["M12 2v20", "m15 19-3 3-3-3", "m19 9 3 3-3 3", "M2 12h20", "m5 9-3 3 3 3", "m9 5 3-3 3 3"] },
  menu: { d: ["M4 6h16", "M4 12h16", "M4 18h16"] },
  x: { d: ["M18 6 6 18", "m6 6 12 12"] },
  "check-circle": { d: ["m9 12 2 2 4-4"], c: [[12, 12, 10]] },
  "arrow-right": { d: ["M5 12h14", "m12 5 7 7-7 7"] },
  "arrow-up": { d: ["m5 12 7-7 7 7", "M12 19V5"] },
  "chevron-right": { d: ["m9 18 6-6-6-6"] },
  "chevron-down": { d: ["m6 9 6 6 6-6"] },
  check: { d: ["M20 6 9 17l-5-5"] },
  wifi: { d: ["M12 20h.01", "M2 8.82a15 15 0 0 1 20 0", "M5 12.859a10 10 0 0 1 14 0", "M8.5 16.429a5 5 0 0 1 7 0"] },
  lock: { d: ["M7 11V7a5 5 0 0 1 10 0v4"], r: [[3, 11, 18, 11, 2]] },
} as const satisfies Record<string, { d: readonly string[]; c?: readonly (readonly number[])[]; r?: readonly (readonly number[])[] }>;

export type LineIconName = keyof typeof LUCIDE;

export function LineIcon({ name, size, color = W.ink, stroke = 2 }: { name: LineIconName; size: number; color?: string; stroke?: number }) {
  const g: { d: readonly string[]; c?: readonly (readonly number[])[]; r?: readonly (readonly number[])[] } = LUCIDE[name];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {g.d.map((d, i) => (
        <Path key={`p${i}`} d={d} stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ))}
      {(g.c ?? []).map((c, i) => (
        <Circle key={`c${i}`} cx={c[0]} cy={c[1]} r={c[2]} stroke={color} strokeWidth={stroke} fill="none" />
      ))}
      {(g.r ?? []).map((r, i) => (
        <Rect key={`r${i}`} x={r[0]} y={r[1]} width={r[2]} height={r[3]} rx={r[4]} stroke={color} strokeWidth={stroke} fill="none" />
      ))}
    </Svg>
  );
}

/** The outlined hexagon beside ENTER QUEST (a plain outline in his file, so it is drawn, not a picture). */
export function Hexagon({ w, h, color = "#FFFFFF", stroke = 2 }: { w: number; h: number; color?: string; stroke?: number }) {
  return (
    <Svg width={w} height={h} viewBox="0 0 20 22">
      <Polygon points="10,1.6 18,6.2 18,15.8 10,20.4 2,15.8 2,6.2" stroke={color} strokeWidth={stroke * (20 / w)} strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

/** His filled padlock beside NOT OWNED on the Armory cards (a solid lock with a light bar in its body). */
export function Padlock({ size, color = W.inkSoft }: { size: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M7.5 11V7.5a4.5 4.5 0 0 1 9 0V11" stroke={color} strokeWidth={2.6} fill="none" strokeLinecap="round" />
      <Rect x={3.5} y={10} width={17} height={12} rx={2.5} fill={color} />
      <Rect x={7.5} y={15} width={9} height={2.4} rx={1.2} fill="#FFFFFF" opacity={0.85} />
    </Svg>
  );
}

/** The foot of his long frames with his Lucide wifi glyph ("COSQUEST / ARMORY" left, "Connected" right). */
export function WaleFooter({ y, w, path, testID, x = 20.5 }: { y: number; w: number; path: string; testID?: string; x?: number }) {
  return (
    <>
      <At x={x} y={y - 4.5}>
        <T size={8} weight={700} color={W.inkSoft} spacing={0.4} style={{ lineHeight: 10 }} testID={testID}>
          {path}
        </T>
      </At>
      <At x={w - 20 - 70} y={y - 7} w={70} style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 4 }}>
        <LineIcon name="wifi" size={11} color={W.slate} stroke={2.4} />
        <T size={9} weight={400} color={W.slate}>
          Connected
        </T>
      </At>
    </>
  );
}
