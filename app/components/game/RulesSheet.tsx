// Rules (build 24): the game's fixed rulebook, reached from More. It replaced
// "Ask the Warden": no model, no download, nothing spoken and no character
// voice, only the authored rules (features/game/rules.ts). The server still
// referees every action.
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RULEBOOK, RULES_LEAD } from "@/features/game/rules";

import { MAX_FONT_SCALE } from "./kit";
import { ELEVATION, RADIUS, SURFACES } from "./look";
import { SheetHost } from "./Sheet";
import { SheetFrame } from "./SheetFrame";
import { SheetHeader } from "./SheetHeader";
import { GF } from "./theme";
import { themedStyles, useThemedStyles } from "@/constants/chatTheme";

const L = SURFACES.light;
const D = SURFACES.dark;

export default function RulesSheet({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <SheetHost band={{ top: insets.top + 40, height: 90 }} scrimLabel="Close Rules" onClose={onClose}>
      {(close) => <RulesBody close={close} />}
    </SheetHost>
  );
}

function RulesBody({ close }: { close: () => void }) {
  const styles = useThemedStyles(STYLE_PAIR);
  const insets = useSafeAreaInsets();
  return (
    <SheetFrame top={insets.top + 40}>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        <SheetHeader title="Rules" onClose={close} closeLabel="Close Rules" />
        <Text style={styles.lead} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {RULES_LEAD}
        </Text>
        {RULEBOOK.map((r) => (
          <View key={r.topic} style={styles.card} accessible accessibilityLabel={`${r.topic}. ${r.text}`}>
            <Text style={styles.topic} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {r.topic}
            </Text>
            <Text style={styles.text} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {r.text}
            </Text>
          </View>
        ))}
      </ScrollView>
    </SheetFrame>
  );
}

const STYLE_PAIR = themedStyles(
  {
    body: { paddingHorizontal: 18, gap: 12 },
    lead: { fontFamily: GF.regular, fontSize: 15, lineHeight: 21, color: L.textMuted },
    card: { gap: 6, padding: 16, borderRadius: RADIUS.card, backgroundColor: L.surface, ...ELEVATION.low },
    topic: { fontFamily: GF.bold, fontSize: 17, lineHeight: 22, color: L.text },
    text: { fontFamily: GF.regular, fontSize: 15, lineHeight: 21, color: L.text },
  },
  {
    lead: { color: D.textMuted },
    card: { backgroundColor: D.surface, borderWidth: 1, borderColor: D.hairline, shadowOpacity: 0, elevation: 0, boxShadow: "none" },
    topic: { color: D.text },
    text: { color: D.text },
  },
);
