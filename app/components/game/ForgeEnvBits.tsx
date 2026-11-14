// build 28 (forge-env-28): a point's Forge world piece outside the Encounter, while the server's flag
// forge_env_fights is on (features/game3d/fightEnv.ts). One picture everywhere (art direction 5: the same render on
// the map, in the card and before the fight): the piece's own thumbnail, on cream paper by day and on the ink card
// at dusk, ringed in its rarity like the Guardian's portrait.
//   PinPiece       a small tile on the shoulder of a dressed point's map pin
//   PiecePointLine the point card's line: the piece's tile and "<name> stands here" (or "at this fight")
//   FightPiece     the 3D fight's loading card (and the 2D briefing): the piece standing over its name
// With the flag off, or a point with no piece, each is null and the screen is build 27's.
import { Image } from "expo-image";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { thumbUrl, useForgeWorld } from "@/features/game/forgeWorldDevice";
import { useGame } from "@/features/game/runtime";
import type { QuestPoint } from "@/features/game/wire";
import { envFightsOn, pieceLine, pointPiece } from "@/features/game3d/fightEnv";
import { themedStyles, useThemedStyles } from "@/constants/chatTheme";

import { rarityColor } from "./ForgeWorld";
import { MAX_FONT_SCALE } from "./kit";
import { SURFACES } from "./look";
import { GF } from "./theme";

/** The cream paper the Guardian's portrait sits on (WorldMap pinPortrait). */
const PAPER = "#F4EEE2";

function usePieceOn(): boolean {
  const me = useGame((s) => s.me);
  const forgeOn = useForgeWorld((s) => s.on);
  return forgeOn && envFightsOn(me);
}

/** The world piece a point is dressed with, or null (flag off, undressed, not in the catalogue). */
export function usePointPiece(point: unknown) {
  const on = usePieceOn();
  const entries = useForgeWorld((s) => s.entries);
  return useMemo(() => pointPiece(point, entries, on), [point, entries, on]);
}

/** For the map: each pin's piece picture (128 px), or undefined when the flag is off (no pin changes). */
export function usePinPieces(): ((p: QuestPoint) => string | null) | undefined {
  const on = usePieceOn();
  const entries = useForgeWorld((s) => s.entries);
  return useMemo(() => {
    if (!on) return undefined;
    const pieces = entries.filter((e) => e.type === "environment");
    if (!pieces.length) return undefined;
    return (p: QuestPoint) => {
      const e = pointPiece(p, pieces, true);
      return e ? thumbUrl(e, 128) : null;
    };
  }, [on, entries]);
}

/** On a pin's shoulder: the piece, small, on paper with a white edge (it reads over any map colour). */
export function PinPiece({ uri, dim }: { uri: string; dim?: boolean }) {
  return (
    <View style={[pin.tile, dim ? pin.dim : null]} pointerEvents="none" testID="pin-piece">
      <Image source={{ uri }} style={pin.img} contentFit="contain" recyclingKey={uri} accessibilityIgnoresInvertColors />
    </View>
  );
}

const pin = StyleSheet.create({
  tile: {
    position: "absolute",
    right: -7,
    top: -7,
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
    backgroundColor: PAPER,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  img: { width: 17, height: 17 },
  dim: { opacity: 0.5 },
});

/** The point card's line for its piece: the tile in its rarity ring, and where it stands. */
export function PiecePointLine({ point, fight }: { point: QuestPoint; fight: boolean }) {
  const styles = useThemedStyles(LINE);
  const piece = usePointPiece(point);
  const uri = piece ? thumbUrl(piece, 128) : null;
  if (!piece || !uri) return null;
  const text = pieceLine(piece.name, fight);
  return (
    <View style={styles.row} accessible accessibilityLabel={text} testID="point-piece">
      <View style={[styles.ring, { backgroundColor: rarityColor(piece.rarity) }]}>
        <View style={styles.paper}>
          <Image source={{ uri }} style={styles.img} contentFit="contain" accessibilityIgnoresInvertColors />
        </View>
      </View>
      <Text style={styles.text} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {text}
      </Text>
    </View>
  );
}

const L = SURFACES.light;
const D = SURFACES.dark;
const LINE = themedStyles(
  {
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    ring: { width: 40, height: 40, borderRadius: 12, padding: 3 },
    paper: { flex: 1, borderRadius: 9, backgroundColor: PAPER, alignItems: "center", justifyContent: "center", overflow: "hidden" },
    img: { width: 30, height: 30 },
    text: { flexShrink: 1, fontFamily: GF.body, fontSize: 13, lineHeight: 16, letterSpacing: 0.2, color: L.textMuted },
  },
  { text: { color: D.textMuted } },
);

/** Before a fight: the piece the arena is dressed with, standing over its name (on the dark loading card). */
export function FightPiece({ point }: { point: QuestPoint | null }) {
  const piece = usePointPiece(point);
  const uri = piece ? thumbUrl(piece, 256) : null;
  if (!piece || !uri) return null;
  return (
    <View style={fp.wrap} accessible accessibilityLabel={pieceLine(piece.name, true)} testID="fight-piece">
      <View style={[fp.glow, { backgroundColor: `${rarityColor(piece.rarity)}33` }]} />
      <Image source={{ uri }} style={fp.img} contentFit="contain" contentPosition="bottom" accessibilityIgnoresInvertColors />
      <Text style={fp.text} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {pieceLine(piece.name, true)}
      </Text>
    </View>
  );
}

const fp = StyleSheet.create({
  wrap: { alignItems: "center", gap: 6, marginTop: 6 },
  glow: { position: "absolute", top: 18, width: 104, height: 70, borderRadius: 52 },
  img: { width: 104, height: 96 },
  text: { fontFamily: GF.body, fontSize: 13, letterSpacing: 0.2, color: "rgba(255,255,255,0.75)", textAlign: "center" },
});
