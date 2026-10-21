// A public Room on the home map: a berry beacon among the shrines, taller
// than a point so it reads as a gathering (costquest-ios RoomsFeature.swift
// RoomBeacons, Roam/RoamHomeView.swift roomObjects, ~lines 464-471). WorldMap
// places it in its world view at the Room's local offset, like a PointMarker.
import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import { Pressable, Text, View } from "react-native";

import type { NearbyRoom } from "@/features/game/rooms";

import { GF, GP } from "./theme";
import { themedStyles, useThemedStyles } from "@/constants/chatTheme";

const SIZE = 44;

function RoomBeacon({ room, left, top, onPress }: { room: NearbyRoom; left: number; top: number; onPress: (room: NearbyRoom) => void }) {
  const styles = useThemedStyles(STYLE_PAIR);
  const who = room.host_handle || "Someone";
  return (
    <Pressable
      onPress={() => onPress(room)}
      hitSlop={10}
      style={[styles.marker, { left: left - SIZE / 2, top: top - SIZE - 14 }]}
      accessibilityRole="button"
      accessibilityLabel={`${who}'s Room, ${room.players ?? 0} ${room.players === 1 ? "player" : "players"}`}
      accessibilityHint="Opens the Battle sheet on this room">
      <View style={styles.pin}>
        <Ionicons name="flash" size={22} color="#FFF" />
        {room.players ? (
          <View style={styles.count}>
            <Text style={styles.countText}>{room.players}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.stem} />
    </Pressable>
  );
}

export default memo(RoomBeacon);

const STYLE_PAIR = themedStyles({
  marker: { position: "absolute", width: SIZE, height: SIZE + 14, alignItems: "center", zIndex: 2 },
  pin: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 3,
    borderColor: "#FFF",
    backgroundColor: GP.berry,
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  stem: { width: 4, height: 14, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: GP.berry },
  count: {
    position: "absolute",
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 3,
    backgroundColor: GP.sun,
    borderWidth: 2,
    borderColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { fontFamily: GF.bold, fontSize: 10, color: GP.ink },
});
