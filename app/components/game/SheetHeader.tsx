// A sheet's title row (Roam/RoamSheets.swift SheetHeader): the heading and a
// berry round close button. iOS has no Back button, so every sheet closes here.
import { StyleSheet, View } from "react-native";

import { GameHeading, GameIconButton } from "./kit";
import { GP } from "./theme";

export function SheetHeader({ title, onClose, closeLabel = "Close" }: { title: string; onClose: () => void; closeLabel?: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.title}>
        <GameHeading text={title} size={34} />
      </View>
      <GameIconButton icon="close" color={GP.berry} diameter={42} onPress={onClose} accessibilityLabel={closeLabel} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 8 },
  title: { flex: 1 },
});
