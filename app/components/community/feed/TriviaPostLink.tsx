// A feed post that links to CosQuest trivia (a shared run or question, the board, the trivia page)
// gets a Play trivia button under its caption (16 Nov 2026, Mark: trivia works on its own as a
// social hub). Which posts count is features/game/triviaVisual.ts triviaLinkIn; anything else gets
// nothing. The button opens the app's own trivia screen, not the browser.
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";

import { FONTS } from "@/constants/fonts";
import { PRODUCTION_GAME_SERVER, STAGING_GAME_SERVER, resolveGameServer } from "@/features/game/config";
import { triviaLinkIn } from "@/features/game/triviaVisual";
import { C } from "@/theme/tokens";

const SERVERS = [PRODUCTION_GAME_SERVER, STAGING_GAME_SERVER, resolveGameServer(process.env.EXPO_PUBLIC_GAME_SERVER)];

export function TriviaPostLink({ content }: { content?: string | null }) {
  if (!triviaLinkIn(content, SERVERS)) return null;
  return (
    <Pressable
      onPress={() => router.push("/trivia")}
      accessibilityRole="button"
      accessibilityLabel="Play CosQuest trivia"
      hitSlop={6}
      style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
      testID="feed-play-trivia">
      <Ionicons name="play" size={14} color="#FFFFFF" />
      <Text style={styles.text}>Play trivia</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 10, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: C.brand },
  text: { color: "#FFFFFF", fontFamily: FONTS.semibold, fontSize: 13 },
});
