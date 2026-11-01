// The rail's compass (phone hardware design 2.2): its needle always points to
// north on the map (it turns with the map's camera), and a tap switches the map
// between north up and heading up (the map turns as the phone turns, as in
// Pokemon GO). Lit while heading up is on. The "figure 8" hint sits beside it
// when the compass reads poorly. Not shown on a phone without a compass.
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, type SharedValue, useAnimatedStyle } from "react-native-reanimated";

import { HUD_FONT_SCALE, pressFeedback } from "./kit";
import { edgeOf, GF, GP } from "./theme";
import type { CompassMode } from "@/features/game/headingUp";

const D = 38;

export function CompassButton({ rot, mode, calibrate, onPress }: { rot: SharedValue<number>; mode: CompassMode; calibrate: boolean; onPress: () => void }) {
  const on = mode === "heading";
  const face = on ? GP.sun : GP.navy;
  // The needle turns with the board, so it shows where north is on screen.
  const needle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.get()}rad` }] }));
  return (
    <View>
      {calibrate ? (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={styles.hint} pointerEvents="none" accessibilityLiveRegion="polite">
          <Text style={styles.hintText} maxFontSizeMultiplier={HUD_FONT_SCALE}>
            Wave your phone in a figure 8 to calibrate the compass
          </Text>
        </Animated.View>
      ) : null}
      <Pressable
        onPressIn={pressFeedback}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={on ? "Map turns with you" : "Map north up"}
        accessibilityHint={on ? "Double tap to put north back at the top" : "Double tap to turn the map as you turn"}
        accessibilityState={{ selected: on }}
        hitSlop={(44 - D) / 2}>
        {({ pressed }) => (
          <View style={{ width: D, height: D + 4, transform: [{ scale: pressed ? 0.94 : 1 }] }}>
            <View style={[styles.circle, { top: 4, backgroundColor: edgeOf(face) }]} />
            <View style={[styles.circle, styles.face, { top: pressed ? 3 : 0, backgroundColor: face }]}>
              <Animated.View style={[styles.needle, needle]}>
                <Text style={styles.n} maxFontSizeMultiplier={1}>
                  N
                </Text>
                <Ionicons name="caret-up" size={14} color={on ? GP.ink : "#FFFFFF"} style={styles.caret} />
              </Animated.View>
            </View>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { position: "absolute", left: 0, width: D, height: D, borderRadius: D / 2 },
  face: { alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "rgba(255,255,255,0.35)", overflow: "hidden" },
  needle: { width: D - 4, height: D - 4, alignItems: "center" },
  n: { fontFamily: GF.display, fontSize: 9, lineHeight: 10, color: "#FFFFFF", marginTop: 1 },
  caret: { marginTop: -3 },
  hint: {
    position: "absolute",
    right: D + 10,
    top: 0,
    width: 190,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "rgba(20,24,40,0.88)",
  },
  hintText: { color: "#FFFFFF", fontFamily: GF.body, fontSize: 13, lineHeight: 17 },
});
