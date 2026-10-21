// "More": the rest of the game, one tap away (costquest-ios
// Roam/HallPage.swift MoreSheet, tiles from RoamHomeView.swift moreTiles).
// The rail keeps four buttons at most, so the map is not framed by a column
// of icons; every other feature is a tile here, shown once its level unlocks
// it. A tile closes the sheet first and opens its own 380 ms later (two
// sheets cannot be up at once).
import { Ionicons } from "@expo/vector-icons";
import { type ReactNode, useRef, useState } from "react";
import { type LayoutChangeEvent, Text, View } from "react-native";
import Animated, { Easing, Keyframe } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GameIconButton, MAX_FONT_SCALE } from "./kit";
import { SheetHost } from "./Sheet";
import { edgeOf, GF, GP } from "./theme";
import { themedStyles, useThemedStyles } from "@/constants/chatTheme";

export type MoreTile = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  badge?: number | null;
  /** What the tile does, after the sheet has closed. Without it (and without `custom`) the tile is information only. */
  onPress?: () => void;
  /** The feature's own button, drawn instead of the icon (it carries its own badge); `press` is the tile's action. */
  custom?: (press: () => void) => ReactNode;
};

/** A drag of the sheet closes it; the slide is 220 ms (SheetHost), the next sheet waits 380. */
const SLIDE_MS = 220;
const NEXT_SHEET_MS = 380;
const MIN_TILE = 84;
const SPACING = 14;

const EASE = Easing.inOut(Easing.cubic);
const PANEL_IN = new Keyframe({
  from: { transform: [{ translateY: 320 }] },
  to: { transform: [{ translateY: 0 }], easing: EASE },
}).duration(300);

export default function MoreSheet({ tiles, onClose }: { tiles: MoreTile[]; onClose: () => void }) {
  const styles = useThemedStyles(STYLE_PAIR);
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const next = useRef<(() => void) | null>(null);

  // LazyVGrid(.adaptive(minimum: 84), spacing: 14): as many columns as fit, shared evenly.
  const cols = Math.max(1, Math.floor((width + SPACING) / (MIN_TILE + SPACING)));
  // Floored: three tiles of 114.33 and their gaps came to a hair over the row, and the third wrapped.
  const tileWidth = width > 0 ? Math.floor((width - SPACING * (cols - 1)) / cols) : MIN_TILE;
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <SheetHost
      band="any"
      scrimLabel="Close More"
      onClose={() => {
        onClose();
        const action = next.current;
        next.current = null;
        if (action) setTimeout(action, Math.max(0, NEXT_SHEET_MS - SLIDE_MS));
      }}>
      {(close) => {
        const choose = (t: MoreTile) => () => {
          next.current = t.onPress ?? null;
          close();
        };
        return (
          <Animated.View entering={PANEL_IN} style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.grabber} />
            <View style={styles.head}>
              <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
                More
              </Text>
            </View>
            <View style={styles.grid} onLayout={onLayout}>
              {tiles.map((t) => (
                <View key={t.id} style={[styles.tile, { width: tileWidth }]}>
                  <TileIcon tile={t} choose={choose(t)} />
                  <Text style={styles.tileTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {t.title}
                  </Text>
                </View>
              ))}
            </View>
          </Animated.View>
        );
      }}
    </SheetHost>
  );
}

function TileIcon({ tile, choose }: { tile: MoreTile; choose: () => void }) {
  const styles = useThemedStyles(STYLE_PAIR);
  if (tile.custom) return <>{tile.custom(choose)}</>;
  if (tile.onPress) {
    return <GameIconButton icon={tile.icon} color={tile.color} diameter={54} badge={tile.badge && tile.badge > 0 ? tile.badge : null} accessibilityLabel={tile.title} onPress={choose} />;
  }
  // Information only (the bag's count): a button that does nothing would be a lie.
  return (
    <View style={styles.info} accessible accessibilityLabel={`${tile.title}, ${tile.badge ?? 0}`}>
      <View style={[styles.infoEdge, { backgroundColor: edgeOf(tile.color) }]} />
      <View style={[styles.infoFace, { backgroundColor: tile.color }]}>
        <Ionicons name={tile.icon} size={24} color="#FFFFFF" />
      </View>
      {tile.badge && tile.badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText} maxFontSizeMultiplier={1.2}>
            {tile.badge}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const STYLE_PAIR = themedStyles({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 8,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: GP.cream,
    elevation: 12,
  },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: "rgba(0,0,0,0.15)", marginBottom: 8 },
  head: { marginBottom: 16 },
  title: { fontFamily: GF.display, fontSize: 26, color: GP.ink },
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: SPACING, rowGap: 18 },
  tile: { alignItems: "center", gap: 6 },
  tileTitle: { alignSelf: "stretch", textAlign: "center", fontFamily: GF.bold, fontSize: 12, color: GP.ink },
  info: { width: 54, height: 58 },
  infoEdge: { position: "absolute", left: 0, top: 4, width: 54, height: 54, borderRadius: 27 },
  infoFace: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    top: -4,
    right: -6,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GP.berry,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  badgeText: { fontFamily: GF.display, fontSize: 13, color: "#FFFFFF", fontVariant: ["tabular-nums"] },
});
