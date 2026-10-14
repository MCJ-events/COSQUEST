// "More": the rest of the game, one tap away (costquest-ios
// Roam/RoamHomeView.swift moreTiles / MoreSheet). The rail keeps four
// buttons at most, so the map is not framed by a column of icons; every
// other feature is a tile here, shown once its level unlocks it.
import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GF, GP } from "./theme";

export type MoreTile = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  badge?: number | null;
  /** The feature's own button, drawn instead of the icon (it carries its own badge). */
  embed?: ReactNode;
  onPress: () => void;
};

export default function MoreSheet({ tiles, onClose }: { tiles: MoreTile[]; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close More" />
      <Animated.View
        entering={SlideInDown.springify().damping(20)}
        exiting={SlideOutDown.duration(160)}
        style={[styles.sheet, { paddingBottom: insets.bottom + 18 }]}>
        <View style={styles.grabber} />
        <View style={styles.head}>
          <Text style={styles.title}>More</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={GP.ink} />
          </Pressable>
        </View>
        <View style={styles.grid}>
          {tiles.map((t) => (
            <Pressable
              key={t.id}
              onPress={t.onPress}
              style={styles.tile}
              accessibilityRole="button"
              accessibilityLabel={t.badge ? `${t.title}, ${t.badge}` : t.title}>
              {t.embed ?? (
              <View style={[styles.icon, { backgroundColor: t.color }]}>
                <Ionicons name={t.icon} size={24} color="#FFF" />
                {t.badge ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{t.badge > 99 ? "99+" : t.badge}</Text>
                  </View>
                ) : null}
              </View>
              )}
              <Text style={styles.tileTitle} numberOfLines={2}>
                {t.title}
              </Text>
            </Pressable>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(20,32,44,0.35)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingTop: 8,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: GP.cream,
    elevation: 12,
  },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: "rgba(0,0,0,0.15)", marginBottom: 8 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { fontFamily: GF.display, fontSize: 24, color: GP.ink },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 16 },
  tile: { width: "25%", alignItems: "center", gap: 6 },
  icon: { width: 58, height: 58, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    top: -5,
    right: -5,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GP.berry,
    borderWidth: 2,
    borderColor: GP.cream,
  },
  badgeText: { fontFamily: GF.bold, fontSize: 11, color: "#FFF" },
  tileTitle: { fontFamily: GF.bold, fontSize: 12, color: GP.ink, textAlign: "center" },
});
