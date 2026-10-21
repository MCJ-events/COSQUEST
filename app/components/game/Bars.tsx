// Progress bars in the game's two shapes: the chunky XPBar of the reward and
// the journal (a capsule with a pale gloss, never thinner than a nub), and the
// hero screen's slim stat bar. costquest-ios Roam/RewardView.swift (XPBar),
// Features/CodexFeature.swift (CodexBar), UI/HeroStage.swift (HeroStatBar).
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import type { ComponentProps } from "react";
import { Text, View } from "react-native";

import { MAX_FONT_SCALE } from "./kit";
import { GF, GP } from "./theme";
import { themedStyles, useThemedStyles } from "@/constants/chatTheme";

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/** XPBar: sky to deep sky on an ink-tinted track, 16 high, a nub of 12 at least, a gloss along the top. */
export function XPBar({
  progress,
  colors = [GP.sky, GP.skyDeep],
  height = 16,
  minWidth = 12,
}: {
  progress: number;
  colors?: [string, string];
  height?: number;
  minWidth?: number;
}) {
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: "rgba(31,59,77,0.12)", overflow: "hidden" }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{ width: `${clamp01(progress) * 100}%`, minWidth, height, borderRadius: height / 2 }}>
        <View style={{ position: "absolute", top: 2, left: 6, right: 6, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.3)" }} />
      </LinearGradient>
    </View>
  );
}

/** CodexBar: XPBar's shape, mint to grass, gold once a set is done. */
export function CodexBar({ progress, done }: { progress: number; done: boolean }) {
  return <XPBar progress={progress} height={14} colors={done ? [GP.sun, GP.sunDeep] : [GP.mint, GP.grass]} />;
}

/** One stat on the hero screen: icon, name, value, and a sky-blue bar on a pale track (HeroStatBar). */
export function HeroStatBar({
  icon,
  name,
  value,
  extra,
  progress,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  name: string;
  value: string;
  extra?: string;
  progress: number;
}) {
  const styles = useThemedStyles(STYLE_PAIR);
  return (
    <View accessible accessibilityLabel={`${name}, ${value}${extra ? ` ${extra}` : ""}`} style={{ gap: 6 }}>
      <View style={styles.statRow}>
        <Ionicons name={icon} size={17} color={GP.ink} style={{ width: 22 }} />
        <Text style={styles.statName} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
          {name.toUpperCase()}
        </Text>
        <Text style={styles.statValue} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {value}
        </Text>
        {extra ? (
          <Text style={styles.statExtra} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {extra}
          </Text>
        ) : null}
      </View>
      <View style={{ height: 9, borderRadius: 4.5, backgroundColor: GP.track, overflow: "hidden" }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <LinearGradient
          colors={[GP.skyDeep, GP.sky]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ width: `${clamp01(progress) * 100}%`, minWidth: 8, height: 9, borderRadius: 4.5 }}
        />
      </View>
    </View>
  );
}

const STYLE_PAIR = themedStyles({
  statRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statName: { flex: 1, fontFamily: GF.display, fontSize: 15, letterSpacing: 0.6, color: GP.ink },
  statValue: { fontFamily: GF.display, fontSize: 17, color: GP.ink },
  statExtra: { fontFamily: GF.display, fontSize: 13, color: GP.sun },
});
