// "Your character" on the profile (build 29, Subomi, 18 Nov 2026): the character the player is, as its 2D art (a
// picture to show and share, not the 3D model), with Change (the character picker, app/wale/character.tsx) and
// Share card (its 9:16 card to the share sheet). The character is the player's pick, else their faction hero
// (features/waleui/characters.ts). Hidden when there is no character and Wale's screens are off.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { themedStyles, useInk, useThemedStyles } from "@/constants/chatTheme";
import { FONTS } from "@/constants/fonts";
import { characterLine } from "@/features/waleui/characters";
import { shareCharacterCard } from "@/components/waleui/CharacterScreen";
import { WALE_UI } from "@/components/waleui/flag";
import { usePlayerCharacter } from "@/components/waleui/heroArt";

const PINK = "#C34E9C";

export function CharacterProfileCard() {
  const styles = useThemedStyles(STYLE_PAIR);
  const ink = useInk();
  const c = usePlayerCharacter();
  if (!WALE_UI) return null;
  const open = () => router.push("/wale/character" as never);
  return (
    <View style={styles.section} testID="profile-character">
      <Text style={styles.label}>Your character</Text>
      <View style={styles.card}>
        <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={c ? `${c.name}. Change character` : "Pick your character"} style={styles.artBox}>
          {c ? (
            <Image source={c.card} style={styles.art} contentFit="contain" contentPosition="bottom" testID="profile-character-art" />
          ) : (
            <Ionicons name="person" size={40} color={ink.text("#9C9CAA")} />
          )}
        </Pressable>
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1} testID="profile-character-name">
            {c?.name ?? "No character yet"}
          </Text>
          <Text style={styles.line} numberOfLines={2}>
            {c ? characterLine(c) : "Pick who you are in the game."}
          </Text>
          <View style={styles.buttons}>
            <Pressable onPress={open} style={[styles.button, styles.buttonPink]} accessibilityRole="button" accessibilityLabel="Change character" testID="profile-character-change">
              <Text style={styles.buttonPinkText}>Change</Text>
            </Pressable>
            {c ? (
              <Pressable onPress={() => void shareCharacterCard(c.key)} style={styles.button} accessibilityRole="button" accessibilityLabel="Share your character card" testID="profile-character-share">
                <Ionicons name="share-outline" size={14} color={ink.text(PINK)} />
                <Text style={styles.buttonText}>Share card</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

const STYLE_PAIR = themedStyles(
  StyleSheet.create({
    section: { marginTop: 12 },
    label: { marginTop: 6, fontFamily: FONTS.semibold, fontSize: 11, color: "#191922" },
    card: {
      marginTop: 8,
      flexDirection: "row",
      borderRadius: 18,
      borderWidth: 1,
      borderColor: "#C34D9C33",
      backgroundColor: "rgba(255,255,255,0.35)",
      overflow: "hidden",
      padding: 12,
      gap: 14,
    },
    artBox: {
      width: 104,
      height: 150,
      borderRadius: 14,
      backgroundColor: "rgba(195,77,156,0.10)",
      alignItems: "center",
      justifyContent: "flex-end",
      overflow: "hidden",
    },
    art: { width: 104, height: 146 },
    info: { flex: 1, justifyContent: "center" },
    name: { fontFamily: FONTS.bold, fontSize: 18, color: "#191922" },
    line: { marginTop: 2, fontFamily: FONTS.medium, fontSize: 12, color: "#6B6B7A" },
    buttons: { flexDirection: "row", gap: 8, marginTop: 14, flexWrap: "wrap" },
    button: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: "#C34E9C66",
    },
    buttonPink: { backgroundColor: PINK, borderColor: PINK },
    buttonText: { fontFamily: FONTS.semibold, fontSize: 12, color: PINK },
    buttonPinkText: { fontFamily: FONTS.semibold, fontSize: 12, color: "#FFFFFF" },
  }),
);
