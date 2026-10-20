// The friend code as a QR symbol (FriendsFeature.swift qrImage: CIFilter's
// generator at correction M, drawn 170 pt with 8 pt of white round it).
// Encoded in TypeScript (features/game/qr.ts), drawn as one SVG path.
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { encodeQr } from "@/features/game/qr";

export function QrCode({ text, size = 170 }: { text: string; size?: number }) {
  const path = useMemo(() => {
    const q = encodeQr(text);
    let d = "";
    // One rectangle per run of dark modules in a row: fewer seams than squares.
    q.modules.forEach((row, r) => {
      for (let c = 0; c < row.length; ) {
        if (!row[c]) {
          c++;
          continue;
        }
        let end = c;
        while (end < row.length && row[end]) end++;
        d += `M${c} ${r}h${end - c}v1h${c - end}z`;
        c = end;
      }
    });
    return { d, n: q.size };
  }, [text]);
  return (
    // Hidden from VoiceOver/TalkBack: the code itself is read out above it.
    <View style={styles.card} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox={`0 0 ${path.n} ${path.n}`}>
        <Path d={path.d} fill="#000000" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 8, borderRadius: 14, backgroundColor: "#FFFFFF", alignSelf: "center" },
});
