// A Relic dropping, on the reward screen: a burst in its rarity's colour, the
// crystal flips in, and a line says whether it is new or shards.
// costquest-ios Features/RelicsFeature.swift (RelicDropCard), placed in
// Roam/RewardView.swift (the extras, after the XP has counted).
//
// The drop is the server's (roam_relics.grant, in the verdict's `extras`);
// this only draws it, and asks for the Relicdex again so the rail badge and
// the Relicdex have it (RelicsModel.noteDrop in RoamHomeView).
import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";

import { abilityName, powerNow, relicDrop, type RelicDrop } from "@/features/game/relics";
import { relicsStore } from "@/features/game/relicsLive";
import type { RoamExtra } from "@/features/game/wire";

import { RelicArt, rarityColor } from "./RelicArt";
import { GF, GP } from "./theme";

export function RelicDropCard({ drop }: { drop: RelicDrop }) {
  const { relic, isNew, shards } = drop;
  const tint = rarityColor(relic.rarity);
  const flip = useSharedValue(0);
  const glow = useSharedValue(0);

  useEffect(() => {
    glow.value = withDelay(150, withTiming(1, { duration: 350 }));
    flip.value = withDelay(150, withSpring(1, { damping: 9, stiffness: 110 }));
    const t = setTimeout(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }, 150);
    relicsStore.noteDrop();
    return () => clearTimeout(t);
  }, [flip, glow]);

  const glowStyle = useAnimatedStyle(() => ({ opacity: 0.35 * glow.value, transform: [{ scale: 0.6 + 0.5 * glow.value }] }));
  const artStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, flip.value * 1.5),
    transform: [{ perspective: 600 }, { rotateY: `${(1 - flip.value) * 180}deg` }, { scale: 0.4 + 0.6 * flip.value }],
  }));
  const textStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, flip.value), transform: [{ translateX: (1 - Math.min(1, flip.value)) * 12 }] }));

  return (
    <View
      style={[styles.card, { backgroundColor: `${tint}24`, borderColor: `${tint}99` }]}
      accessible
      accessibilityLabel={isNew ? `New Relic: ${relic.name}, ${relic.rarity}` : `${relic.name} again: ${shards} shards`}>
      <View style={styles.art}>
        <Animated.View style={[styles.glow, { backgroundColor: tint }, glowStyle]} />
        <Animated.View style={artStyle}>
          <RelicArt kind={relic.kind} rarity={relic.rarity} size={66} />
        </Animated.View>
      </View>
      <Animated.View style={[styles.text, textStyle]}>
        <View style={styles.row}>
          {isNew ? <Text style={styles.newTag}>NEW!</Text> : null}
          <Text style={[styles.kicker, { color: tint }]}>{`${relic.rarity.toUpperCase()} RELIC`}</Text>
        </View>
        <Text style={styles.name} numberOfLines={2} adjustsFontSizeToFit>
          {relic.name}
        </Text>
        <Text style={[styles.line, { color: isNew ? GP.sky : "#B9A0FF" }]}>
          {isNew ? `${abilityName(relic.ability)} · power ${powerNow(relic)}` : `+${shards} shards`}
        </Text>
      </Animated.View>
    </View>
  );
}

/** A reward extra drawn as a drop card when it is a Relic, else null (Reward.tsx's extras). */
export function RelicDropExtra({ extra }: { extra: RoamExtra }) {
  const drop = relicDrop(extra);
  return drop ? <RelicDropCard drop={drop} /> : null;
}

export default RelicDropCard;

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 14, padding: 10, borderRadius: 18, borderWidth: 2 },
  art: { width: 80, height: 80, alignItems: "center", justifyContent: "center" },
  glow: { position: "absolute", width: 104, height: 104, borderRadius: 52 },
  text: { flex: 1, gap: 3 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  newTag: {
    fontFamily: GF.display,
    fontSize: 12,
    letterSpacing: 1,
    color: GP.ink,
    backgroundColor: GP.sun,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
  },
  kicker: { fontFamily: GF.display, fontSize: 12, letterSpacing: 1 },
  name: { fontFamily: GF.display, fontSize: 20, color: "#FFFFFF" },
  line: { fontFamily: GF.bold, fontSize: 14 },
});
