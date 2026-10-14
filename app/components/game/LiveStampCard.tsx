// The stamp card in the journal's dailies: the streak for people with lives.
// Every day played lays one stamp (the server lays it with the day's first
// answer, right or wrong); a full card pays, whenever that is, and never
// expires. Read from GET v1/roam/me (me.features.live), which the store
// refreshes with every verdict, so a new stamp shows as soon as it is laid.
// costquest-ios Features/LiveFeature.swift (StampCard, LiveStamp).
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { stampRow, stampsFrom } from "@/features/game/live";
import type { RoamMe } from "@/features/game/wire";

import { Chip } from "./kit";
import { withAlpha } from "./LiveBanner";
import { GF, GP } from "./theme";

/** Nothing when the server said nothing about stamps (the feature is off there). */
export default function LiveStampCard({ me }: { me: RoamMe | null }) {
  const stamps = stampsFrom(me);
  if (!stamps) return null;
  const { size, have } = stampRow(stamps);
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Stamp card</Text>
        {stamps.cards_done > 0 ? <Chip text={stamps.cards_done === 1 ? "1 card done" : `${stamps.cards_done} cards done`} color={GP.mint} /> : null}
      </View>
      <View style={styles.row} accessible accessibilityLabel={`${have} of ${size} stamps collected`}>
        {Array.from({ length: size }, (_, i) => (
          <Stamp key={i} filled={i < have} n={i + 1} />
        ))}
      </View>
      <Text style={styles.note}>Play any day to stamp it. 7 stamps = 300 XP</Text>
    </View>
  );
}

function Stamp({ filled, n }: { filled: boolean; n: number }) {
  return (
    <View style={styles.slot}>
      {filled ? (
        <View style={styles.filledEdge}>
          <View style={styles.filled}>
            <Ionicons name="ribbon" size={18} color={GP.sunDeep} />
          </View>
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.number}>{n}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 14, borderRadius: 18, backgroundColor: "#FFF" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontFamily: GF.display, fontSize: 19, color: GP.ink },
  row: { flexDirection: "row", gap: 6 },
  slot: { flex: 1, alignItems: "center" },
  filledEdge: { width: "100%", maxWidth: 44, aspectRatio: 1, borderRadius: 22, backgroundColor: GP.sunDeep, paddingBottom: 3 },
  filled: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.7)",
    backgroundColor: GP.sun,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    width: "100%",
    maxWidth: 44,
    aspectRatio: 1,
    borderRadius: 22,
    borderWidth: 2.5,
    borderStyle: "dashed",
    borderColor: withAlpha(GP.ink, 0.25),
    alignItems: "center",
    justifyContent: "center",
  },
  number: { fontFamily: GF.display, fontSize: 16, color: withAlpha(GP.ink, 0.35) },
  note: { fontFamily: GF.body, fontSize: 13, color: GP.mist },
});
