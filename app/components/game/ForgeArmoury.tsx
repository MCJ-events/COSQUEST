// "From the Forge": the weapons the Forge portal has published, in the
// Relicdex next to the player's Relics, and one weapon's card.
// costquest-ios Features/ForgeFeature.swift (ForgeArmourySection,
// ForgeWeaponDetail), read from GET v1/catalogue (features/game/forge.ts).
//
// A first look only, as on iOS: the server has no route for a player to get,
// equip or trade a Forge weapon, so nothing here offers to.
// The weapon's 3D model (iOS: a GLB turning on a small stage, RealityKit, the
// native CostQuestModelView island) shows on its card when the build has the
// view, the island is not turned off (EXPO_PUBLIC_GAME_2D) and the weapon has
// a model, downloaded and checked by features/game/forgeDevice.ts. Otherwise,
// and on Android, the card shows the server's own thumbnail of that model when
// the build made one, and else draws it in 2D: the shape read from its name,
// the colour from its rarity.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { type ForgeElement, forgeDetailSubtitle, forgeKind, forgeNumber, forgeThumbnailUrl, forgeTileTag } from "@/features/game/forge";
import { ensureForgeModel, FORGE_3D_AVAILABLE, syncForgeModels, useForgeModels, weaponHas3d } from "@/features/game/forgeDevice";
import { factionLabel, rarityName } from "@/features/game/relics";
import { useForge } from "@/features/game/relicsLive";
import { GAME_SERVER, useGame } from "@/features/game/runtime";
import { CostQuestModelView } from "@/modules/costquest-game/src";

import { Chip, GameHeading, GameIconButton, GamePanel, MAX_FONT_SCALE, pressFeedback, withAlpha } from "./kit";
import { RelicArt, RelicSunburst, rarityColor, rarityInk } from "./RelicArt";
import { edgeOf, GF, GP, realmColor } from "./theme";

/** ForgeLook.accent. */
export const FORGE_ACCENT = "#F57329";

/** The weapon's picture: the server's thumbnail if it has one and it loads, else drawn. */
function ForgeArt({ weapon, size, width }: { weapon: ForgeElement; size: number; width: 256 | 512 }) {
  const [broken, setBroken] = useState(false);
  const url = forgeThumbnailUrl(GAME_SERVER, weapon, width);
  if (url && !broken) {
    return (
      <Image
        source={{ uri: url }}
        style={{ width: size, height: size }}
        contentFit="contain"
        cachePolicy="disk"
        onError={() => setBroken(true)}
        accessible={false}
      />
    );
  }
  return <RelicArt kind={forgeKind(weapon.name)} rarity={weapon.rarity ?? "common"} size={size * 0.9} />;
}

export function ForgeArmourySection({ onPick }: { onPick: (id: string) => void }) {
  const { weapons, source } = useForge();
  const models = useForgeModels();
  // ForgeCatalogueModel.refresh: bring the models down once the catalogue is in.
  useEffect(() => {
    if (weapons.length) void syncForgeModels(weapons, source === "network");
  }, [weapons, source]);
  if (!weapons.length) return null;
  return (
    <View style={styles.section}>
      <View style={styles.head} accessible accessibilityRole="header" accessibilityLabel={`From the Forge, ${weapons.length} weapons`}>
        <View style={[styles.mark, { backgroundColor: FORGE_ACCENT }]}>
          <Ionicons name="hammer" size={16} color="#FFF" />
        </View>
        <GameHeading text="From the Forge" size={24} />
        <View style={{ flex: 1 }} />
        <Text style={styles.count} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {weapons.length}
        </Text>
      </View>
      <Text style={styles.blurb} maxFontSizeMultiplier={MAX_FONT_SCALE}>{"New weapons published by the Forge. A first look: they aren't Relics yet."}</Text>
      <View style={styles.grid}>
        {weapons.map((w) => (
          <ForgeTile key={w.id} weapon={w} has3d={FORGE_3D_AVAILABLE && !!models[w.id]} onPress={() => onPick(w.id)} />
        ))}
      </View>
    </View>
  );
}

function ForgeTile({ weapon: w, has3d, onPress }: { weapon: ForgeElement; has3d: boolean; onPress: () => void }) {
  const rarity = w.rarity ?? "common";
  return (
    <Pressable
      onPressIn={pressFeedback}
      onPress={onPress}
      style={({ pressed }) => [styles.tileWrap, { transform: [{ scale: pressed ? 0.95 : 1 }], opacity: pressed ? 0.94 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={`Forge weapon: ${w.name}, ${rarity}, damage ${forgeNumber(w.stats?.damage)}`}>
      <View style={{ paddingBottom: 4 }}>
        <View style={[StyleSheet.absoluteFill, { top: 4, borderRadius: 16, backgroundColor: edgeOf(GP.cream) }]} />
        <View style={[styles.tile, { borderColor: `${rarityColor(rarity)}B3` }]}>
          <ForgeArt weapon={w} size={46} width={256} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.tileName} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {w.name}
            </Text>
            <Text style={[styles.tileRarity, { color: rarityInk(rarity) }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {rarityName(rarity).toUpperCase()}
            </Text>
            <View style={styles.dmg}>
              <Ionicons name="flame" size={12} color={GP.berry} />
              <Text style={styles.dmgText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {forgeNumber(w.stats?.damage)}
              </Text>
            </View>
          </View>
        </View>
      </View>
      <Text style={styles.tag} maxFontSizeMultiplier={1.2}>
        {forgeTileTag(has3d)}
      </Text>
    </Pressable>
  );
}

export function ForgeWeaponDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { weapons } = useForge();
  const config = useGame((s) => s.config);
  const models = useForgeModels();
  const reduced = useReducedMotion();
  const w = weapons.find((x) => x.id === id);
  // Opened before the sync reached this weapon: fetch (or verify) its model now.
  const wanted = w && weaponHas3d(w) ? w : null;
  useEffect(() => {
    if (wanted && !models[wanted.id]) void ensureForgeModel(wanted).then((uri) => (uri ? syncForgeModels([wanted], false) : undefined));
  }, [wanted, models]);
  if (!w) return null;
  const rarity = w.rarity ?? "common";
  const tint = rarityColor(rarity);
  const modelUri = FORGE_3D_AVAILABLE ? models[w.id] : undefined;
  const show3d = !!modelUri && CostQuestModelView !== null;
  return (
    <View style={styles.panelWrap}>
      <GamePanel padding={18}>
        <View style={styles.stack}>
          <View style={styles.chips}>
            <Chip text={rarityName(rarity)} color={tint} />
            {w.realm ? <Chip text={factionLabel(config?.factions, w.realm)} color={realmColor(w.realm)} /> : null}
            <Chip text="Forge" color={FORGE_ACCENT} />
            <View style={{ flex: 1 }} />
            <GameIconButton icon="close" color={withAlpha(GP.ink, 0.55)} diameter={36} onPress={onClose} accessibilityLabel="Close" />
          </View>
          <View style={styles.stage} accessible={!show3d} accessibilityLabel={`${w.name}, drawn`}>
            <LinearGradient colors={[GP.navy, GP.navyEdge]} style={StyleSheet.absoluteFill} />
            <View style={styles.burst} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <RelicSunburst color={tint} size={360} />
            </View>
            {show3d && CostQuestModelView ? (
              <CostQuestModelView
                style={styles.model}
                uri={modelUri}
                tint={tint}
                spin={!reduced}
                accessibilityLabel={`${w.name}, a 3D model. Drag to turn it.`}
              />
            ) : (
              <ForgeArt weapon={w} size={150} width={512} />
            )}
          </View>
          <View style={{ alignItems: "center", gap: 2 }}>
            <Text style={styles.detailName} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {w.name}
            </Text>
            <Text style={styles.detailSub} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {forgeDetailSubtitle(w.version, show3d)}
            </Text>
          </View>
          <View style={styles.stats}>
            <Stat title="Damage" value={forgeNumber(w.stats?.damage)} icon="flame" colour={GP.berry} />
            <Stat title="Range" value={`${forgeNumber(w.stats?.range_m)} m`} icon="locate" colour={GP.skyDeep} />
            <Stat title="Cooldown" value={`${forgeNumber(w.stats?.cooldown_s)} s`} icon="timer" colour={GP.mint} />
          </View>
          <Text style={styles.note} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {"Published by the Forge. A first look only: it isn't one of your Relics and can't be equipped yet."}
          </Text>
        </View>
      </GamePanel>
    </View>
  );
}

function Stat({ title, value, icon, colour }: { title: string; value: string; icon: keyof typeof Ionicons.glyphMap; colour: string }) {
  return (
    <View style={[styles.stat, { backgroundColor: `${colour}1F` }]} accessible accessibilityLabel={`${title} ${value}`}>
      <View style={[styles.statIcon, { backgroundColor: colour }]}>
        <Ionicons name={icon} size={14} color="#FFF" />
      </View>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {value}
      </Text>
      <Text style={styles.statTitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  mark: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: "#FFF", alignItems: "center", justifyContent: "center" },
  count: { fontFamily: GF.display, fontSize: 18, color: "#FFF", fontVariant: ["tabular-nums"], textShadowColor: "rgba(0,0,0,0.3)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 0.1 },
  blurb: { fontFamily: GF.body, fontSize: 13, color: withAlpha(GP.ink, 0.7) },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tileWrap: { width: "48%", paddingTop: 6 },
  tile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
    borderRadius: 16,
    borderWidth: 1.5,
    backgroundColor: GP.cream,
  },
  tileName: { fontFamily: GF.display, fontSize: 15, color: GP.ink },
  tileRarity: { fontFamily: GF.display, fontSize: 10, letterSpacing: 0.6 },
  dmg: { flexDirection: "row", alignItems: "center", gap: 3 },
  dmgText: { fontFamily: GF.bold, fontSize: 12, color: GP.berry },
  tag: {
    position: "absolute",
    top: 0,
    right: -2,
    fontFamily: GF.display,
    fontSize: 9,
    letterSpacing: 0.6,
    color: "#FFF",
    backgroundColor: FORGE_ACCENT,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: "hidden",
  },
  panelWrap: { width: "100%", maxWidth: 380 },
  stack: { gap: 12 },
  chips: { flexDirection: "row", alignItems: "center", gap: 6 },
  // 230 high, a navy gradient with the sunburst at 0.35 behind the model.
  stage: { height: 230, borderRadius: 20, overflow: "hidden", backgroundColor: GP.navy, alignItems: "center", justifyContent: "center" },
  burst: { position: "absolute", opacity: 0.35, alignItems: "center", justifyContent: "center" },
  model: { ...StyleSheet.absoluteFill },
  detailName: { fontFamily: GF.display, fontSize: 26, color: GP.ink, textAlign: "center" },
  detailSub: { fontFamily: GF.body, fontSize: 14, color: withAlpha(GP.ink, 0.6) },
  stats: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, alignItems: "center", gap: 3, paddingVertical: 8, borderRadius: 14 },
  statIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  statValue: { fontFamily: GF.display, fontSize: 18, color: GP.ink },
  statTitle: { fontFamily: GF.bold, fontSize: 12, color: GP.mist },
  note: { fontFamily: GF.body, fontSize: 13, color: GP.mist, textAlign: "center" },
});
