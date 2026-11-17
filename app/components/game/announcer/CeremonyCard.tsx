// The Warden's ceremony card: an opening, a close, a result, full screen,
// once. Formal and plain: the line the server decided, who says it, and a tap
// to continue. It closes itself after a while; it never shows over a fight or
// a question (GameRoot only mounts it on the map or at an event's lobby).
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { FONTS } from "@/constants/fonts";
import { announcer, useAnnouncer } from "@/features/game/announcerRuntime";

import { W } from "../../waleui/kit";
import { MAX_FONT_SCALE } from "../kit";

/** How long a card stays when nobody taps it. */
export const CEREMONY_MS = 7000;

export default function CeremonyCard() {
  const { on, view } = useAnnouncer();
  const a = on ? view.ceremony : null;
  useEffect(() => {
    if (!a) return;
    const t = setTimeout(() => announcer.markShown(a.id), CEREMONY_MS);
    return () => clearTimeout(t);
  }, [a]);
  if (!a) return null;
  return (
    <Animated.View key={a.id} entering={FadeIn.duration(260)} exiting={FadeOut.duration(200)} style={[StyleSheet.absoluteFill, { zIndex: 40 }]}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(20,32,40,0.86)", alignItems: "center", justifyContent: "center", padding: 28 }}
        onPress={() => announcer.markShown(a.id)}
        accessibilityRole="button"
        accessibilityLabel={`The Warden: ${a.line}`}
        accessibilityHint="Closes the announcement"
        testID="announcer-ceremony">
        <View style={{ width: "100%", maxWidth: 420, borderRadius: 22, paddingVertical: 34, paddingHorizontal: 26, backgroundColor: W.ink, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" }}>
          <View style={{ alignSelf: "center", width: 36, height: 3, borderRadius: 2, backgroundColor: W.pink, marginBottom: 18 }} />
          <Text style={{ textAlign: "center", fontFamily: FONTS.bold, fontSize: 11, letterSpacing: 2.4, color: W.pinkTint }} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            THE WARDEN
          </Text>
          <Text style={{ marginTop: 16, textAlign: "center", fontFamily: FONTS.semibold, fontSize: 24, lineHeight: 32, color: "#FFFFFF" }} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {a.line}
          </Text>
          <Text style={{ marginTop: 24, textAlign: "center", fontFamily: FONTS.medium, fontSize: 12, color: "rgba(255,255,255,0.6)" }} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Tap to continue
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
