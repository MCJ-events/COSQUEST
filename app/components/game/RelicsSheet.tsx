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
import { type ReactNode, useEffect, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { ActivityIndicator, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
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
import { SPRING_RELIC_DETAIL, SPRING_SHARD_BAR } from "@/features/game/spring";

import { ForgeArmourySection, ForgeWeaponDetail } from "./ForgeArmoury";
import { GameBackdrop } from "./GameBackdrop";
import { announce, Chip, GameButton, GameHeading, GameIconButton, GamePanel, MAX_FONT_SCALE, pressFeedback, withAlpha } from "./kit";
import { RelicArt, RelicPips, RelicSunburst, rarityColor, rarityInk, SHARD } from "./RelicArt";
import { SheetHeader } from "./SheetHeader";
import { playSound } from "./sound";
import { edgeOf, GF, GP, realmColor, realmIcon } from "./theme";
import { useOnScreen } from "./useOnScreen";

type Picked = { kind: "relic"; id: string } | { kind: "forge"; id: string } | null;

export default function RelicsSheet({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const me = useGame((s) => s.me);
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
      <GameBackdrop />
      <View style={styles.head}>
        <SheetHeader title="Relics" onClose={onClose} closeLabel="Close the Relics" />
      </View>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        {p ? (
          <>
            <View style={styles.chips}>
              <Chip text={`${p.owned.length} of ${p.catalogue_size} found`} color={GP.skyDeep} />
              {totalShards(p) > 0 ? <Chip text={`${totalShards(p)} shards`} color={SHARD} /> : null}
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
              <GameButton title="Try again" size="small" color={GP.sky} onPress={() => void relicsStore.refresh()} />
            </View>
            <ForgeArmourySection onPick={(id) => setPicked({ kind: "forge", id })} />
          </>
        ) : (
          <ActivityIndicator color="#FFF" style={{ marginTop: 40 }} />
        )}
      </ScrollView>

      {picked ? (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={[StyleSheet.absoluteFill, styles.scrim]} accessibilityViewIsModal>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close the card" accessibilityRole="button" />
          <Pop key={`${picked.kind}:${picked.id}`}>
            {picked.kind === "relic" ? (
              <RelicDetail id={picked.id} stub={p?.catalogue.find((s) => s.id === picked.id) ?? null} onClose={close} />
            ) : (
              <ForgeWeaponDetail id={picked.id} onClose={close} />
            )}
          </Pop>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/** A card popping in: scale from 0.88 with a fade, `.spring(response: 0.35, dampingFraction: 0.78)`; a fade under Reduce Motion. */
function Pop({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const k = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    k.set(reduced ? withTiming(1, { duration: 150 }) : withSpring(1, SPRING_RELIC_DETAIL));
  }, [k, reduced]);
  const style = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, k.get() * 1.4)),
    transform: [{ scale: reduced ? 1 : 0.88 + 0.12 * k.get() }],
  }));
  return (
    <Animated.View style={[styles.cardWrap, style]} pointerEvents="box-none">
      {children}
    </Animated.View>
  );
}

/** The Relic in hand, big, because it is the one that goes into a siege. */
function Hero({ payload, onPick }: { payload: RelicsPayload; onPick: (id: string) => void }) {
  const r = equippedRelic(payload);
  if (!r) return null;
  return (
    <Pressable
      onPressIn={pressFeedback}
      onPress={() => onPick(r.id)}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}
      accessibilityRole="button"
      accessibilityLabel={`Equipped: ${r.name}, power ${powerNow(r)}. Shows the Relic.`}>
      <GamePanel padding={14}>
        <View style={styles.hero}>
          <RelicArt kind={r.kind} rarity={r.rarity} size={86} />
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={[styles.kicker, { color: rarityInk(r.rarity) }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              EQUIPPED
            </Text>
            <Text style={styles.heroName} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {r.name}
            </Text>
            <View style={styles.row}>
              <Ionicons name="flame" size={15} color={GP.berry} />
              <Text style={styles.power} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {powerNow(r)}
              </Text>
              <Ionicons name={abilityIcon(r.ability)} size={15} color={GP.skyDeep} />
              <Text style={styles.ability} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {abilityName(r.ability)}
              </Text>
            </View>
            <RelicPips level={levelNow(r)} tint={rarityColor(r.rarity)} />
          </View>
        </View>
      </GamePanel>
    </Pressable>
  );
}

function FactionSection({ faction, payload, mine, onPick }: { faction: string; payload: RelicsPayload; mine: boolean; onPick: (id: string) => void }) {
  const config = useGame((s) => s.config);
  const all = catalogueOf(payload, faction);
  if (!all.length) return null;
  const have = all.filter((s) => ownedRelic(payload, s.id)).length;
  const colour = realmColor(faction);
  const name = factionLabel(config?.factions, faction);
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel={`${name}${mine ? ", yours" : ""}: ${have} of ${all.length}`} importantForAccessibility="yes">
        <View style={[styles.mark, { backgroundColor: colour }]}>
          <Ionicons name={realmIcon(faction)} size={16} color="#FFF" />
        </View>
        <GameHeading text={name} size={24} />
        {mine ? <Chip text="Yours" color={colour} /> : null}
        <View style={{ flex: 1 }} />
        <Text style={styles.count} maxFontSizeMultiplier={MAX_FONT_SCALE}>{`${have}/${all.length}`}</Text>
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
      onPressIn={pressFeedback}
      onPress={onPress}
      style={({ pressed }) => [styles.tileWrap, { transform: [{ scale: pressed ? 0.95 : 1 }], opacity: pressed ? 0.94 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={owned ? `${s.name}, ${s.rarity}, level ${levelNow(r)}${equipped ? ", equipped" : ""}` : `Not found yet, ${s.rarity}`}>
      <View style={{ paddingBottom: 4 }}>
        <View style={[StyleSheet.absoluteFill, { top: 4, borderRadius: 16, backgroundColor: owned ? edgeOf(GP.cream) : withAlpha(GP.navyEdge, 0.6) }]} />
        <View
          style={[
            styles.tile,
            { backgroundColor: owned ? GP.cream : withAlpha(GP.navy, 0.55) },
            { borderColor: equipped ? GP.mint : owned ? `${rarityColor(s.rarity)}B3` : "rgba(255,255,255,0.1)", borderWidth: equipped ? 3 : 1.5 },
          ]}>
          <RelicArt kind={r?.kind ?? s.kind ?? "blade"} rarity={s.rarity} owned={owned} size={54} />
          {r ? (
            <RelicPips level={levelNow(r)} tint={rarityColor(s.rarity)} size={4} />
          ) : (
            <Text style={styles.lockedRarity} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {rarityName(s.rarity).toUpperCase()}
            </Text>
          )}
        </View>
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
  const config = useGame((s) => s.config);
  const reduced = useReducedMotion();
  const r = ownedRelic(payload, id);
  const bump = useSharedValue(1);
  const lastLevelled = levelled?.id === id ? levelled.serial : 0;
  // Only a level bought while this card is open: not one from before it.
  const [openedAt] = useState(lastLevelled);
  useEffect(() => {
    if (!lastLevelled || lastLevelled === openedAt || reduced) return;
    // keyframeAnimator: SpringKeyframe(1.25, 0.18 s) then SpringKeyframe(1.0, 0.4 s).
    bump.set(withSequence(withSpring(1.25, { duration: 180 }), withSpring(1, { duration: 400 })));
  }, [lastLevelled, openedAt, bump, reduced]);
  const bumpStyle = useAnimatedStyle(() => ({ transform: [{ scale: bump.get() }] }));
  // iOS has no live regions: say a refusal when it arrives.
  useEffect(() => {
    if (problem) announce(problem);
  }, [problem]);

  if (!r) return <LockedDetail stub={stub} onClose={onClose} />;
  const tint = rarityColor(r.rarity);
  const isEquipped = payload?.equipped === r.id;

  return (
    <View style={styles.panelWrap}>
      <GamePanel padding={18}>
        <View style={styles.stack}>
          <View style={styles.row}>
            <Chip text={rarityName(r.rarity)} color={tint} />
            <Chip text={r.faction_name ?? factionLabel(config?.factions, r.faction)} color={realmColor(r.faction)} />
            <View style={{ flex: 1 }} />
            <GameIconButton icon="close" color={withAlpha(GP.ink, 0.55)} diameter={36} onPress={onClose} accessibilityLabel="Close" />
          </View>
          <View style={styles.artStage}>
            {/* Sunburst, 260 wide at half strength, masked to a 200 circle. */}
            <View style={styles.burst} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <RelicSunburst color={tint} size={260} />
            </View>
            <Animated.View style={bumpStyle}>
              <RelicArt kind={r.kind} rarity={r.rarity} size={130} />
            </Animated.View>
          </View>
          <View style={{ alignItems: "center", gap: 2 }}>
            <Text style={styles.detailName} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {r.name}
            </Text>
            <Text style={styles.detailSub} maxFontSizeMultiplier={MAX_FONT_SCALE}>{`${kindName(r.kind)} · Level ${levelNow(r)}`}</Text>
          </View>
          <View style={[styles.row, { justifyContent: "center", gap: 10 }]}>
            <View style={[styles.stat, { backgroundColor: `${GP.berry}1F` }]} accessible accessibilityLabel={`Power ${powerNow(r)}`}>
              <View style={[styles.statIcon, { backgroundColor: GP.berry }]}>
                <Ionicons name="flame" size={15} color="#FFF" />
              </View>
              <Text style={styles.statValue} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {powerNow(r)}
              </Text>
              <Text style={styles.statTitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                Power
              </Text>
            </View>
            <View style={[styles.stat, { backgroundColor: `${GP.skyDeep}1F` }]} accessible accessibilityLabel={abilityName(r.ability)}>
              <View style={[styles.statIcon, { backgroundColor: GP.skyDeep }]}>
                <Ionicons name={abilityIcon(r.ability)} size={15} color="#FFF" />
              </View>
              <Text style={styles.statTitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {abilityName(r.ability)}
              </Text>
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
                size="medium"
                style={{ flex: 1 }}
                icon={<Ionicons name="arrow-up-circle" size={20} color="#FFF" />}
                disabled={!canLevel(r) || busy}
                accessibilityLabel={canLevel(r) ? `Level up for ${levelCost(r)} shards` : `Level up: needs ${levelCost(r)} shards`}
                onPress={async () => {
                  // RelicsModel.levelUp: fanfare and success on a level, an error buzz when refused.
                  const got = await relicsStore.levelUp(r.id);
                  if (got) {
                    playSound("fanfare");
                    announce(`${got.name} is level ${levelNow(got)}`);
                  }
                  Haptics.notificationAsync(got ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
                }}
              />
            ) : null}
            {isEquipped ? (
              <View style={styles.equippedTag} accessible accessibilityLabel="Equipped">
                <Ionicons name="checkmark" size={18} color="#FFF" />
                <Text style={styles.equippedText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  Equipped
                </Text>
              </View>
            ) : (
              <GameButton
                title="Equip"
                color={GP.mint}
                size="medium"
                style={{ flex: 1 }}
                icon={<Ionicons name="hand-left" size={18} color="#FFF" />}
                disabled={busy}
                accessibilityLabel={`Equip ${r.name}`}
                onPress={async () => {
                  // RelicsModel.equip: the coin cue and a medium impact once the server has taken it.
                  const ok = await relicsStore.equip(r.id);
                  if (!ok) return;
                  playSound("coin");
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                  announce(`${r.name} equipped`);
                }}
              />
            )}
          </View>
        </View>
      </GamePanel>
    </View>
  );
}

function ShardBar({ relic: r }: { relic: RelicFull }) {
  const reduced = useReducedMotion();
  const have = r.shards ?? 0;
  const cost = levelCost(r);
  const frac = have / Math.max(1, cost);
  const full = frac >= 1;
  const width = useSharedValue(Math.min(1, frac));
  useEffect(() => {
    // `.spring(response: 0.4, dampingFraction: 0.7)` on the shard count.
    const to = Math.min(1, frac);
    width.set(reduced ? withTiming(to, { duration: 150 }) : withSpring(to, SPRING_SHARD_BAR));
  }, [frac, reduced, width]);
  const fill = useAnimatedStyle(() => ({ width: `${Math.max(0, Math.min(1, width.get())) * 100}%` }));
  return (
    <View style={{ gap: 4 }} accessible accessibilityLabel={`Shards ${have} of ${cost}`}>
      <View style={styles.row}>
        <Ionicons name="diamond" size={13} color={SHARD} />
        <Text style={[styles.shardLabel, { color: SHARD }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Shards
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.shardCount} maxFontSizeMultiplier={MAX_FONT_SCALE}>{`${have} / ${cost}`}</Text>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { minWidth: 12 }, fill]}>
          {/* #B88CFF to #804DE6, or sun to sunDeep when it is full. */}
          <LinearGradient
            colors={full ? [GP.sun, GP.sunDeep] : ["#B88CFF", "#804DE6"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.fillShine} />
        </Animated.View>
      </View>
      <Text style={styles.shardNote} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {full ? "Ready to level up: +8% power" : "Duplicates break into shards."}
      </Text>
    </View>
  );
}

function LockedDetail({ stub, onClose }: { stub: RelicStub | null; onClose: () => void }) {
  return (
    <View style={styles.lockedWrap}>
      <GamePanel padding={18}>
        <View style={[styles.stack, { alignItems: "center" }]}>
          <View style={[styles.row, { alignSelf: "stretch" }]}>
            {stub ? <Chip text={rarityName(stub.rarity)} color={rarityColor(stub.rarity)} /> : null}
            <View style={{ flex: 1 }} />
            <GameIconButton icon="close" color={withAlpha(GP.ink, 0.55)} diameter={36} onPress={onClose} accessibilityLabel="Close" />
          </View>
          <RelicArt kind={stub?.kind ?? "blade"} rarity={stub?.rarity ?? "common"} owned={false} size={120} />
          <Text style={styles.detailName} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {stub?.name ?? "Unknown Relic"}
          </Text>
          <Text style={styles.lockedTitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Not found yet
          </Text>
          <Text style={styles.abilityText}>{lockedHint(stub?.rarity)}</Text>
        </View>
      </GamePanel>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: GP.ice, elevation: 18, overflow: "hidden" },
  head: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10 },
  body: { paddingHorizontal: 18, gap: 16 },
  chips: { flexDirection: "row", gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  hero: { flexDirection: "row", alignItems: "center", gap: 14 },
  kicker: { fontFamily: GF.display, fontSize: 12, letterSpacing: 1.2 },
  heroName: { fontFamily: GF.display, fontSize: 22, color: GP.ink },
  power: { fontFamily: GF.display, fontSize: 17, color: GP.ink, marginRight: 8 },
  ability: { fontFamily: GF.bold, fontSize: 15, color: GP.skyDeep },
  mark: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: "#FFF", alignItems: "center", justifyContent: "center" },
  count: { fontFamily: GF.display, fontSize: 18, color: "#FFF", fontVariant: ["tabular-nums"], textShadowColor: "rgba(0,0,0,0.3)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 0.1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tileWrap: { width: "22.5%", paddingTop: 4 },
  tile: { alignItems: "center", gap: 4, paddingVertical: 6, borderRadius: 16, minHeight: 82 },
  lockedRarity: { fontFamily: GF.display, fontSize: 9, letterSpacing: 0.6, color: "rgba(255,255,255,0.6)" },
  corner: { position: "absolute", top: 0, right: -2, width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: "#FFF", alignItems: "center", justifyContent: "center" },
  failed: { alignItems: "center", gap: 12, padding: 18, borderRadius: 24, backgroundColor: GP.cream },
  failedText: { fontFamily: GF.bold, fontSize: 16, color: GP.ink },
  scrim: { backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 20 },
  cardWrap: { width: "100%", alignItems: "center" },
  panelWrap: { width: "100%", maxWidth: 380 },
  lockedWrap: { width: "100%", maxWidth: 360 },
  stack: { gap: 12 },
  artStage: { height: 160, alignItems: "center", justifyContent: "center" },
  // 260 square at half strength, masked to a 200 circle.
  burst: { position: "absolute", width: 200, height: 200, borderRadius: 100, overflow: "hidden", opacity: 0.5, alignItems: "center", justifyContent: "center" },
  detailName: { fontFamily: GF.display, fontSize: 26, color: GP.ink, textAlign: "center" },
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
  fill: { height: 14, borderRadius: 7, overflow: "hidden" },
  fillShine: { position: "absolute", top: 2, left: 6, right: 6, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.3)" },
  shardNote: { fontFamily: GF.body, fontSize: 12, color: GP.mist },
  problem: { fontFamily: GF.bold, fontSize: 13, color: GP.berry, textAlign: "center" },
  actions: { flexDirection: "row", gap: 10 },
  equippedTag: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 54, borderRadius: 20, backgroundColor: `${GP.mint}99` },
  equippedText: { fontFamily: GF.display, fontSize: 19, color: "#FFF" },
  lockedTitle: { fontFamily: GF.bold, fontSize: 15, color: GP.mist },
});
