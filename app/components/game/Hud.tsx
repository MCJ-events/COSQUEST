// Over the map: the player chip (level, rank, XP), coins and streak, the rail
// (journal: codex and dailies; the Warden's mute; recentre), the nearby tray
// and the Warden's speech bubble. costquest-ios Roam/RoamHomeView.swift.
import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { distanceText } from "@/features/game/geo";
import type { QuestPoint, RoamMe } from "@/features/game/wire";

import { ProgressBar } from "./kit";
import { challengeName, GF, GP, realmColor, realmIcon, tierColor } from "./theme";
import { type Said, useWardenMuted, wardenVoice } from "./wardenVoice";

export function PlayerChip({ me, name, color, onPress }: { me: RoamMe | null; name: string; color: string; onPress: () => void }) {
  const insets = useSafeAreaInsets();
  const s = me?.standing;
  return (
    <View style={[styles.top, { top: insets.top + 8 }]} pointerEvents="box-none">
      <Pressable style={styles.chip} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${name}, level ${s?.level ?? 1} ${s?.rank ?? ""}. Open your journal.`}>
        <View style={[styles.avatar, { backgroundColor: color }]}>
          <Text style={styles.avatarText}>{(name || "?").slice(0, 1).toUpperCase()}</Text>
          <View style={styles.level}>
            <Text style={styles.levelText}>{s?.level ?? 1}</Text>
          </View>
        </View>
        <View style={{ minWidth: 104, gap: 3 }}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.rank} numberOfLines={1}>
            {s ? `${s.rank} · ${me?.faction_name ?? "No faction"}` : "Entering the world…"}
          </Text>
          <ProgressBar value={s ? s.into_level / Math.max(1, s.level_span) : 0} color={GP.sun} height={6} />
        </View>
      </Pressable>
      <View style={styles.stats}>
        <View style={styles.pill} accessibilityLabel={`${me?.coins ?? 0} coins`}>
          <View style={styles.coin} />
          <Text style={styles.pillText}>{me?.coins ?? 0}</Text>
        </View>
        {me && me.streak.days > 0 ? (
          <View style={styles.pill} accessibilityLabel={`${me.streak.days} day streak`}>
            <Ionicons name="flame" size={15} color={me.streak.played_today ? GP.sun : GP.slate} />
            <Text style={styles.pillText}>{me.streak.days}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function Rail({
  onJournal,
  onMore,
  onRecentre,
  dailiesLeft,
  children,
}: {
  onJournal: () => void;
  onMore: () => void;
  onRecentre: () => void;
  dailiesLeft: number;
  /** Feature buttons that live on the rail (Relics), between the journal and More. */
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const muted = useWardenMuted();
  return (
    <View style={[styles.rail, { top: insets.top + 84 }]}>
      <RailButton icon="book" label="Journal: codex and dailies" onPress={onJournal} badge={dailiesLeft > 0 ? String(dailiesLeft) : null} />
      {children}
      <RailButton icon="grid" label="More" onPress={onMore} />
      <RailButton icon={muted ? "volume-mute" : "volume-high"} label={muted ? "Warden voice off" : "Warden voice on"} onPress={() => wardenVoice.setMuted(!muted)} />
      <RailButton icon="locate" label="Centre on me" onPress={onRecentre} />
    </View>
  );
}

function RailButton({ icon, label, onPress, badge }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; badge?: string | null }) {
  return (
    <Pressable style={styles.railButton} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      <Ionicons name={icon} size={22} color={GP.navy} />
      {badge ? (
        <View style={styles.railBadge}>
          <Text style={styles.railBadgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function NearbyTray({
  points,
  distanceOf,
  inReach,
  cooling,
  onSelect,
}: {
  points: QuestPoint[];
  distanceOf: (p: QuestPoint) => number | null;
  inReach: (p: QuestPoint) => boolean;
  cooling: (p: QuestPoint) => boolean;
  onSelect: (p: QuestPoint) => void;
}) {
  const insets = useSafeAreaInsets();
  if (!points.length) return null;
  return (
    <View style={[styles.tray, { bottom: insets.bottom + 12 }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trayRow}>
        {points.slice(0, 8).map((p) => {
          const reach = inReach(p);
          const cool = cooling(p);
          return (
            <Pressable
              key={p.id}
              style={[styles.card, reach && !cool && { borderColor: tierColor(p.tier), borderWidth: 3 }]}
              onPress={() => onSelect(p)}
              accessibilityRole="button"
              accessibilityLabel={`${p.name}, ${distanceText(distanceOf(p))}${reach ? ", in reach" : ""}${cool ? ", recharging" : ""}`}>
              <View style={[styles.cardIcon, { backgroundColor: cool ? "#9AA7B0" : realmColor(p.realm) }]}>
                <Ionicons name={p.challenge === "duel" ? "shield" : realmIcon(p.realm)} size={16} color="#FFF" />
              </View>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={[styles.cardMeta, reach && !cool && { color: GP.mint }]} numberOfLines={1}>
                  {cool ? "Recharging" : reach ? "In reach · tap to play" : `${distanceText(distanceOf(p))} · ${challengeName(p.challenge)}`}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function WardenBubble({ said, color }: { said: Said | null; color: string }) {
  const insets = useSafeAreaInsets();
  if (!said) return null;
  return (
    <Animated.View
      key={said.id}
      entering={FadeInDown.duration(220)}
      exiting={FadeOutDown.duration(160)}
      style={[styles.bubbleWrap, { bottom: insets.bottom + 96 }]}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`The Warden says: ${said.text}`}>
      <View style={[styles.wardenBadge, { backgroundColor: color }]}>
        <Ionicons name="eye" size={18} color="#FFF" />
      </View>
      <Pressable style={styles.bubble} onPress={() => wardenVoice.quiet()} accessibilityRole="button">
        <Text style={styles.bubbleText}>{said.text}</Text>
        {said.fromModel ? <Text style={styles.bubbleMeta}>written on this phone</Text> : null}
      </Pressable>
    </Animated.View>
  );
}

export function StagingBadge({ label }: { label: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="none" style={[styles.staging, { top: insets.top + 74 }]}>
      <Text style={styles.stagingText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  top: {
    position: "absolute",
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 6,
    paddingRight: 14,
    paddingVertical: 6,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.95)",
    elevation: 5,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFF",
  },
  avatarText: { fontFamily: GF.display, fontSize: 20, color: "#FFF" },
  level: {
    position: "absolute",
    right: -6,
    bottom: -4,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: GP.navy,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFF",
  },
  levelText: { fontFamily: GF.display, fontSize: 10, color: "#FFF" },
  name: { fontFamily: GF.display, fontSize: 15, color: GP.ink, maxWidth: 150 },
  rank: { fontFamily: GF.body, fontSize: 11, color: GP.mist, maxWidth: 150 },
  stats: { flexDirection: "row", gap: 6 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.95)",
    elevation: 4,
  },
  coin: { width: 15, height: 15, borderRadius: 8, backgroundColor: GP.sun, borderWidth: 2, borderColor: GP.sunDeep },
  pillText: { fontFamily: GF.display, fontSize: 14, color: GP.ink },
  rail: { position: "absolute", right: 12, gap: 10 },
  railButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "rgba(255,255,255,0.95)",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  railBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: GP.berry,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  railBadgeText: { fontFamily: GF.bold, fontSize: 10, color: "#FFF" },
  tray: { position: "absolute", left: 0, right: 0 },
  trayRow: { paddingHorizontal: 12, gap: 8 },
  card: {
    width: 210,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 18,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "rgba(30,58,76,0.12)",
    elevation: 4,
  },
  cardIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  cardName: { fontFamily: GF.display, fontSize: 14, color: GP.ink },
  cardMeta: { fontFamily: GF.body, fontSize: 12, color: GP.mist },
  bubbleWrap: { position: "absolute", left: 76, right: 14, flexDirection: "row", alignItems: "flex-end", gap: 8 },
  wardenBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#FFF",
    elevation: 5,
  },
  bubble: {
    flexShrink: 1,
    padding: 12,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    backgroundColor: GP.navy,
    elevation: 5,
  },
  bubbleText: { fontFamily: GF.body, fontSize: 15, color: "#FFF", lineHeight: 20 },
  bubbleMeta: { fontFamily: GF.regular, fontSize: 10, color: "rgba(255,255,255,0.6)", marginTop: 4 },
  staging: {
    position: "absolute",
    left: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: GP.berry,
  },
  stagingText: { fontFamily: GF.bold, fontSize: 10, color: "#FFF", letterSpacing: 1 },
});
