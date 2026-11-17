// "Turn your phone sideways": shown before the open map or a fight goes landscape
// (build 21, the 9 Nov meeting). The screen only turns when the player taps Ready
// (features/game/orientation.ts locks it, so it works with rotation lock on).
// "Stay in portrait" keeps portrait for the rest of the session. Light: one icon
// that tips over and back, no images. testIDs: tilt-notice, tilt-ready, tilt-portrait.
import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";

import { GameButton, MAX_FONT_SCALE } from "./kit";
import { GF, GP } from "./theme";

export function TiltNotice({ what, onReady, onPortrait }: { what: "fight" | "map"; onReady: () => void; onPortrait: () => void }) {
  const reduce = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (reduce) {
      turn.value = 1;
      return;
    }
    // portrait, tip over to landscape, hold, back: about 2.4 s a loop
    turn.value = withRepeat(
      withSequence(
        withDelay(400, withTiming(1, { duration: 650, easing: Easing.inOut(Easing.cubic) })),
        withDelay(900, withTiming(0, { duration: 450, easing: Easing.inOut(Easing.quad) })),
      ),
      -1,
    );
  }, [reduce, turn]);
  const phone = useAnimatedStyle(() => ({ transform: [{ rotate: `${-90 * turn.value}deg` }] }));
  const arrow = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * turn.value }));
  return (
    <View style={styles.root} testID="tilt-notice" accessibilityViewIsModal>
      <View style={styles.art} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Animated.View style={[styles.arrow, arrow]}>
          <Ionicons name="refresh" size={30} color={GP.sun} />
        </Animated.View>
        <Animated.View style={phone}>
          <Ionicons name="phone-portrait-outline" size={96} color="#FFF" />
        </Animated.View>
      </View>
      <Text style={styles.title} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header">
        Turn your phone sideways
      </Text>
      <Text style={styles.sub} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {what === "fight" ? "This fight plays in landscape. Hold your phone with both hands." : "The map opens in landscape. Hold your phone sideways to explore."}
      </Text>
      <GameButton title="Ready" color={GP.sun} onPress={onReady} testID="tilt-ready" style={styles.ready} />
      <Pressable onPress={onPortrait} hitSlop={10} accessibilityRole="button" testID="tilt-portrait">
        <Text style={styles.portrait} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Stay in portrait
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: GP.navy, alignItems: "center", justifyContent: "center", padding: 28, gap: 14, zIndex: 50 },
  art: { width: 150, height: 150, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  arrow: { position: "absolute", top: 4, right: 8 },
  title: { fontFamily: GF.display, fontSize: 26, color: "#FFF", textAlign: "center" },
  sub: { fontFamily: GF.body, fontSize: 15, lineHeight: 21, color: "rgba(255,255,255,0.78)", textAlign: "center", maxWidth: 320 },
  ready: { alignSelf: "stretch", maxWidth: 320, width: "100%", marginTop: 10 },
  portrait: { fontFamily: GF.body, fontSize: 15, color: "rgba(255,255,255,0.75)", textDecorationLine: "underline", paddingVertical: 8 },
});
