// Forge in the world (cq 056): the screens that put published Forge elements
// into play, all driven by the catalogue's contract (type, role, gameplay),
// never by a name. Behind the server's switch (features.forge_world in /me):
// with it off, every piece here renders nothing and the game is as before.
//
// - ForgeDropsLayer: Forge finds on the map (GET v1/roam/forge/drops), as pins
//   with the element's own thumbnail and a rarity ring.
// - ForgeClaim: walk up, see it in 3D, claim it (POST .../claim), the reward
//   moment, equip it.
// - ForgeBag: what you own (equip a weapon: it changes your duels) and the
//   characters you may wear as your avatar (idle / walk / celebrate).
// - PlayerAvatar / ForgeCelebrate: your Forge avatar on the HUD chip, the map
//   marker, the profile, and dancing on a reward.
// - ForgePointScene: a point's Forge station (instead of the built-in shrine)
//   standing in its Forge environment.
// - ForgeFighterArt: the Forge weapon you hold, or the Forge character a
//   Guardian or boss is, on the versus card.
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { distanceM, distanceText, toLocal, type LatLng } from "@/features/game/geo";
import {
  avatarChoices,
  type ForgeClaim as ClaimResult,
  type ForgeDrop,
  type ForgeEntry,
  fighterCharacter,
  fighterWeapon,
  pointForge,
  rarityRank,
  refusalText,
} from "@/features/game/forgeWorld";
import { claim, equip, refreshInventory, startForgeWorld, thumbUrl, absUrl, useEquipped, useForgeWorld } from "@/features/game/forgeWorldDevice";
import { gameStore, useGame } from "@/features/game/runtime";

import ForgeModel, { useForgeEntry } from "./ForgeModel";
import { GameButton, MAX_FONT_SCALE } from "./kit";
import { SheetHost } from "./Sheet";
import { SheetFrame } from "./SheetFrame";
import { SheetHeader } from "./SheetHeader";
import { playSound } from "./sound";
import { GF, GP } from "./theme";

/** How close a find must be to claim it; the server has the last word (its own reach). */
export const CLAIM_REACH_M = 40;

const RARITY_COLOR = ["#9AA7B0", GP.skyDeep, GP.rare, GP.sun];
export const rarityColor = (r: string | null | undefined) => RARITY_COLOR[Math.max(0, rarityRank(r))] ?? RARITY_COLOR[0];

/** Whether the server has Forge in the world switched on for this player. */
export function useForgeOn(): boolean {
  return useForgeWorld((s) => s.on);
}

/** Keeps the catalogue, the drops and the bag fresh while the game is up. */
export function useForgeWorldPolling(active: boolean) {
  const me = useGame((s) => s.me);
  const fix = useGame((s) => s.fix);
  useEffect(() => {
    if (!active) return;
    return startForgeWorld();
  }, [active, me?.device_key]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new fix far from the last ask: the poller picks it up on its next beat.
  void fix;
}

// ---------- the map ----------

/**
 * The finds on the map. `place` turns a spot into board pixels (WorldMap's
 * own projection), so the pins slide with the streets.
 */
export function ForgeDropsLayer({ place, onOpen }: { place: (p: LatLng) => { left: number; top: number }; onOpen: (d: ForgeDrop) => void }) {
  const on = useForgeOn();
  const drops = useForgeWorld((s) => s.drops);
  if (!on) return null;
  return (
    <>
      {drops
        .filter((d) => !d.claimed)
        .map((d) => {
          const at = place(d);
          return <DropPin key={d.id} drop={d} left={at.left} top={at.top} onPress={onOpen} />;
        })}
    </>
  );
}

function DropPin({ drop, left, top, onPress }: { drop: ForgeDrop; left: number; top: number; onPress: (d: ForgeDrop) => void }) {
  const ring = rarityColor(drop.rarity);
  const bob = useSharedValue(0);
  useEffect(() => {
    bob.set(withRepeat(withSequence(withTiming(1, { duration: 900 }), withTiming(0, { duration: 900 })), -1));
  }, [bob]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -4 * bob.get() }, { rotate: "45deg" }] }));
  const url = absUrl(drop.thumbnail_url);
  return (
    <Pressable
      onPress={() => onPress(drop)}
      hitSlop={6}
      style={[styles.dropPin, { left: left - 24, top: top - 52 }]}
      accessibilityRole="button"
      accessibilityLabel={`Forge find: ${drop.name}, ${drop.rarity ?? "common"}`}
      testID={`forge-drop-${drop.element_id.slice(0, 8)}`}>
      <Animated.View style={[styles.dropDiamond, { borderColor: ring }, style]}>
        <View style={{ transform: [{ rotate: "-45deg" }], width: 40, height: 40 }}>
          {url ? <Image source={{ uri: url }} style={{ width: 40, height: 40 }} contentFit="contain" /> : <Ionicons name="flash" size={26} color={ring} style={{ margin: 7 }} />}
        </View>
      </Animated.View>
      <View style={[styles.dropShadow, { backgroundColor: ring }]} />
    </Pressable>
  );
}

/** Your Forge avatar's face for the map marker and chips: the thumbnail (cheap), or nothing. */
export function AvatarBadge({ size = 30 }: { size?: number }) {
  const on = useForgeOn();
  const { avatar } = useEquipped();
  const entry = useForgeEntry(avatar);
  const url = on ? thumbUrl(entry, 128) : null;
  if (!url) return null;
  return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: "rgba(255,255,255,0.85)" }} contentFit="cover" accessibilityLabel={`${entry?.name ?? "Avatar"}`} />;
}

/**
 * The player's avatar: the Forge character they wear (thumbnail on chips, live
 * 3D on the profile stage), or the game's own avatar when they wear none.
 */
export function PlayerAvatar({ fallback, size, stage }: { fallback: ReactNode; size: number; stage?: boolean }) {
  const on = useForgeOn();
  const { avatar } = useEquipped();
  const entry = useForgeEntry(avatar);
  if (!on || !entry) return <>{fallback}</>;
  if (stage) {
    return <ForgeModel entry={entry} animation="idle" purpose="closeup" style={{ width: size, height: size * 1.4 }} size={size} distance={2.6} />;
  }
  const url = thumbUrl(entry, 128);
  return url ? (
    <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: GP.cream }} contentFit="cover" accessibilityLabel={`Avatar: ${entry.name}`} />
  ) : (
    <>{fallback}</>
  );
}

/** On a reward: the avatar (if any) plays its celebrate clip once. */
export function ForgeCelebrate({ size = 150 }: { size?: number }) {
  const on = useForgeOn();
  const { avatar } = useEquipped();
  const entry = useForgeEntry(avatar);
  if (!on || !entry) return null;
  return (
    <Animated.View entering={ZoomIn.delay(250)} style={{ width: size, height: size * 1.3, alignSelf: "center" }} pointerEvents="none">
      <ForgeModel entry={entry} animation={entry.rigged ? "celebrate" : null} purpose="scene" style={StyleSheet.absoluteFill} size={size} distance={2.6} />
    </Animated.View>
  );
}

// ---------- claiming a find ----------

type ClaimPhase = { kind: "look" } | { kind: "claiming" } | { kind: "won"; got: ClaimResult } | { kind: "refused"; reason: string };

export function ForgeClaim({ drop, onClose, onOpenBag }: { drop: ForgeDrop; onClose: () => void; onOpenBag: () => void }) {
  const insets = useSafeAreaInsets();
  const fix = useGame((s) => s.fix);
  const entry = useForgeEntry(drop.element_id);
  const [phase, setPhase] = useState<ClaimPhase>({ kind: "look" });
  const away = fix ? distanceM(fix, drop) : null;
  const near = away !== null && away <= CLAIM_REACH_M;
  const ring = rarityColor(drop.rarity);
  const stats = entry?.gameplay;

  const doClaim = async () => {
    setPhase({ kind: "claiming" });
    try {
      const got = await claim(drop);
      playSound("fanfare");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPhase({ kind: "won", got });
    } catch (e) {
      playSound("hit");
      setPhase({ kind: "refused", reason: refusalText(e) });
    }
  };
  const doEquip = async () => {
    try {
      await equip("weapon", drop.element_id);
      playSound("coin");
      onClose();
    } catch (e) {
      setPhase({ kind: "refused", reason: refusalText(e) });
    }
  };

  return (
    <Animated.View entering={FadeIn.duration(200)} style={[StyleSheet.absoluteFill, styles.claimRoot, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.claimTop}>
        <Text style={[styles.kicker, { color: ring }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {phase.kind === "won" ? (phase.got.duplicate ? "ANOTHER ONE" : "YOURS NOW") : `FORGE FIND · ${(drop.rarity ?? "common").toUpperCase()}`}
        </Text>
        <Text style={styles.claimName} numberOfLines={2} adjustsFontSizeToFit maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header">
          {drop.name}
        </Text>
      </View>
      <View style={styles.claimStage}>
        {phase.kind === "won" ? <Sunburst color={ring} /> : null}
        <ForgeModel id={drop.element_id} purpose="closeup" spin style={StyleSheet.absoluteFill} size={320} distance={phase.kind === "won" ? 2.3 : 2.6} />
      </View>
      {stats && (stats.damage || stats.range_m) ? (
        <View style={styles.statRow}>
          <Stat label="Damage" value={stats.damage} />
          <Stat label="Range" value={stats.range_m} unit="m" />
          <Stat label="Cooldown" value={stats.cooldown_s} unit="s" />
          {stats.class ? <Stat label="Fights as" text={stats.class} /> : null}
        </View>
      ) : null}
      <View style={styles.claimActions}>
        {phase.kind === "look" || phase.kind === "claiming" ? (
          <>
            <Text style={styles.claimHint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {near ? "It's right here. Take it!" : away !== null ? `${distanceText(away)} away. Walk closer to claim it.` : "Finding you…"}
            </Text>
            <GameButton title={phase.kind === "claiming" ? "Claiming…" : "Claim"} color={ring} disabled={!near || phase.kind === "claiming"} onPress={() => void doClaim()} accessibilityLabel="Claim this Forge find" />
          </>
        ) : phase.kind === "won" ? (
          <Animated.View entering={FadeInDown} style={{ gap: 10, width: "100%", alignItems: "center" }}>
            <Text style={styles.claimHint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {phase.got.duplicate ? `You had one already: +${phase.got.coins} coins.` : "It's in your Forge bag."}
            </Text>
            {drop.type === "weapon" ? <GameButton title="Equip it" color={GP.mint} onPress={() => void doEquip()} accessibilityLabel="Equip this weapon" /> : null}
            <GameButton
              title="Open bag"
              small
              color={GP.skyDeep}
              onPress={() => {
                onClose();
                onOpenBag();
              }}
            />
          </Animated.View>
        ) : (
          <>
            <Text style={[styles.claimHint, { color: "#FFD0D0" }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {phase.reason}
            </Text>
            <GameButton title="Try again" small color={GP.skyDeep} onPress={() => setPhase({ kind: "look" })} />
          </>
        )}
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
          <Text style={styles.claimClose}>Close</Text>
        </Pressable>
      </View>
      {phase.kind === "won" ? (
        <View style={styles.claimAvatar} pointerEvents="none">
          <ForgeCelebrate size={110} />
        </View>
      ) : null}
    </Animated.View>
  );
}

function Sunburst({ color }: { color: string }) {
  const spin = useSharedValue(0);
  useEffect(() => {
    spin.set(withRepeat(withTiming(1, { duration: 9000 }), -1));
  }, [spin]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.get() * 360}deg` }] }));
  return (
    <Animated.View style={[styles.burst, style]} pointerEvents="none">
      {Array.from({ length: 12 }, (_, i) => (
        <View key={i} style={[styles.ray, { backgroundColor: color, transform: [{ rotate: `${i * 30}deg` }, { translateY: -110 }] }]} />
      ))}
    </Animated.View>
  );
}

function Stat({ label, value, unit, text }: { label: string; value?: number | null; unit?: string; text?: string }) {
  if (text === undefined && (value === null || value === undefined)) return null;
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {text ?? `${Math.round((value as number) * 10) / 10}${unit ?? ""}`}
      </Text>
      <Text style={styles.statLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {label}
      </Text>
    </View>
  );
}

// ---------- the bag ----------

export function ForgeBag({ onClose, initial = "items" }: { onClose: () => void; initial?: "items" | "avatar" }) {
  const insets = useSafeAreaInsets();
  return (
    <SheetHost band={{ top: insets.top + 40, height: 90 }} scrimLabel="Close the Forge bag" onClose={onClose}>
      {(close) => <BagBody close={close} initial={initial} />}
    </SheetHost>
  );
}

function BagBody({ close, initial }: { close: () => void; initial: "items" | "avatar" }) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<"items" | "avatar">(initial);
  const inventory = useForgeWorld((s) => s.inventory);
  const entries = useForgeWorld((s) => s.entries);
  const equipped = useEquipped();
  const [pick, setPick] = useState<string | null>(null);
  const [clip, setClip] = useState<string>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    void refreshInventory();
  }, []);
  const owned = useMemo(() => (inventory?.owned ?? []).filter((o) => entries.some((e) => e.id === o.element_id)), [inventory, entries]);
  const heroes = useMemo(() => avatarChoices(entries), [entries]);
  const list: { id: string; count?: number }[] = tab === "items" ? owned.map((o) => ({ id: o.element_id, count: o.count })) : heroes.map((h) => ({ id: h.id }));
  const selected = pick && list.some((x) => x.id === pick) ? pick : (list[0]?.id ?? null);
  const sel = entries.find((e) => e.id === selected) ?? null;
  const slot = tab === "items" ? "weapon" : "avatar";
  const isOn = sel ? equipped[slot] === sel.id : false;

  const toggle = async () => {
    if (!sel) return;
    setProblem(null);
    try {
      await equip(slot, isOn ? null : sel.id);
      playSound("coin");
      if (slot === "avatar" && !isOn) setClip("celebrate");
    } catch (e) {
      setProblem(refusalText(e));
    }
  };

  return (
    <SheetFrame top={insets.top + 40}>
      <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>
        <SheetHeader title="Forge bag" onClose={close} />
      </View>
      <View style={styles.tabs}>
        {(["items", "avatar"] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
            <Text style={[styles.tabText, tab === t && { color: "#FFF" }]}>{t === "items" ? `Items (${owned.length})` : "Avatar"}</Text>
          </Pressable>
        ))}
      </View>
      {sel ? (
        <View style={styles.bagStage}>
          <ForgeModel
            entry={sel}
            purpose="closeup"
            animation={sel.type === "character" ? clip : null}
            onAnimationEnd={() => setClip("idle")}
            spin={sel.type !== "character"}
            style={StyleSheet.absoluteFill}
            size={260}
            distance={sel.type === "character" ? 2.7 : 2.6}
          />
          <Text style={styles.bagName} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {sel.name}
          </Text>
        </View>
      ) : (
        <View style={[styles.bagStage, styles.centre]}>
          <Text style={styles.empty} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {tab === "items" ? "Nothing yet. Forge finds glow on the map: walk up and claim one." : "No characters to wear yet."}
          </Text>
        </View>
      )}
      {sel ? (
        <View style={styles.bagActions}>
          {sel.type === "character" && sel.rigged
            ? (["idle", "walk", "celebrate"] as const).map((c) => <GameButton key={c} title={c[0].toUpperCase() + c.slice(1)} small color={clip === c ? GP.sun : GP.slate} onPress={() => setClip(c)} />)
            : null}
          <GameButton title={isOn ? (slot === "avatar" ? "Take off" : "Unequip") : slot === "avatar" ? "Wear" : "Equip"} small color={isOn ? GP.berry : GP.mint} onPress={() => void toggle()} />
        </View>
      ) : null}
      {problem ? <Text style={[styles.empty, { color: GP.berry }]}>{problem}</Text> : null}
      <ScrollView contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + 24 }]}>
        {list.map(({ id, count }) => {
          const e = entries.find((x) => x.id === id);
          if (!e) return null;
          const url = thumbUrl(e, 256);
          const on = equipped[slot] === id;
          return (
            <Pressable
              key={id}
              onPress={() => {
                setPick(id);
                setClip("idle");
              }}
              style={[styles.tile, { borderColor: id === selected ? GP.navy : rarityColor(e.rarity) }]}
              accessibilityRole="button"
              accessibilityLabel={`${e.name}${on ? ", equipped" : ""}`}>
              {url ? <Image source={{ uri: url }} style={styles.tileImg} contentFit="contain" /> : <Ionicons name="cube" size={34} color={GP.mist} />}
              <Text style={styles.tileName} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                {e.name}
              </Text>
              {on ? <Ionicons name="checkmark-circle" size={20} color={GP.mint} style={styles.tileBadge} /> : count && count > 1 ? <Text style={styles.tileCount}>×{count}</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </SheetFrame>
  );
}

// ---------- points: station and environment ----------

/** The Forge entries a point is dressed with, when the catalogue has them. */
export function usePointForge(point: unknown): { station: ForgeEntry | null; environment: ForgeEntry | null } {
  const on = useForgeOn();
  const refs = pointForge(point);
  const station = useForgeEntry(on ? refs.station?.element_id : null);
  const environment = useForgeEntry(on ? refs.environment?.element_id : null);
  return { station, environment };
}

/**
 * The point's Forge scene: its station where the shrine would stand, its
 * environment around it (a backdrop behind, or ground under), and your avatar
 * beside it. Null when the point has neither, so the caller keeps its shrine.
 */
export function ForgePointScene({ point, style, celebrate }: { point: unknown; style?: object; celebrate?: boolean }) {
  const { station, environment } = usePointForge(point);
  const { avatar } = useEquipped();
  const me = useForgeEntry(avatar);
  if (!station && !environment) return null;
  const backdrop = environment?.gameplay.placement === "backdrop";
  // Layers, each its own small 3D view with a transparent background: the
  // environment behind (or beside, as a prop), the station in the middle,
  // your avatar at its foot. One model per view is the pattern measured to
  // hold up on the emulator (see ForgeStage).
  return (
    <View style={[{ width: "100%", height: 300 }, style]} pointerEvents="none">
      {environment ? (
        <ForgeModel
          entry={environment}
          purpose="scene"
          style={backdrop ? StyleSheet.absoluteFill : { position: "absolute", right: 0, bottom: 0, width: "45%", height: "55%" }}
          size={300}
          distance={backdrop ? 1.9 : 2.2}
        />
      ) : null}
      {station ? (
        <ForgeModel entry={station} purpose="scene" style={{ position: "absolute", left: "20%", right: "20%", top: 0, bottom: 0 }} size={300} distance={1.9} />
      ) : null}
      {me ? (
        <ForgeModel
          entry={me}
          purpose="scene"
          animation={celebrate ? "celebrate" : "idle"}
          style={{ position: "absolute", left: 0, bottom: 0, width: "34%", height: "62%" }}
          size={150}
          distance={2.4}
        />
      ) : null}
    </View>
  );
}

// ---------- duels ----------

/** The 3D art for a fighter on the versus card, or null to keep the icon. */
export function ForgeFighterArt({ fighter, size = 72 }: { fighter: unknown; size?: number }) {
  const on = useForgeOn();
  const weapon = fighterWeapon(fighter);
  const character = fighterCharacter(fighter);
  const id = on ? (character?.element_id ?? weapon?.element_id ?? null) : null;
  const entry = useForgeEntry(id);
  if (!entry) return null;
  return (
    <View style={{ width: size, height: size, borderRadius: 14, overflow: "hidden", backgroundColor: "rgba(30,58,76,0.85)" }}>
      <ForgeModel entry={entry} purpose="thumb" animation={entry.type === "character" ? "idle" : null} spin={entry.type === "weapon"} style={StyleSheet.absoluteFill} size={size} distance={entry.type === "character" ? 2.5 : 2.4} />
    </View>
  );
}

/** The map pins' board projection, for WorldMap's overlay (same maths as its own pins). */
export function boardPlacer(origin: LatLng, extent: number, scale: number) {
  return (p: LatLng) => {
    const local = toLocal(origin, p);
    return { left: (local.x + extent) * scale, top: (extent - local.z) * scale };
  };
}

/** The live counter for the More tile badge. */
export function useForgeOwnedCount(): number {
  return useForgeWorld((s) => s.inventory?.owned.length ?? 0);
}

export const forgePlayerName = () => gameStore.playerName();

const styles = StyleSheet.create({
  dropPin: { position: "absolute", width: 48, height: 60, alignItems: "center", zIndex: 4 },
  dropDiamond: { width: 44, height: 44, borderRadius: 10, borderWidth: 3, backgroundColor: "rgba(255,255,255,0.95)", alignItems: "center", justifyContent: "center", elevation: 6 },
  dropShadow: { width: 18, height: 5, borderRadius: 3, opacity: 0.45, marginTop: 6 },
  claimRoot: { backgroundColor: "rgba(16,30,40,0.97)", alignItems: "center", paddingHorizontal: 20, zIndex: 50 },
  claimTop: { alignItems: "center", gap: 4 },
  kicker: { fontFamily: GF.display, fontSize: 14, letterSpacing: 1.6 },
  claimName: { fontFamily: GF.display, fontSize: 34, color: "#FFF", textAlign: "center" },
  claimStage: { width: "100%", flex: 1, maxHeight: 420, alignItems: "center", justifyContent: "center" },
  burst: { position: "absolute", width: 10, height: 10, alignItems: "center", justifyContent: "center" },
  ray: { position: "absolute", width: 18, height: 160, borderRadius: 9, opacity: 0.18 },
  statRow: { flexDirection: "row", gap: 10, marginVertical: 8 },
  stat: { alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.08)" },
  statValue: { fontFamily: GF.display, fontSize: 20, color: "#FFF" },
  statLabel: { fontFamily: GF.regular, fontSize: 11, color: "rgba(255,255,255,0.7)" },
  claimActions: { width: "100%", alignItems: "center", gap: 10 },
  claimHint: { fontFamily: GF.body, fontSize: 15, color: "rgba(255,255,255,0.9)", textAlign: "center" },
  claimClose: { fontFamily: GF.body, fontSize: 15, color: "rgba(255,255,255,0.6)", padding: 6 },
  claimAvatar: { position: "absolute", left: 8, bottom: 90 },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 18, marginTop: 4 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: "rgba(31,59,77,0.08)" },
  tabOn: { backgroundColor: GP.navy },
  tabText: { fontFamily: GF.body, fontSize: 14, color: GP.ink },
  bagStage: { height: 270, marginHorizontal: 18, marginTop: 10, borderRadius: 20, backgroundColor: GP.navy, overflow: "hidden" },
  bagName: { position: "absolute", left: 14, bottom: 10, fontFamily: GF.display, fontSize: 20, color: "#FFF" },
  bagActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 18, paddingTop: 10, justifyContent: "center" },
  centre: { alignItems: "center", justifyContent: "center", padding: 20 },
  empty: { fontFamily: GF.body, fontSize: 15, color: "rgba(255,255,255,0.85)", textAlign: "center", paddingHorizontal: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, padding: 18 },
  tile: { width: 100, height: 118, borderRadius: 16, borderWidth: 3, backgroundColor: "#FFF", alignItems: "center", justifyContent: "center", padding: 6 },
  tileImg: { width: 76, height: 76 },
  tileName: { fontFamily: GF.body, fontSize: 12, color: GP.ink },
  tileBadge: { position: "absolute", top: 4, right: 4 },
  tileCount: { position: "absolute", top: 4, right: 6, fontFamily: GF.display, fontSize: 13, color: GP.ink },
});

/** Whether the player wears a Forge avatar the catalogue can show (for the map marker). */
export function useHasForgeAvatar(): boolean {
  const on = useForgeOn();
  const { avatar } = useEquipped();
  const entry = useForgeEntry(avatar);
  return on && !!entry;
}

/** The HUD chip: your Forge avatar (or a Forge mark) and how many finds you hold; opens the bag. */
export function ForgeHudChip({ onPress }: { onPress: () => void }) {
  const on = useForgeOn();
  const count = useForgeOwnedCount();
  const { weapon } = useEquipped();
  const held = useForgeEntry(weapon);
  if (!on) return null;
  return (
    <Pressable onPress={onPress} style={chip.root} accessibilityRole="button" accessibilityLabel={`Forge bag, ${count} finds${held ? `, holding ${held.name}` : ""}`} testID="forge-hud-chip">
      <View style={chip.face}>
        <PlayerAvatar size={30} fallback={<Ionicons name="cube" size={18} color={GP.rare} />} />
      </View>
      <Text style={chip.text} maxFontSizeMultiplier={1.2}>
        {held ? held.name : "Forge"}
      </Text>
      <View style={chip.count}>
        <Text style={chip.countText} maxFontSizeMultiplier={1.2}>
          {count}
        </Text>
      </View>
    </Pressable>
  );
}

const chip = StyleSheet.create({
  root: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, paddingLeft: 3, paddingRight: 6, paddingVertical: 3, borderRadius: 20, backgroundColor: "rgba(30,58,76,0.92)" },
  face: { width: 32, height: 32, borderRadius: 16, backgroundColor: GP.cream, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  text: { fontFamily: GF.body, fontSize: 13, color: "#FFF", maxWidth: 150 },
  count: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5, backgroundColor: GP.rare, alignItems: "center", justifyContent: "center" },
  countText: { fontFamily: GF.display, fontSize: 13, color: "#FFF" },
});
