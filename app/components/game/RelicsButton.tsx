// The rail's Relics button: the equipped weapon itself on a purple button,
// and how many Relics the player owns. costquest-ios Features/RelicsFeature.swift
// (RelicsButton), placed in Roam/RoamHomeView.swift's rail (`rail`, after the
// daily quests) behind `store.unlocked(.relics)`.
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { equippedFor } from "@/features/game/relics";
import { forgeStore, relicsStore, useRelics } from "@/features/game/relicsLive";
import { useGame } from "@/features/game/runtime";

import { WeaponGlyph } from "./RelicArt";
import { GF, GP } from "./theme";

export default function RelicsButton({ onPress }: { onPress: () => void }) {
  const { me } = useGame();
  const { payload } = useRelics();
  const equipped = equippedFor(payload, me);
  const count = payload?.owned.length ?? me?.features?.relics?.owned_count ?? 0;

  // Fetch on show and whenever `me` changes (a level, a drop, a sign-in), and
  // bring the Forge's weapons down early so the Relicdex opens with them.
  useEffect(() => {
    void relicsStore.refresh();
    void forgeStore.refresh();
  }, [me]);

  return (
    <Pressable
      style={styles.button}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Relics, ${count} owned` : "Relics"}
      hitSlop={6}>
      <WeaponGlyph kind={equipped?.kind ?? "blade"} size={28} fill="#FFFFFF" flat />
      {count > 0 ? (
        <View style={styles.badge} accessible={false}>
          <Text style={styles.badgeText}>{count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: GP.rare,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -6,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: GP.skyDeep,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontFamily: GF.display, fontSize: 11, color: "#FFFFFF" },
});
