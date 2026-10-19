// PLACEHOLDER written by the home-screen agent so GameRoot compiles: the real
// quiz Siege (costquest-ios Features/SiegeFeature.swift SiegeView) replaces
// this whole file. Contract: default export, (point, parked, onClose, onDone?).
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { QuestPoint } from "@/features/game/wire";

import { GameButton } from "./kit";
import { GF, GP } from "./theme";

export default function SiegeScreen({ point, onClose }: { point: QuestPoint; parked: boolean; onClose: () => void; onDone?: (won: boolean) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      <Text style={styles.title}>SIEGE!</Text>
      <Text style={styles.line}>{point.name}</Text>
      <GameButton title="Back to the map" color={GP.mint} onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: GP.navy, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 24 },
  title: { fontFamily: GF.display, fontSize: 52, color: "#FFFFFF" },
  line: { fontFamily: GF.body, fontSize: 18, color: "rgba(255,255,255,0.8)" },
});
