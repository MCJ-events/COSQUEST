// The Friends button: a round berry button with the count of gifts waiting,
// for the tile in the More sheet (costquest-ios Features/FriendsFeature.swift
// FriendsButton; placed by Roam/RoamHomeView.swift moreTiles). It opens the
// sheet through `onPress`; the game root owns the sheet, as it does the journal.
import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from "react-native";

import { friendsButtonLabel, pendingFromMe } from "@/features/game/friends";
import { friendsModel, useFriends } from "@/features/game/friendsRuntime";
import { useGame } from "@/features/game/runtime";

import { edgeOf, GF, GP } from "./theme";

export default function FriendsButton({ onPress, size = 46, style }: { onPress: () => void; size?: number; style?: StyleProp<ViewStyle> }) {
  const friends = useFriends();
  const me = useGame((s) => s.me);
  // The list's count once it is in; /me's until then.
  const pending = friends.payload ? friends.payload.pending_gifts : pendingFromMe(me);

  useEffect(() => {
    void friendsModel.refresh();
  }, []);

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={friendsButtonLabel(pending)} hitSlop={6} style={style}>
      {({ pressed }) => (
        <View style={[styles.edge, { width: size, height: size + 4, borderRadius: size / 2, paddingTop: pressed ? 3 : 0 }]}>
          <View style={[styles.face, { width: size, height: size, borderRadius: size / 2 }]}>
            <Ionicons name="people" size={Math.round(size * 0.48)} color="#FFF" />
          </View>
          {pending > 0 ? (
            <View style={styles.badge} pointerEvents="none">
              <Text style={styles.badgeText}>{pending}</Text>
            </View>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  edge: { backgroundColor: edgeOf(GP.berry) },
  face: { backgroundColor: GP.berry, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#FFF",
    backgroundColor: GP.sunDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontFamily: GF.display, fontSize: 12, color: "#FFF" },
});
