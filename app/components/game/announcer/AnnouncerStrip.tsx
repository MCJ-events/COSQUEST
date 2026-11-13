// The Warden's strip on the map: one line under the top bar, in Wale's ink and
// pink (components/waleui/kit.tsx W). It shows what the server said, nothing
// else: no buttons, no reward, no hype. It goes when the line expires.
import { Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { FONTS } from "@/constants/fonts";
import { useAnnouncer } from "@/features/game/announcerRuntime";

import { W } from "../../waleui/kit";
import { HUD_FONT_SCALE } from "../kit";

export default function AnnouncerStrip() {
  const { on, view } = useAnnouncer();
  const a = on ? view.strip : null;
  if (!a) return null;
  return (
    <Animated.View key={a.id} entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: 12,
          backgroundColor: "rgba(40,66,78,0.92)",
          borderLeftWidth: 3,
          borderLeftColor: W.pink,
        }}
        accessible
        accessibilityRole="text"
        accessibilityLabel={`The Warden: ${a.line}`}
        testID="announcer-strip">
        <Text style={{ fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 1.6, color: W.pinkTint }} maxFontSizeMultiplier={HUD_FONT_SCALE}>
          WARDEN
        </Text>
        <Text style={{ flex: 1, fontFamily: FONTS.medium, fontSize: 13, color: "#FFFFFF" }} numberOfLines={2} maxFontSizeMultiplier={HUD_FONT_SCALE}>
          {a.line}
        </Text>
      </View>
    </Animated.View>
  );
}
