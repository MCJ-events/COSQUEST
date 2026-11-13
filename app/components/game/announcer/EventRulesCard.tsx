// The event rules card at a live event's lobby: the event, the countdown to
// its start by the server's clock, and its rules as the Warden states them
// (GET /v1/warden/events/{id}: the run sheet's rules line once it opens).
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { FONTS } from "@/constants/fonts";
import { rulesCard } from "@/features/game/announcer";
import { useAnnouncer } from "@/features/game/announcerRuntime";

import { W } from "../../waleui/kit";
import { MAX_FONT_SCALE } from "../kit";

export default function EventRulesCard() {
  const { on, event, skewMs } = useAnnouncer();
  const [now, setNow] = useState(() => Date.now());
  const counting = on && event !== null && event.status === "scheduled";
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [counting]);
  if (!on || !event) return null;
  const card = rulesCard(event, now, skewMs);
  return (
    <View
      style={{ borderRadius: 16, padding: 16, backgroundColor: "rgba(40,66,78,0.94)", borderLeftWidth: 3, borderLeftColor: W.pink, gap: 6 }}
      accessible
      accessibilityLabel={`${card.title}. ${card.status}. ${card.rules.join(" ")}`}
      testID="announcer-rules">
      <Text style={{ fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 1.8, color: W.pinkTint }} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        THE WARDEN · RULES
      </Text>
      <Text style={{ fontFamily: FONTS.semibold, fontSize: 18, color: "#FFFFFF" }} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {card.title}
      </Text>
      <Text style={{ fontFamily: FONTS.bold, fontSize: 15, color: W.pinkTint, fontVariant: ["tabular-nums"] }} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {card.status}
      </Text>
      {card.rules.map((r) => (
        <Text key={r} style={{ fontFamily: FONTS.medium, fontSize: 13, lineHeight: 19, color: "rgba(255,255,255,0.9)" }} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {r}
        </Text>
      ))}
    </View>
  );
}
