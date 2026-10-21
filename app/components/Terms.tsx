import { router } from "expo-router";
import { StyleSheet, Text } from "react-native";
import { C } from "@/theme/tokens";

export function Terms() {
  return (
    <Text style={styles.terms}>
      By continuing you agree to the{" "}
      <Text
        style={{ color: C.brand }}
        onPress={() => router.push("/legal/terms")}
        accessibilityRole="link"
      >
        CosQuest terms
      </Text>{" "}
      & the{" "}
      <Text
        style={{ color: C.brand }}
        onPress={() => router.push("/legal/guidelines")}
        accessibilityRole="link"
      >
        community guidelines
      </Text>
      .
    </Text>
  );
}

const styles = StyleSheet.create({
  terms: { fontSize: 12, color: "#707072", textAlign: "center", marginTop: 80 },
});
