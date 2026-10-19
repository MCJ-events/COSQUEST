// PLACEHOLDER written by the home-screen agent so GameRoot compiles: the real
// CoinsSheet replaces this whole file. Contract: default export, (props: { onClose }).
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GameButton } from "./kit";
import { GF, GP } from "./theme";

export default function CoinsSheet({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.sheet, { top: insets.top + 40, paddingBottom: insets.bottom + 18 }]}>
      <Text style={styles.title}>CoinsSheet</Text>
      <GameButton title="Close" color={GP.skyDeep} onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, gap: 16, padding: 20, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: GP.cream },
  title: { fontFamily: GF.display, fontSize: 26, color: GP.ink },
});
