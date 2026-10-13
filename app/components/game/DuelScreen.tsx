// The Guardian Duel screen. Replaced by the arena (the TypeScript port of
// costquest-duel) in the next commit; until then it says so and lets go.
import { StyleSheet, Text, View } from "react-native";

import type { QuestPoint } from "@/features/game/wire";

import { GameButton } from "./kit";
import type { RewardSummary } from "./Reward";
import { GF, GP } from "./theme";

export default function DuelScreen({ onClose }: { point: QuestPoint; parked: boolean; onReward: (r: RewardSummary) => void; onClose: () => void }) {
  return (
    <View style={styles.root}>
      <Text style={styles.text}>The arena is being built.</Text>
      <GameButton title="Back to the map" color={GP.sun} onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: GP.navy, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  text: { fontFamily: GF.display, fontSize: 20, color: "#FFF" },
});
