// The trivia screens' small parts, in Wale's look (features/game/triviaLook.ts):
// the sky behind every screen, the top bar (square back and close buttons,
// "COSQUEST" over the screen's name), the magenta main button and the frosted
// one under it, the frosted card, the kicker, and the question segments.
// Drawn light only: Wale's screens are light, and the trivia screen sets the
// scheme to light for everything inside it (TriviaFrontDoor.tsx).
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { type ReactNode, useEffect } from "react";
import { ActivityIndicator, Platform, Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONTS } from "@/constants/fonts";
import { SPRING_PRESS } from "@/features/game/spring";
import { type Segment, TRIVIA, TRIVIA_RADIUS, TRIVIA_SIZE } from "@/features/game/triviaLook";

import { MAX_FONT_SCALE, pressFeedback } from "./kit";

const T = TRIVIA;

/** The page: sky to near white, with a soft light behind the middle (Wale's background). */
export function TriviaBackdrop() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={[T.skyTop, "#D3E8F0", T.skyBottom]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.35)", "rgba(255,255,255,0)"]}
        locations={[0.2, 0.62, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/** A square frosted icon button (back, close). */
export function SquareButton({ icon, label, onPress, testID }: { icon: "arrow-back" | "close"; label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      onPressIn={pressFeedback}
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [styles.square, { transform: [{ scale: pressed ? 0.94 : 1 }] }]}>
      <Ionicons name={icon} size={22} color={T.ink} />
    </Pressable>
  );
}

/**
 * The top bar on every trivia screen: back on the left, "COSQUEST" over the
 * screen's name, close on the right. Either button is left out when it has
 * nowhere to go (the public web page has nothing to close to).
 */
export function TriviaTopBar({ title, onBack, onClose, backLabel = "Back", closeLabel = "Leave trivia", right }: { title: string; onBack?: (() => void) | null; onClose?: (() => void) | null; backLabel?: string; closeLabel?: string; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    // The status bar's strip stays the sky; the bar under it is a shade lighter, as on his screens.
    <View style={{ paddingTop: insets.top }}>
      <View style={styles.bar}>
      {onBack ? <SquareButton icon="arrow-back" label={backLabel} onPress={onBack} testID="trivia-back" /> : null}
      <View style={{ flex: 1, gap: 0 }}>
        <Text style={styles.brand} maxFontSizeMultiplier={1.2}>
          COSQUEST
        </Text>
        <Text style={styles.barTitle} numberOfLines={1} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
          {title}
        </Text>
      </View>
      {right}
      {onClose ? <SquareButton icon="close" label={closeLabel} onPress={onClose} testID="trivia-close" /> : null}
      </View>
    </View>
  );
}

/** Small tracked capitals: "QUESTION 6 / 7", "SELECTED CHARACTER", "FINAL SCORES". */
export function Kicker({ children, tone = "accent", style }: { children: ReactNode; tone?: "accent" | "muted"; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <Text style={[styles.kicker, { color: tone === "accent" ? T.accentText : T.muted }]} maxFontSizeMultiplier={1.3}>
        {children}
      </Text>
    </View>
  );
}

/** A frosted card with a white rim. */
export function Glass({ children, style, strong }: { children: ReactNode; style?: StyleProp<ViewStyle>; strong?: boolean }) {
  return <View style={[styles.glass, strong && { backgroundColor: T.glassStrong }, style]}>{children}</View>;
}

/** The magenta main button (Start trivia, Next question, Take another quiz), springing under the thumb. */
export function TriviaButton({
  title,
  onPress,
  icon,
  iconSide = "right",
  disabled,
  busy,
  kind = "primary",
  testID,
  style,
}: {
  title: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  iconSide?: "left" | "right";
  disabled?: boolean;
  busy?: boolean;
  /** primary: magenta with white words; quiet: frosted with ink words (Share Results). */
  kind?: "primary" | "quiet";
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const down = useSharedValue(0);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.03 * down.get() }] }));
  const primary = kind === "primary";
  const off = disabled || busy;
  const ink = primary ? T.onAccent : T.ink;
  const glyph = icon ? <Ionicons name={icon} size={20} color={ink} /> : null;
  return (
    <Animated.View style={[pressStyle, style]}>
      <Pressable
        disabled={off}
        onPressIn={() => {
          pressFeedback();
          down.set(withSpring(1, SPRING_PRESS));
        }}
        onPressOut={() => down.set(withSpring(0, SPRING_PRESS))}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: !!off, busy: !!busy }}
        testID={testID}
        style={[styles.button, primary ? styles.primary : styles.quiet, off && { opacity: 0.5 }]}>
        {busy ? (
          <ActivityIndicator color={ink} />
        ) : (
          <>
            {iconSide === "left" ? glyph : null}
            <Text style={[styles.buttonText, { color: ink }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {title}
            </Text>
            {iconSide === "right" ? glyph : null}
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

/** One segment per question; the played ones fill magenta, sliding in as each is played. */
export function Segments({ marks, onDark }: { marks: Segment[]; /** Over a picture: a light track. */ onDark?: boolean }) {
  return (
    <View style={styles.segments} importantForAccessibility="no-hide-descendants">
      {marks.map((m, i) => (
        <SegmentBar key={i} mark={m} onDark={onDark} />
      ))}
    </View>
  );
}

function SegmentBar({ mark, onDark }: { mark: Segment; onDark?: boolean }) {
  const fill = useSharedValue(mark === "done" ? 1 : 0);
  useEffect(() => {
    fill.set(withTiming(mark === "done" ? 1 : mark === "now" ? 0.35 : 0, { duration: 420 }));
  }, [mark, fill]);
  const style = useAnimatedStyle(() => ({ width: `${fill.get() * 100}%` }));
  return (
    <View style={[styles.segment, onDark && { backgroundColor: "rgba(255,255,255,0.28)" }]}>
      <Animated.View style={[styles.segmentFill, style]} />
    </View>
  );
}

/**
 * The ring under the feedback line. Wale's counts "3s" down to the next
 * question; a question's clock starts on the server the moment it opens, so
 * nothing moves on by itself here, and the ring shows what the answer paid.
 */
export function PointsRing({ text, paid }: { text: string; paid: boolean }) {
  return (
    <View style={[styles.ringOuter, { borderColor: paid ? T.accent : T.track }]} accessible accessibilityLabel={`${text} points`}>
      <Text style={styles.ringText} maxFontSizeMultiplier={1.2}>
        {text}
      </Text>
      <Text style={styles.ringSub} maxFontSizeMultiplier={1.2}>
        PTS
      </Text>
    </View>
  );
}

/** A round badge for a number on an avatar (Wale's results: the ring with a count on it). */
export function CountBadge({ n }: { n: number | string }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText} maxFontSizeMultiplier={1.2}>
        {n}
      </Text>
    </View>
  );
}

const glassShadow: ViewStyle = Platform.select<ViewStyle>({
  web: { boxShadow: "0px 8px 24px rgba(31,58,74,0.10)" },
  android: { elevation: 2 },
  default: { shadowColor: "#1F3A4A", shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
});

const accentShadow: ViewStyle = Platform.select<ViewStyle>({
  web: { boxShadow: "0px 8px 18px rgba(184,65,143,0.30)" },
  android: { elevation: 3 },
  default: { shadowColor: T.accent, shadowOpacity: 0.3, shadowRadius: 9, shadowOffset: { width: 0, height: 6 } },
});

export const triviaShadow = { glass: glassShadow, accent: accentShadow };

const styles = StyleSheet.create({
  // His bar: 73 pt under the status bar, 43 pt square buttons 20 pt in from the edges, a hairline under it.
  bar: { flexDirection: "row", alignItems: "center", gap: 13, minHeight: 73, paddingHorizontal: 20, paddingVertical: 14, backgroundColor: T.bar, borderBottomWidth: 1, borderBottomColor: T.barRule },
  square: { width: TRIVIA_SIZE.square, height: TRIVIA_SIZE.square, borderRadius: TRIVIA_RADIUS.icon, alignItems: "center", justifyContent: "center", backgroundColor: T.glassStrong, borderWidth: 1, borderColor: T.rim },
  brand: { fontFamily: FONTS.extrabold, fontSize: 10, lineHeight: 14, letterSpacing: 1.5, color: T.accentText },
  barTitle: { fontFamily: FONTS.bold, fontSize: 20, lineHeight: 26, color: T.ink },
  kicker: { fontFamily: FONTS.bold, fontSize: 11, lineHeight: 15, letterSpacing: 1.6 },
  glass: { borderRadius: TRIVIA_RADIUS.card, backgroundColor: T.glass, borderWidth: 1.5, borderColor: T.rim, ...glassShadow },
  button: { minHeight: TRIVIA_SIZE.button, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 20, borderRadius: TRIVIA_RADIUS.button },
  primary: { backgroundColor: T.accent, ...accentShadow },
  quiet: { backgroundColor: T.glassStrong, borderWidth: 1.5, borderColor: T.rim },
  buttonText: { fontFamily: FONTS.semibold, fontSize: 16, lineHeight: 22 },
  segments: { flexDirection: "row", gap: 5 },
  segment: { flex: 1, height: 3, borderRadius: 2, overflow: "hidden", backgroundColor: T.track },
  segmentFill: { height: 3, borderRadius: 2, backgroundColor: T.accent },
  ringOuter: { width: TRIVIA_SIZE.ring, height: TRIVIA_SIZE.ring, borderRadius: TRIVIA_SIZE.ring / 2, alignItems: "center", justifyContent: "center", borderWidth: 3, backgroundColor: T.glassStrong, alignSelf: "center", ...glassShadow },
  ringText: { fontFamily: FONTS.bold, fontSize: 16, lineHeight: 20, color: T.ink, fontVariant: ["tabular-nums"] },
  ringSub: { fontFamily: FONTS.semibold, fontSize: 9, lineHeight: 11, letterSpacing: 1, color: T.muted },
  badge: { minWidth: 29, height: 29, paddingHorizontal: 6, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: T.accent, borderWidth: 2, borderColor: "#FFFFFF" },
  badgeText: { fontFamily: FONTS.bold, fontSize: 13, lineHeight: 17, color: T.onAccent },
});
