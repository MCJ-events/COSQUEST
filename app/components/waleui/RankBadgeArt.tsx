// Wale's own rank badges (sheet 59323: Initiate to Eternal), cut out of his sheet for build 23, with the number
// painted out of the top tab. The rank is drawn on the tab in code as a Roman numeral (Mark: numbers become Roman
// numerals). His name bands are kept as drawn: the ten names on his badges are the game's own rank names (the
// seed's ranks 1 to 10, features/waleui/ladderSnapshot.ts), so they are real data.
//
// Every picture is the same cell (256 x 374 px), with the tab centre at the same place, so one size and one
// numeral position fit all ten. Used on the Homepage; the game's Ranks sheet can reuse it (RankBadge.tsx is
// untouched).
import { Image } from "expo-image";
import { Text, View } from "react-native";

import { FONTS } from "@/constants/fonts";
import { toRoman } from "@/features/game/roman";

const ART = [
  require("@/assets/images/waleui/rank_01.png"),
  require("@/assets/images/waleui/rank_02.png"),
  require("@/assets/images/waleui/rank_03.png"),
  require("@/assets/images/waleui/rank_04.png"),
  require("@/assets/images/waleui/rank_05.png"),
  require("@/assets/images/waleui/rank_06.png"),
  require("@/assets/images/waleui/rank_07.png"),
  require("@/assets/images/waleui/rank_08.png"),
  require("@/assets/images/waleui/rank_09.png"),
  require("@/assets/images/waleui/rank_10.png"),
];

export const RANK_NAMES = ["Initiate", "Disciple", "Awakened", "Elite", "Champion", "Commander", "Sovereign", "Transcendent", "Omega", "Eternal"];

/** The cell (px) and where the tab's centre and the badge itself sit in it (the badge box is rank IV's, his Homepage badge). */
export const BADGE_CELL = { w: 256, h: 374, tabX: 128, tabY: 82, badge: { x: 6, y: 38, w: 240, h: 299 } } as const;

/** One badge drawn `width` wide (the whole cell; the badge itself is BADGE_CELL.badge inside it). */
export function WaleRankBadge({ rank, width, testID }: { rank: number | null | undefined; width: number; testID?: string }) {
  const n = Math.max(1, Math.min(10, Math.trunc(rank ?? 1)));
  const k = width / BADGE_CELL.w;
  const numeral = toRoman(n);
  // his numbers are about 16 px tall on the sheet; the long numerals get a little smaller to stay inside the tab
  const font = k * (numeral.length >= 4 ? 13 : numeral.length === 3 ? 15 : 17);
  return (
    <View testID={testID} pointerEvents="none" accessible accessibilityRole="image" accessibilityLabel={`Rank ${n}, ${RANK_NAMES[n - 1]}`} style={{ width, height: BADGE_CELL.h * k }}>
      <Image source={ART[n - 1]} style={{ width, height: BADGE_CELL.h * k }} contentFit="fill" />
      <View style={{ position: "absolute", left: (BADGE_CELL.tabX - 30) * k, top: (BADGE_CELL.tabY - 14) * k, width: 60 * k, height: 28 * k, alignItems: "center", justifyContent: "center" }}>
        <Text
          allowFontScaling={false}
          style={{ fontFamily: FONTS.bold, fontSize: font, lineHeight: font * 1.15, color: "#ECEDEF", letterSpacing: font * 0.04, includeFontPadding: false, textShadowColor: "rgba(0,0,0,0.75)", textShadowOffset: { width: 0, height: font * 0.06 }, textShadowRadius: font * 0.12 }}
        >
          {numeral}
        </Text>
      </View>
    </View>
  );
}
