// The Battle button: opens the Battle sheet, with the count of public Rooms
// near you (costquest-ios Features/RoomsFeature.swift BattleButton). Shaped
// like the rail's own buttons (Hud.tsx), in berry, so it sits in the rail.
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useRooms } from "@/features/game/roomsRuntime";

import { GF, GP } from "./theme";

export default function RoomButton({ onPress }: { onPress: () => void }) {
  const { nearby } = useRooms();
  const n = nearby.length;
  return (
    <Pressable
      style={styles.button}
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={n ? `Battle, ${n} ${n === 1 ? "room" : "rooms"} near you` : "Battle"}>
      <Ionicons name="flash" size={22} color="#FFF" />
      {n ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{n > 9 ? "9+" : n}</Text>
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
    backgroundColor: GP.berry,
    borderWidth: 2,
    borderColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  badge: {
    position: "absolute",
    top: -5,
    right: -5,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: GP.sun,
    borderWidth: 2,
    borderColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: { fontFamily: GF.bold, fontSize: 10, color: GP.ink },
});
