// The Relicdex: every Relic in the game by faction (your own first), the ones
// you have found with their level, the one in your hand, and the Forge's
// weapons; tap one for its card, where you equip it or spend shards on a
// level. costquest-ios Features/RelicsFeature.swift (RelicdexSheet,
// RelicDetail), opened from the rail (Roam/RoamHomeView.swift `showRelics`).
//
// The server decides what you own, what a level costs and whether you can
// have it (app/roam_relics.py): a refusal ("Needs 20 shards") is shown in its
// own words. Nothing here is bought with money.
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { ActivityIndicator, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown, useAnimatedStyle, useSharedValue, withSequence, withSpring, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  abilityIcon,
  abilityLine,
  abilityName,
  canLevel,
  catalogueOf,
  equippedRelic,
  factionLabel,
  factionsInOrder,
  isMaxed,
  kindName,
  levelCost,
  levelNow,
  lockedHint,
  ownedRelic,
  powerNow,
  rarityName,
  type RelicFull,
  type RelicsPayload,
  type RelicStub,
  totalShards,
} from "@/features/game/relics";
import { forgeStore, relicsStore, useRelics } from "@/features/game/relicsLive";
import { useGame } from "@/features/game/runtime";

import { ForgeArmourySection, ForgeWeaponDetail } from "./ForgeArmoury";
import { GameButton } from "./kit";
import { RelicArt, RelicPips, rarityColor, rarityInk, SHARD } from "./RelicArt";
import { GF, GP, realmColor, realmIcon } from "./theme";
import { useOnScreen } from "./useOnScreen";

type Picked = { kind: "relic"; id: string } | { kind: "forge"; id: string } | null;

export default function RelicsSheet({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { me } = useGame();
  const relics = useRelics();
  const [picked, setPicked] = useState<Picked>(null);

  useEffect(() => {
    void relicsStore.refresh();
    void forgeStore.refresh();
  }, []);

  // Back closes the card first (this listener is newer than the game's).
  const onScreen = useOnScreen();
  useEffect(() => {
    if (!picked || !onScreen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setPicked(null);
      return true;
    });
    return () => sub.remove();
  }, [picked, onScreen]);

  const close = () => {
    relicsStore.clearProblem();
    setPicked(null);
  };
  const p = relics.payload;

  return (
    <Animated.View entering={SlideInDown.springify().damping(20)} exiting={SlideOutDown.duration(180)} style={[styles.sheet, { top: insets.top + 40 }]}>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">
          Relics
        </Text>
        <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close the Relics" hitSlop={8}>
          <Ionicons name="close" size={20} color={GP.navy} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        {p ? (
          <>
            <View style={styles.chips}>
              <Text style={[styles.pill, { backgroundColor: GP.skyDeep }]}>{`${p.owned.length} of ${p.catalogue_size} found`}</Text>
              {totalShards(p) > 0 ? <Text style={[styles.pill, { backgroundColor: SHARD }]}>{`${totalShards(p)} shards`}</Text> : null}
            </View>
            <Hero payload={p} onPick={(id) => setPicked({ kind: "relic", id })} />
            <ForgeArmourySection onPick={(id) => setPicked({ kind: "forge", id })} />
            {factionsInOrder(me?.faction).map((f) => (
              <FactionSection key={f} faction={f} payload={p} mine={f === me?.faction} onPick={(id) => setPicked({ kind: "relic", id })} />
            ))}
          </>
        ) : relics.failed ? (
          <>
            <View style={styles.failed}>
              <Text style={styles.failedText}>{"Couldn't load your Relics."}</Text>
              <GameButton title="Try again" small color={GP.sky} onPress={() => void relicsStore.refresh()} />
            </View>
            <ForgeArmourySection onPick={(id) => setPicked({ kind: "forge", id })} />
          </>
        ) : (
          <ActivityIndicator color={GP.navy} style={{ marginTop: 40 }} />
        )}
      </ScrollView>

      {picked ? (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={[StyleSheet.absoluteFill, styles.scrim]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close the card" accessibilityRole="button" />
          <Animated.View entering={ZoomIn.springify().damping(16)} style={styles.cardWrap} pointerEvents="box-none">
            {picked.kind === "relic" ? (
              <RelicDetail id={picked.id} stub={p?.catalogue.find((s) => s.id === picked.id) ?? null} onClose={close} />
            ) : (
              <ForgeWeaponDetail id={picked.id} onClose={close} />
            )}
          </Animated.View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/** The Relic in hand, big, because it is the one that goes into a siege. */
function Hero({ payload, onPick }: { payload: RelicsPayload; onPick: (id: string) => void }) {
  const r = equippedRelic(payload);
  if (!r) return null;
  return (
    <Pressable
      onPress={() => onPick(r.id)}
      style={({ pressed }) => [styles.hero, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}
      accessibilityRole="button"
      accessibilityLabel={`Equipped: ${r.name}, power ${powerNow(r)}. Shows the Relic.`}>
      <RelicArt kind={r.kind} rarity={r.rarity} size={86} />
      <View style={{ flex: 1, gap: 5 }}>
        <Text style={[styles.kicker, { color: rarityInk(r.rarity) }]}>EQUIPPED</Text>
        <Text style={styles.heroName} numberOfLines={2} adjustsFontSizeToFit>
          {r.name}
        </Text>
        <View style={styles.row}>
          <Ionicons name="flame" size={15} color={GP.berry} />
          <Text style={styles.power}>{powerNow(r)}</Text>
          <Ionicons name={abilityIcon(r.ability)} size={15} color={GP.skyDeep} />
          <Text style={styles.ability}>{abilityName(r.ability)}</Text>
        </View>
        <RelicPips level={levelNow(r)} tint={rarityColor(r.rarity)} />
      </View>
    </Pressable>
  );
}

function FactionSection({ faction, payload, mine, onPick }: { faction: string; payload: RelicsPayload; mine: boolean; onPick: (id: string) => void }) {
  const { config } = useGame();
  const all = catalogueOf(payload, faction);
  if (!all.length) return null;
  const have = all.filter((s) => ownedRelic(payload, s.id)).length;
  const colour = realmColor(faction);
  const name = factionLabel(config?.factions, faction);
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel={`${name}${mine ? ", yours" : ""}: ${have} of ${all.length}`}>
        <View style={[styles.mark, { backgroundColor: colour }]}>
          <Ionicons name={realmIcon(faction)} size={16} color="#FFF" />
        </View>
        <Text style={styles.heading}>{name}</Text>
        {mine ? <Text style={[styles.pill, { backgroundColor: colour }]}>Yours</Text> : null}
        <View style={{ flex: 1 }} />
        <Text style={styles.count}>{`${have}/${all.length}`}</Text>
      </View>
      <View style={styles.grid}>
        {all.map((s) => (
          <Tile key={s.id} stub={s} relic={ownedRelic(payload, s.id)} equipped={payload.equipped === s.id} onPress={() => onPick(s.id)} />
        ))}
      </View>
    </View>
  );
}

function Tile({ stub: s, relic: r, equipped, onPress }: { stub: RelicStub; relic: RelicFull | null; equipped: boolean; onPress: () => void }) {
  const owned = r !== null;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tileWrap, { transform: [{ scale: pressed ? 0.95 : 1 }] }]}
      accessibilityRole="button"
      accessibilityLabel={owned ? `${s.name}, ${s.rarity}, level ${levelNow(r)}${equipped ? ", equipped" : ""}` : `Not found yet, ${s.rarity}`}>
      <View
        style={[
          styles.tile,
          owned ? styles.tileOwned : styles.tileLocked,
          { borderColor: equipped ? GP.mint : owned ? `${rarityColor(s.rarity)}B3` : "rgba(255,255,255,0.1)", borderWidth: equipped ? 3 : 1.5 },
        ]}>
        <RelicArt kind={r?.kind ?? s.kind ?? "blade"} rarity={s.rarity} owned={owned} size={50} />
        {r ? (
          <RelicPips level={levelNow(r)} tint={rarityColor(s.rarity)} size={4} />
        ) : (
          <Text style={styles.lockedRarity}>{rarityName(s.rarity).toUpperCase()}</Text>
        )}
      </View>
      {equipped ? (
        <View style={[styles.corner, { backgroundColor: GP.mint }]}>
          <Ionicons name="checkmark" size={11} color="#FFF" />
        </View>
      ) : r && canLevel(r) ? (
        <View style={[styles.corner, { backgroundColor: GP.sun }]}>
          <Ionicons name="arrow-up" size={11} color={GP.ink} />
        </View>
      ) : null}
    </Pressable>
  );
}

// ---------- the card ----------

function RelicDetail({ id, stub, onClose }: { id: string; stub: RelicStub | null; onClose: () => void }) {
  const { payload, busy, problem, levelled } = useRelics();
  const { config } = useGame();
  const r = ownedRelic(payload, id);
  const bump = useSharedValue(1);
  const lastLevelled = levelled?.id === id ? levelled.serial : 0;
  // Only a level bought while this card is open: not one from before it.
  const [openedAt] = useState(lastLevelled);
  useEffect(() => {
    if (!lastLevelled || lastLevelled === openedAt) return;
    bump.value = withSequence(withSpring(1.25, { duration: 180 }), withSpring(1, { duration: 400 }));
  }, [lastLevelled, openedAt, bump]);
  const bumpStyle = useAnimatedStyle(() => ({ transform: [{ scale: bump.value }] }));

  if (!r) return <LockedDetail stub={stub} onClose={onClose} />;
  const tint = rarityColor(r.rarity);
  const isEquipped = payload?.equipped === r.id;

  return (
    <View style={styles.panel}>
      <View style={styles.row}>
        <Text style={[styles.pill, { backgroundColor: tint }]}>{rarityName(r.rarity)}</Text>
        <Text style={[styles.pill, { backgroundColor: realmColor(r.faction) }]}>{r.faction_name ?? factionLabel(config?.factions, r.faction)}</Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
          <Ionicons name="close" size={20} color={GP.navy} />
        </Pressable>
      </View>
      <View style={styles.artStage}>
        <View style={[styles.halo, { backgroundColor: `${tint}33` }]} />
        <Animated.View style={bumpStyle}>
          <RelicArt kind={r.kind} rarity={r.rarity} size={120} />
        </Animated.View>
      </View>
      <View style={{ alignItems: "center", gap: 2 }}>
        <Text style={styles.detailName}>{r.name}</Text>
        <Text style={styles.detailSub}>{`${kindName(r.kind)} · Level ${levelNow(r)}`}</Text>
      </View>
      <View style={[styles.row, { justifyContent: "center", gap: 10 }]}>
        <View style={[styles.stat, { backgroundColor: `${GP.berry}1F` }]} accessible accessibilityLabel={`Power ${powerNow(r)}`}>
          <View style={[styles.statIcon, { backgroundColor: GP.berry }]}>
            <Ionicons name="flame" size={15} color="#FFF" />
          </View>
          <Text style={styles.statValue}>{powerNow(r)}</Text>
          <Text style={styles.statTitle}>Power</Text>
        </View>
        <View style={[styles.stat, { backgroundColor: `${GP.skyDeep}1F` }]}>
          <View style={[styles.statIcon, { backgroundColor: GP.skyDeep }]}>
            <Ionicons name={abilityIcon(r.ability)} size={15} color="#FFF" />
          </View>
          <Text style={styles.statTitle}>{abilityName(r.ability)}</Text>
        </View>
      </View>
      <Text style={styles.abilityText}>{r.ability_text ?? abilityLine(r.ability)}</Text>
      {r.lore ? <Text style={styles.lore}>{`“${r.lore}”`}</Text> : null}
      <View style={{ alignItems: "center" }}>
        <RelicPips level={levelNow(r)} tint={tint} size={10} />
      </View>
      {!isMaxed(r) ? <ShardBar relic={r} /> : null}
      {problem ? <Text style={styles.problem}>{problem}</Text> : null}
      <View style={styles.actions}>
        {!isMaxed(r) ? (
          <GameButton
            title="Level up"
            color={GP.sun}
            style={{ flex: 1 }}
            icon={<Ionicons name="arrow-up-circle" size={20} color="#FFF" />}
            disabled={!canLevel(r) || busy}
            accessibilityLabel={canLevel(r) ? `Level up for ${levelCost(r)} shards` : `Level up: needs ${levelCost(r)} shards`}
            onPress={async () => {
              const got = await relicsStore.levelUp(r.id);
              Haptics.notificationAsync(got ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
            }}
          />
        ) : null}
        {isEquipped ? (
          <View style={[styles.equippedTag]} accessible accessibilityLabel="Equipped">
            <Ionicons name="checkmark" size={18} color="#FFF" />
            <Text style={styles.equippedText}>Equipped</Text>
          </View>
        ) : (
          <GameButton
            title="Equip"
            color={GP.mint}
            style={{ flex: 1 }}
            icon={<Ionicons name="hand-left" size={18} color="#FFF" />}
            disabled={busy}
            accessibilityLabel={`Equip ${r.name}`}
            onPress={() => void relicsStore.equip(r.id)}
          />
        )}
      </View>
    </View>
  );
}

function ShardBar({ relic: r }: { relic: RelicFull }) {
  const have = r.shards ?? 0;
  const cost = levelCost(r);
  const frac = have / Math.max(1, cost);
  return (
    <View style={{ gap: 4 }} accessible accessibilityLabel={`Shards ${have} of ${cost}`}>
      <View style={styles.row}>
        <Ionicons name="diamond" size={13} color={SHARD} />
        <Text style={[styles.shardLabel, { color: SHARD }]}>Shards</Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.shardCount}>{`${have} / ${cost}`}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(8, Math.min(1, frac) * 100)}%`, backgroundColor: frac >= 1 ? GP.sun : SHARD }]} />
      </View>
      <Text style={styles.shardNote}>{frac >= 1 ? "Ready to level up: +8% power" : "Duplicates break into shards."}</Text>
    </View>
  );
}

function LockedDetail({ stub, onClose }: { stub: RelicStub | null; onClose: () => void }) {
  return (
    <View style={[styles.panel, { alignItems: "center" }]}>
      <View style={[styles.row, { alignSelf: "stretch" }]}>
        {stub ? <Text style={[styles.pill, { backgroundColor: rarityColor(stub.rarity) }]}>{rarityName(stub.rarity)}</Text> : null}
        <View style={{ flex: 1 }} />
        <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
          <Ionicons name="close" size={20} color={GP.navy} />
        </Pressable>
      </View>
      <RelicArt kind={stub?.kind ?? "blade"} rarity={stub?.rarity ?? "common"} owned={false} size={110} />
      <Text style={styles.detailName}>{stub?.name ?? "Unknown Relic"}</Text>
      <Text style={styles.lockedTitle}>Not found yet</Text>
      <Text style={styles.abilityText}>{lockedHint(stub?.rarity)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: GP.cream, elevation: 18, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 16, paddingBottom: 6 },
  title: { fontFamily: GF.display, fontSize: 26, color: GP.ink },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: GP.ice, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: 16, gap: 18 },
  chips: { flexDirection: "row", gap: 8 },
  pill: { fontFamily: GF.bold, fontSize: 12, color: "#FFF", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  hero: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 22, backgroundColor: "#FFF" },
  kicker: { fontFamily: GF.display, fontSize: 12, letterSpacing: 1.2 },
  heroName: { fontFamily: GF.display, fontSize: 21, color: GP.ink },
  power: { fontFamily: GF.display, fontSize: 17, color: GP.ink, marginRight: 8 },
  ability: { fontFamily: GF.bold, fontSize: 15, color: GP.skyDeep },
  mark: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: "#FFF", alignItems: "center", justifyContent: "center" },
  heading: { fontFamily: GF.display, fontSize: 22, color: GP.ink },
  count: { fontFamily: GF.display, fontSize: 18, color: GP.ink },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tileWrap: { width: "23%", paddingTop: 4 },
  tile: { alignItems: "center", gap: 4, paddingVertical: 6, borderRadius: 16, minHeight: 82 },
  tileOwned: { backgroundColor: "#FFF" },
  tileLocked: { backgroundColor: "rgba(31,59,77,0.55)" },
  lockedRarity: { fontFamily: GF.display, fontSize: 9, letterSpacing: 0.6, color: "rgba(255,255,255,0.6)" },
  corner: { position: "absolute", top: 0, right: -2, width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: "#FFF", alignItems: "center", justifyContent: "center" },
  failed: { alignItems: "center", gap: 12, padding: 18, borderRadius: 20, backgroundColor: "#FFF" },
  failedText: { fontFamily: GF.bold, fontSize: 16, color: GP.ink },
  scrim: { backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 20 },
  cardWrap: { width: "100%", alignItems: "center" },
  panel: { width: "100%", maxWidth: 380, padding: 18, gap: 12, borderRadius: 26, backgroundColor: GP.cream },
  artStage: { height: 150, alignItems: "center", justifyContent: "center" },
  halo: { position: "absolute", width: 170, height: 170, borderRadius: 85 },
  detailName: { fontFamily: GF.display, fontSize: 24, color: GP.ink, textAlign: "center" },
  detailSub: { fontFamily: GF.body, fontSize: 14, color: GP.mist },
  stat: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  statValue: { fontFamily: GF.display, fontSize: 21, color: GP.ink },
  statTitle: { fontFamily: GF.bold, fontSize: 15, color: GP.ink },
  abilityText: { fontFamily: GF.body, fontSize: 15, color: GP.ink, textAlign: "center" },
  lore: { fontFamily: GF.regular, fontStyle: "italic", fontSize: 14, color: GP.mist, textAlign: "center" },
  shardLabel: { fontFamily: GF.bold, fontSize: 13 },
  shardCount: { fontFamily: GF.display, fontSize: 15, color: GP.ink },
  track: { height: 14, borderRadius: 7, backgroundColor: "rgba(31,59,77,0.12)", overflow: "hidden" },
  fill: { height: 14, borderRadius: 7 },
  shardNote: { fontFamily: GF.body, fontSize: 12, color: GP.mist },
  problem: { fontFamily: GF.bold, fontSize: 13, color: GP.berry, textAlign: "center" },
  actions: { flexDirection: "row", gap: 10 },
  equippedTag: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 54, borderRadius: 18, backgroundColor: `${GP.mint}99` },
  equippedText: { fontFamily: GF.display, fontSize: 19, color: "#FFF" },
  lockedTitle: { fontFamily: GF.bold, fontSize: 15, color: GP.mist },
});
