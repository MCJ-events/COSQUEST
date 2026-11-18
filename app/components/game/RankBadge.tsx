// A rank's badge, drawn in code after Wale's set (59323): a faceted shield in the
// rank's metal with a numeral tab on top, the number in Roman numerals (Mark, 8 Nov).
// No image assets: the metals are in features/game/roman.ts, so the ten badges cost
// nothing to ship and stay sharp at any size. Wale's art can replace the drawing
// here once he exports it with the tab as its own layer.
import { Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

import { badgeMetal, rankSpoken, toRoman } from "@/features/game/roman";

import { MAX_FONT_SCALE } from "./kit";
import { GF } from "./theme";

/** The shield on a 100 x 112 box: flat top shoulders, a point at the bottom. */
const SHIELD = "M50 10 L84 20 L92 44 L86 78 L50 108 L14 78 L8 44 L16 20 Z";
const FACE = "M50 22 L76 30 L82 47 L77 73 L50 96 L23 73 L18 47 L24 30 Z";
/** The numeral tab across the top edge. */
const TAB = "M30 4 L70 4 L76 14 L70 24 L30 24 L24 14 Z";

export function RankBadge({ rank, size = 52, total, testID }: { rank: number | null | undefined; size?: number; total?: number; testID?: string }) {
  const m = badgeMetal(rank);
  const numeral = toRoman(rank ?? 1);
  const h = size * 1.12;
  const id = `rb${Math.max(1, Math.trunc(rank ?? 1))}`;
  // The tab holds up to four letters (VIII); shrink the type for the long ones.
  const font = size * (numeral.length >= 4 ? 0.15 : numeral.length === 3 ? 0.17 : 0.19);
  return (
    <View style={{ width: size, height: h }} accessible accessibilityRole="image" accessibilityLabel={rankSpoken(rank, total)} testID={testID}>
      <Svg width={size} height={h} viewBox="0 0 100 112">
        <Defs>
          <LinearGradient id={`${id}r`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={m.rim} />
            <Stop offset="1" stopColor={m.rimDark} />
          </LinearGradient>
          <LinearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={m.face} />
            <Stop offset="1" stopColor="#000000" stopOpacity={0.85} />
          </LinearGradient>
        </Defs>
        <Path d={SHIELD} fill={`url(#${id}r)`} stroke={m.rimDark} strokeWidth={2} strokeLinejoin="round" />
        <Path d={FACE} fill={`url(#${id}f)`} stroke={m.rim} strokeOpacity={0.5} strokeWidth={1.5} strokeLinejoin="round" />
        {/* the chevron under the face, the light the set shares */}
        <Path d="M40 84 L50 92 L60 84" fill="none" stroke={m.glow} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M50 40 L58 62 L50 57 L42 62 Z" fill={m.glow} opacity={0.9} />
        <Path d={TAB} fill={m.face} stroke={m.rim} strokeWidth={2.5} strokeLinejoin="round" />
      </Svg>
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: size * 0.04, height: size * 0.2, alignItems: "center", justifyContent: "center" }}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} allowFontScaling={false} style={{ fontFamily: GF.display, fontSize: font, lineHeight: font * 1.15, color: "#FFFFFF", letterSpacing: 0.5, textShadowColor: m.glow, textShadowRadius: 4 }}>
          {numeral}
        </Text>
      </View>
    </View>
  );
}
