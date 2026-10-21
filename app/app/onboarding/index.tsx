import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { OnboardingScreen, useHeroHeight } from "@/components/OnboardingScreen";
import { C } from "@/theme/tokens";

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && { opacity: 0.6 }]}
    >
      <Text style={[styles.buttonLabel]}>{label}</Text>
    </Pressable>
  );
}

export default function Welcome() {
  // The picture is 400 high on tall phones and shrinks on short ones (an
  // iPhone SE) so the headline and Continue fit without scrolling.
  const heroHeight = useHeroHeight(400, 300);
  return (
    <OnboardingScreen background="plain" topGap={0} centered contentStyle={styles.screen}>
        <View style={styles.body}>
          <Text style={styles.headline}>SCAN, SOLVE,{"\n"}EARN</Text>
          <Image
            source={require("@/assets/images/welcome-page.png")}
            style={[styles.hero, { height: heroHeight }]}
            contentFit="contain"
          />
          <Button
            label="Continue"
            onPress={() => router.push("/onboarding/oauthSignup")}
          />
        </View>
    </OnboardingScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingHorizontal: 25,
    paddingBottom: 24,
  },
  headline: {
    fontSize: 35,
    fontWeight: "800",
    textAlign: "center",
    color: C.ink,
  },
  body: { justifyContent: "center", gap: 15 },
  hero: { width: "100%", marginVertical: 24 },
  button: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 15,
    borderRadius: 30,
    backgroundColor: C.brand,
    marginTop: 15,
  },
  buttonLabel: { fontSize: 17, fontWeight: "600", color: "#FFFFFF" },
});
