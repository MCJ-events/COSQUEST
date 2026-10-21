// The Live tab. It was the Expo starter screen ("Edit app/(tabs)/index.tsx
// to see changes"), shown to everyone who tapped Live. Until the team's Live
// design lands, it says plainly where live things happen today: voice chats
// and calls start in a group or a chat, and Quest Hours and raid bosses are
// in the game, one swipe away.
import { AppBackground } from "@/components/AppBackground";
import { FONTS } from "@/constants/fonts";
import { world } from "@/features/world/worldState";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ComponentProps } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tabBarSpace } from "@/constants/tabBar";
import { C } from "@/theme/tokens";

type IconName = ComponentProps<typeof Ionicons>["name"];

function Row({
  icon,
  title,
  body,
  action,
  onPress,
}: {
  icon: IconName;
  title: string;
  body: string;
  action: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${action}`}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={22} color={C.brand} />
      </View>
      <View style={styles.cardText}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardBody}>{body}</Text>
        <Text style={styles.cardAction}>{action}</Text>
      </View>
    </Pressable>
  );
}

export default function LiveScreen() {
  const insets = useSafeAreaInsets();

  return (
    <AppBackground variant="blueGradient">
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: Platform.OS === "web" ? 16 : Math.max(insets.top, 52), paddingBottom: tabBarSpace(insets.bottom) },
        ]}
        showsVerticalScrollIndicator={false}>
        <Text style={styles.title} accessibilityRole="header">
          Live
        </Text>
        <Text style={styles.subtitle}>Where live things happen in CosQuest.</Text>

        <Row
          icon="mic-outline"
          title="Voice chats and calls"
          body="Start a voice chat in Community or your faction room, or call someone from a DM. With Sparks on, 1:1 calls can keep notes."
          action="Go to your chats"
          onPress={() => router.navigate({ pathname: "/community", params: { tab: "Chats" } })}
        />
        <Row
          icon="flash-outline"
          title="Quest Hours and raids"
          body="Double XP hours, raid bosses and duels near you are in the game."
          action="Open the game"
          onPress={() => world.openGame(null)}
        />
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 24 },
  title: {
    fontFamily: FONTS.semibold,
    fontSize: 22,
    color: "#000000",
    textAlign: "center",
    marginTop: 12,
  },
  subtitle: {
    fontFamily: FONTS.regular,
    fontSize: 13,
    color: C.slate,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 24,
  },
  card: {
    flexDirection: "row",
    gap: 14,
    padding: 16,
    marginBottom: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.9)",
  },
  cardPressed: { opacity: 0.8 },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(195,77,156,0.14)",
  },
  cardText: { flex: 1 },
  cardTitle: { fontFamily: FONTS.semibold, fontSize: 15, color: C.ink },
  cardBody: { fontFamily: FONTS.regular, fontSize: 13, color: "#4A4F5C", marginTop: 4, lineHeight: 19 },
  cardAction: { fontFamily: FONTS.medium, fontSize: 13, color: C.brand, marginTop: 8 },
});
