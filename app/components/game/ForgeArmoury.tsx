// "From the Forge": the weapons the Forge portal has published, in the
// Relicdex next to the player's Relics, and one weapon's card.
// costquest-ios Features/ForgeFeature.swift (ForgeArmourySection,
// ForgeWeaponDetail), read from GET v1/catalogue (features/game/forge.ts).
//
// A first look only, as on iOS: the server has no route for a player to get,
// equip or trade a Forge weapon, so nothing here offers to.
// Where iOS turns the weapon's 3D model (a GLB, RealityKit), this shows the
// server's own thumbnail of that model when the build made one, and otherwise
// draws it in 2D: the shape read from its name, the colour from its rarity.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { type ForgeElement, forgeKind, forgeNumber, forgeThumbnailUrl } from "@/features/game/forge";
import { factionLabel, rarityName } from "@/features/game/relics";
import { useForge } from "@/features/game/relicsLive";
import { GAME_SERVER, useGame } from "@/features/game/runtime";

import { Chip } from "./kit";
import { RelicArt, rarityColor, rarityInk } from "./RelicArt";
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
  const { weapons } = useForge();
  if (!weapons.length) return null;
  return (
    <View style={styles.section}>
      <View style={styles.head} accessible accessibilityRole="header" accessibilityLabel={`From the Forge, ${weapons.length} weapons`}>
        <View style={[styles.mark, { backgroundColor: FORGE_ACCENT }]}>
          <Ionicons name="hammer" size={16} color="#FFF" />
        </View>
        <Text style={styles.heading}>From the Forge</Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.count}>{weapons.length}</Text>
      </View>
      <Text style={styles.blurb}>{"New weapons published by the Forge. A first look: they aren't Relics yet."}</Text>
      <View style={styles.grid}>
        {weapons.map((w) => (
          <ForgeTile key={w.id} weapon={w} onPress={() => onPick(w.id)} />
        ))}
      </View>
    </View>
  );
}

function ForgeTile({ weapon: w, onPress }: { weapon: ForgeElement; onPress: () => void }) {
  const rarity = w.rarity ?? "common";
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tileWrap, { transform: [{ scale: pressed ? 0.96 : 1 }] }]}
      accessibilityRole="button"
      accessibilityLabel={`Forge weapon: ${w.name}, ${rarity}, damage ${forgeNumber(w.stats?.damage)}`}>
      <View style={[styles.tile, { borderColor: `${rarityColor(rarity)}B3` }]}>
        <ForgeArt weapon={w} size={46} width={256} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.tileName} numberOfLines={2}>
            {w.name}
          </Text>
          <Text style={[styles.tileRarity, { color: rarityInk(rarity) }]}>{rarityName(rarity).toUpperCase()}</Text>
          <View style={styles.dmg}>
            <Ionicons name="flame" size={12} color={GP.berry} />
            <Text style={styles.dmgText}>{forgeNumber(w.stats?.damage)}</Text>
          </View>
        </View>
      </View>
      <Text style={styles.tag}>FORGE</Text>
    </Pressable>
  );
}

export function ForgeWeaponDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { weapons } = useForge();
  const { config } = useGame();
  const w = weapons.find((x) => x.id === id);
  if (!w) return null;
  const rarity = w.rarity ?? "common";
  const tint = rarityColor(rarity);
  return (
    <View style={styles.panel}>
      <View style={styles.chips}>
        <Chip text={rarityName(rarity)} color={tint} />
        {w.realm ? <Chip text={factionLabel(config?.factions, w.realm)} color={realmColor(w.realm)} /> : null}
        <Chip text="Forge" color={FORGE_ACCENT} />
        <View style={{ flex: 1 }} />
        <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
          <Ionicons name="close" size={20} color={GP.navy} />
        </Pressable>
      </View>
      <View style={[styles.stage, { borderColor: `${tint}66` }]} accessible accessibilityLabel={`${w.name}, drawn`}>
        <ForgeArt weapon={w} size={150} width={512} />
      </View>
      <View style={{ alignItems: "center", gap: 2 }}>
        <Text style={styles.detailName}>{w.name}</Text>
        <Text style={styles.detailSub}>Weapon · version {w.version}</Text>
      </View>
      <View style={styles.stats}>
        <Stat title="Damage" value={forgeNumber(w.stats?.damage)} icon="flame" colour={GP.berry} />
        <Stat title="Range" value={`${forgeNumber(w.stats?.range_m)} m`} icon="locate" colour={GP.skyDeep} />
        <Stat title="Cooldown" value={`${forgeNumber(w.stats?.cooldown_s)} s`} icon="timer" colour={GP.mint} />
      </View>
      <Text style={styles.note}>{"Published by the Forge. A first look only: it isn't one of your Relics and can't be equipped yet."}</Text>
    </View>
  );
}

function Stat({ title, value, icon, colour }: { title: string; value: string; icon: keyof typeof Ionicons.glyphMap; colour: string }) {
  return (
    <View style={[styles.stat, { backgroundColor: `${colour}1F` }]} accessible accessibilityLabel={`${title} ${value}`}>
      <View style={[styles.statIcon, { backgroundColor: colour }]}>
        <Ionicons name={icon} size={14} color="#FFF" />
      </View>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statTitle}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  mark: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: "#FFF", alignItems: "center", justifyContent: "center" },
  heading: { fontFamily: GF.display, fontSize: 22, color: GP.ink },
  count: { fontFamily: GF.display, fontSize: 18, color: GP.ink },
  blurb: { fontFamily: GF.body, fontSize: 13, color: GP.mist },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tileWrap: { width: "48%", paddingTop: 6 },
  tile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
    borderRadius: 16,
    borderWidth: 1.5,
    backgroundColor: "#FFF",
    borderBottomWidth: 4,
    borderBottomColor: edgeOf(GP.cream),
  },
  tileName: { fontFamily: GF.display, fontSize: 14, color: GP.ink },
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
  panel: { width: "100%", maxWidth: 380, padding: 18, gap: 12, borderRadius: 26, backgroundColor: GP.cream },
  chips: { flexDirection: "row", alignItems: "center", gap: 6 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: GP.ice, alignItems: "center", justifyContent: "center" },
  stage: { height: 200, borderRadius: 20, borderWidth: 2, backgroundColor: GP.navy, alignItems: "center", justifyContent: "center" },
  detailName: { fontFamily: GF.display, fontSize: 24, color: GP.ink, textAlign: "center" },
  detailSub: { fontFamily: GF.body, fontSize: 14, color: GP.mist },
  stats: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, alignItems: "center", gap: 3, paddingVertical: 8, borderRadius: 14 },
  statIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  statValue: { fontFamily: GF.display, fontSize: 18, color: GP.ink },
  statTitle: { fontFamily: GF.bold, fontSize: 12, color: GP.mist },
  note: { fontFamily: GF.body, fontSize: 13, color: GP.mist, textAlign: "center" },
});
