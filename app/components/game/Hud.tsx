// Over the map: the top bar (you, your coins and streak), the rail (the
// daily quests, Relics, the Codex, More), the Nearby tray with its plate and
// cards, and the Warden's speech bubble. costquest-ios Roam/RoamHomeView.swift
// (topBar, PlayerChip, ResourceChip, rail, NearbyTray, NearbyCard, CardPress)
// and Warden/WardenViews.swift (WardenBubble).
import { Ionicons } from "@expo/vector-icons";
import { type ReactNode, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, Keyframe, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";

import { distanceText } from "@/features/game/geo";
import {
  cardLabel,
  type CardTone,
  cardStatus,
  challengeLabel,
  difficultyLabel,
  hereCount,
  trayOrder,
} from "@/features/game/guide";
import type { Profile, QuestPoint, RoamMe } from "@/features/game/wire";

import { Image } from "expo-image";

import { useMyPicture } from "@/components/world/useMyPicture";

import AvatarView from "./AvatarView";
import { CoachAnchor } from "./Coach";
import { announce, GameCoin, GameIconButton, HUD_FONT_SCALE, pressFeedback, withAlpha } from "./kit";
import { edgeOf, GF, GP, realmColor, realmIcon, tierColor } from "./theme";
import WardenBadge from "./WardenBadge";
import { useWardenMuted, wardenVoice } from "./wardenVoice";
import { themedStyles, useThemedStyles } from "@/constants/chatTheme";

/** GamePalette.navy.opacity(0.78): the plate behind white type over the map. */
export const NAVY_PLATE = withAlpha(GP.navy, 0.78);
const PLATE_STROKE = "rgba(255,255,255,0.18)";

/** The spring(response r, dampingFraction z) of the Swift, as Reanimated numbers. */
function spring(response: number, damping: number) {
  const stiffness = (2 * Math.PI / response) ** 2;
  return { stiffness, damping: 2 * damping * Math.sqrt(stiffness), mass: 1 };
}

// ---------- the top bar ----------

/** Who you are, at a glance: your avatar in a ring that fills with this level's XP, your level, your rank. */
export function PlayerChip({
  me,
  profile,
  name,
  color,
  onPress,
}: {
  me: RoamMe | null;
  profile: Profile | null;
  name: string;
  color: string;
  onPress: () => void;
}) {
  const styles = useThemedStyles(STYLE_PAIR);
  const s = me?.standing;
  const progress = s ? (s.max_level ? 1 : Math.max(0, Math.min(1, s.into_level / Math.max(1, s.level_span)))) : 0;
  const handle = profile?.handle ?? me?.handle ?? name ?? "Player";
  const rank = s?.rank ?? "Rookie";
  const level = s?.level ?? 1;
  const loading = !me && !profile;
  const picture = useMyPicture();
  const R = 24.5;
  const C = 2 * Math.PI * R;
  const face = color;
  return (
    <Pressable
      style={styles.chip}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={loading ? "You" : `You, ${handle}, level ${level}, ${rank}`}
      accessibilityHint="Opens your profile">
      <View style={styles.ring}>
        <Svg width={54} height={54} style={StyleSheet.absoluteFill}>
          <Circle cx={27} cy={27} r={R} stroke="rgba(255,255,255,0.25)" strokeWidth={5} fill="none" />
          <Circle
            cx={27}
            cy={27}
            r={R}
            stroke={GP.sun}
            strokeWidth={5}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${C * progress} ${C}`}
            transform="rotate(-90 27 27)"
          />
        </Svg>
        {/* Task 059: the person's own photo / chat avatar, the same face as in the chat. */}
        {picture ? (
          <Image source={picture} style={styles.photo} contentFit="cover" accessibilityIgnoresInvertColors />
        ) : (
          <AvatarView avatar={profile?.avatar ?? { face: 1, mark: 1, tint: face }} size={40} />
        )}
        <View style={styles.level}>
          <Text style={styles.levelText} maxFontSizeMultiplier={1.2}>
            {level}
          </Text>
        </View>
      </View>
      {/* Before the server has answered, shapes rather than a made-up "Player, Rookie". */}
      {loading ? (
        <View style={{ gap: 5, paddingRight: 6 }}>
          <View style={styles.redactA} />
          <View style={styles.redactB} />
        </View>
      ) : (
        <View style={{ flexShrink: 1, paddingRight: 6 }}>
          <Text style={styles.handle} numberOfLines={1} maxFontSizeMultiplier={HUD_FONT_SCALE}>
            {handle}
          </Text>
          <Text style={styles.rank} numberOfLines={1} maxFontSizeMultiplier={HUD_FONT_SCALE}>
            {rank}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/** The top bar's resource chip: coins and the streak sit side by side on one row with the player chip. */
function ResourceChip({ children }: { children: ReactNode }) {
  const styles = useThemedStyles(STYLE_PAIR);
  return <View style={styles.resource}>{children}</View>;
}

export function TopBar({
  me,
  profile,
  name,
  color,
  onProfile,
  onCoins,
  onAskWarden,
}: {
  me: RoamMe | null;
  profile: Profile | null;
  name: string;
  color: string;
  onProfile: () => void;
  onCoins: () => void;
  /** The Warden's face beside the chip: "Ask the Warden". */
  onAskWarden?: () => void;
}) {
  const styles = useThemedStyles(STYLE_PAIR);
  const insets = useSafeAreaInsets();
  const coins = me?.coins ?? 0;
  const streak = me?.streak;
  return (
    <View style={[styles.top, { top: insets.top + 4 }]} pointerEvents="box-none">
      <PlayerChip me={me} profile={profile} name={name} color={color} onPress={onProfile} />
      {onAskWarden ? (
        <Pressable onPress={onAskWarden} accessibilityRole="button" accessibilityLabel="Ask the Warden" hitSlop={4} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.94 : 1 }] })}>
          <WardenBadge tint={color} size={40} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1, minWidth: 4 }} pointerEvents="none" />
      <View style={styles.stats}>
        <Pressable onPress={onCoins} accessibilityRole="button" accessibilityLabel={`${coins} CosCoins`} accessibilityHint="Opens your CosCoins" hitSlop={5}>
          <ResourceChip>
            <GameCoin size={18} />
            <Text style={styles.resourceText} maxFontSizeMultiplier={HUD_FONT_SCALE}>
              {coins}
            </Text>
          </ResourceChip>
        </Pressable>
        {streak && streak.days > 0 ? (
          <View accessible accessibilityLabel={`${streak.days} day streak`}>
            <ResourceChip>
              <Ionicons name="flame" size={16} color={streak.played_today ? GP.sun : "rgba(255,255,255,0.6)"} />
              <Text style={styles.resourceText} maxFontSizeMultiplier={HUD_FONT_SCALE}>
                {streak.days}
              </Text>
            </ResourceChip>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ---------- the rail ----------

/** `.transition(.move(edge: .trailing).combined(with: .opacity))` under `.smooth(0.3)`. */
const EASE = Easing.inOut(Easing.cubic);
const RAIL_IN = new Keyframe({
  from: { opacity: 0, transform: [{ translateX: 90 }] },
  to: { opacity: 1, transform: [{ translateX: 0 }], easing: EASE },
}).duration(300);
const RAIL_OUT = new Keyframe({
  from: { opacity: 1, transform: [{ translateX: 0 }] },
  to: { opacity: 0, transform: [{ translateX: 90 }], easing: EASE },
}).duration(300);

/** Where the coach finds More: it stands in for everything moved off the rail. */
const MORE_IDS = ["more", "war", "battle", "recap", "events", "friends"] as const;

/**
 * Four buttons at most, high on the right under the top bar: the daily
 * quests, the Relics, the Codex, and More for everything else. Mounted only
 * while no card is open (the card is the one thing to read). The Warden's
 * mute and "centre on me" are small extras under them.
 */
export function Rail({
  dailiesLeft,
  codexCount,
  showCodex,
  relics,
  onDailies,
  onCodex,
  onTrials,
  onMore,
  onRecentre,
}: {
  dailiesLeft: number;
  codexCount: number | null;
  showCodex: boolean;
  /** The Relics button (its own component, with its own badge), when unlocked. */
  relics?: ReactNode;
  onDailies: () => void;
  onCodex: () => void;
  /** Guardian Trials, when the server runs the duel: it takes the Codex's place (the Codex moves to More). */
  onTrials?: () => void;
  onMore: () => void;
  onRecentre: () => void;
}) {
  const styles = useThemedStyles(STYLE_PAIR);
  const insets = useSafeAreaInsets();
  const muted = useWardenMuted();
  return (
    <Animated.View entering={RAIL_IN} exiting={RAIL_OUT} style={[styles.rail, { top: insets.top + 72 }]} pointerEvents="box-none">
      <CoachAnchor ids={["dailies"]}>
        <GameIconButton icon="checkbox" color={GP.mint} diameter={50} accessibilityLabel="Daily quests" badge={dailiesLeft > 0 ? dailiesLeft : null} onPress={onDailies} />
      </CoachAnchor>
      {relics ? (
        <CoachAnchor ids={["relics"]} style={styles.relics}>
          {relics}
        </CoachAnchor>
      ) : null}
      {onTrials ? (
        <CoachAnchor ids={["trials"]}>
          <GameIconButton icon="flash" color={GP.berry} diameter={50} accessibilityLabel="Guardian Trials" onPress={onTrials} />
        </CoachAnchor>
      ) : showCodex ? (
        <CoachAnchor ids={["codex"]}>
          <GameIconButton icon="albums" color={GP.sun} diameter={50} accessibilityLabel="Codex" badge={codexCount && codexCount > 0 ? codexCount : null} onPress={onCodex} />
        </CoachAnchor>
      ) : null}
      <CoachAnchor ids={onTrials ? [...MORE_IDS, "codex"] : MORE_IDS}>
        <GameIconButton icon="grid" color={GP.skyDeep} diameter={50} accessibilityLabel="More" onPress={onMore} />
      </CoachAnchor>
      <View style={styles.extras}>
        <GameIconButton
          icon={muted ? "volume-mute" : "volume-high"}
          color={GP.slate}
          diameter={38}
          accessibilityLabel={muted ? "Warden voice off" : "Warden voice on"}
          onPress={() => wardenVoice.setMuted(!muted)}
        />
        <GameIconButton icon="locate" color={GP.navy} diameter={38} accessibilityLabel="Centre on me" onPress={onRecentre} />
      </View>
    </Animated.View>
  );
}

// ---------- the Nearby tray ----------

const CARD_WIDTH = 172;
const CARD_GAP = 12;
const PRESS = spring(0.22, 0.6);

/** Cards press in like the game's buttons: a touch you can feel (CardPress). */
function CardPress({ onPress, label, children }: { onPress: () => void; label: string; children: ReactNode }) {
  const styles = useThemedStyles(STYLE_PAIR);
  const down = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.05 * down.get() }] }));
  const shade = useAnimatedStyle(() => ({ opacity: 0.04 * down.get() }));
  return (
    <Pressable
      onPressIn={() => {
        pressFeedback();
        down.set(withSpring(1, PRESS));
      }}
      onPressOut={() => down.set(withSpring(0, PRESS))}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <Animated.View style={style}>
        {children}
        <Animated.View pointerEvents="none" style={[styles.shade, shade]} />
      </Animated.View>
    </Pressable>
  );
}

function toneColor(tone: CardTone, point: QuestPoint, holder?: string): string {
  switch (tone) {
    case "mist":
      return GP.mist;
    case "skyDeep":
      return GP.skyDeep;
    case "berry":
      return GP.berry;
    case "holder":
      return realmColor(holder);
    case "sunDeep":
      return GP.sunDeep;
    case "ink":
      return withAlpha(GP.ink, 0.7);
    case "tier":
      return edgeOf(tierColor(point.tier));
  }
}

const CHALLENGE_ICON = { sequence: "list", rebus: "happy", blitz: "flash", duel: "shield" } as const;

/** A printed card, not a glowing panel: one colour tile for the tier, a hard edge underneath, words only where they carry a fact. */
function NearbyCard({
  point,
  distance,
  bearing,
  inReach,
  cooling,
  suggested,
  newCard,
  now,
}: {
  point: QuestPoint;
  distance: number | null;
  /** Degrees clockwise from where the phone faces, or null without a heading. */
  bearing: number | null;
  inReach: boolean;
  cooling: boolean;
  suggested: boolean;
  newCard: boolean;
  now: number;
}) {
  const styles = useThemedStyles(STYLE_PAIR);
  const duel = point.challenge === "duel";
  const ready = inReach && !cooling;
  const tint = tierColor(point.tier);
  const edge = ready ? GP.mint : suggested ? GP.sunDeep : GP.slate;
  const status = cardStatus(point, { now, newCard });
  const icon = CHALLENGE_ICON[point.challenge as keyof typeof CHALLENGE_ICON] ?? "chatbubble-ellipses";
  return (
    <View
      style={[styles.cardWrap, cooling && { opacity: 0.7, filter: [{ grayscale: 1 }] }]}
      accessible
      accessibilityLabel={cardLabel(point, { inReach, distanceText: distanceText(distance), cooling, suggested })}>
      <View style={[styles.cardEdge, { backgroundColor: edge }]} />
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={[styles.tile, { backgroundColor: tint }]}>
            <Ionicons name={icon} size={17} color="#FFFFFF" />
            <View style={styles.realmBadge}>
              <Ionicons name={realmIcon(point.realm)} size={9} color={realmColor(point.realm)} />
            </View>
          </View>
          {duel ? (
            <Text style={[styles.difficulty, { color: edgeOf(tint) }]} maxFontSizeMultiplier={HUD_FONT_SCALE}>
              {difficultyLabel(point.tier).toUpperCase()}
            </Text>
          ) : null}
          <View style={{ flex: 1 }} />
          {ready ? (
            <Text style={styles.here} maxFontSizeMultiplier={HUD_FONT_SCALE}>
              HERE
            </Text>
          ) : (
            <View style={styles.distance}>
              {bearing !== null ? <Ionicons name="arrow-up" size={11} color={GP.mist} style={{ transform: [{ rotate: `${bearing}deg` }] }} /> : null}
              <Text style={styles.distanceText} maxFontSizeMultiplier={HUD_FONT_SCALE}>
                {distanceText(distance)}
              </Text>
            </View>
          )}
        </View>
        <View style={{ gap: 3 }}>
          <Text style={styles.cardName} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85} maxFontSizeMultiplier={HUD_FONT_SCALE}>
            {point.name}
          </Text>
          <Text style={styles.subline} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={HUD_FONT_SCALE}>
            <Text style={{ color: withAlpha(GP.ink, 0.5) }}>{challengeLabel(point.challenge).toUpperCase()}</Text>
            <Text style={{ color: withAlpha(GP.ink, 0.3) }}>{"  ·  "}</Text>
            <Text style={{ color: toneColor(status.tone, point, status.holder) }}>{status.fact.toUpperCase()}</Text>
          </Text>
        </View>
      </View>
      {suggested ? (
        <View style={styles.nextTab} pointerEvents="none">
          <Text style={styles.nextText} maxFontSizeMultiplier={1.2}>
            NEXT
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The nearest points, as cards you can thumb through. A map is lovely and a
 * finger on a moving phone is imprecise; this is the reliable way in.
 */
export function NearbyTray({
  points,
  suggested,
  distanceOf,
  bearingOf,
  inReach,
  cooling,
  newCard,
  onSelect,
}: {
  /** Every point, nearest first (the tray shows ten). */
  points: QuestPoint[];
  /** The Warden's best next move, marked on its card and shown first. */
  suggested: string | null;
  distanceOf: (p: QuestPoint) => number | null;
  /** Degrees clockwise from where the phone faces, or null without a heading. */
  bearingOf: (p: QuestPoint) => number | null;
  inReach: (p: QuestPoint) => boolean;
  cooling: (p: QuestPoint) => boolean;
  newCard: (p: QuestPoint) => boolean;
  onSelect: (p: QuestPoint) => void;
}) {
  const styles = useThemedStyles(STYLE_PAIR);
  // "Ready in 5 min" and "Gone in 12 min" every 30 s (TimelineView .periodic).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  const near = trayOrder(points, suggested);
  if (near.length === 0) return null;
  const here = hereCount(points, inReach, now);
  return (
    <View style={{ gap: 8 }}>
      {/* On a plate: bare white type vanished over the pale day board. */}
      <View style={styles.plate} accessible accessibilityLabel={here > 0 ? `NEARBY, ${here} in reach` : "NEARBY"}>
        <Text style={styles.plateText} maxFontSizeMultiplier={HUD_FONT_SCALE}>
          NEARBY
        </Text>
        {here > 0 ? (
          <Text style={[styles.plateText, { color: GP.mint, letterSpacing: 0, fontVariant: ["tabular-nums"] }]} maxFontSizeMultiplier={HUD_FONT_SCALE}>
            {"·  "}
            {here} in reach
          </Text>
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_WIDTH + CARD_GAP}
        snapToAlignment="start"
        decelerationRate="fast"
        contentContainerStyle={styles.trayRow}>
        {near.map((p) => {
          const reach = inReach(p);
          const cool = cooling(p);
          const next = p.id === suggested;
          const card = (
            <CardPress
              onPress={() => onSelect(p)}
              label={cardLabel(p, { inReach: reach, distanceText: distanceText(distanceOf(p)), cooling: cool, suggested: next })}>
              <NearbyCard
                point={p}
                distance={distanceOf(p)}
                bearing={bearingOf(p)}
                inReach={reach}
                cooling={cool}
                suggested={next}
                newCard={newCard(p)}
                now={now}
              />
            </CardPress>
          );
          // The Warden's first coach step lights this card.
          return p.source === "starter" ? (
            <CoachAnchor key={p.id} ids={["starter"]}>
              {card}
            </CoachAnchor>
          ) : (
            <View key={p.id}>{card}</View>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ---------- the Warden ----------

const BUBBLE_OUT = new Keyframe({ from: { opacity: 1 }, to: { opacity: 0 } }).duration(180);
const BUBBLE_IN = new Keyframe({
  from: { opacity: 0, transform: [{ scale: 0.9 }] },
  to: { opacity: 1, transform: [{ scale: 1 }], easing: Easing.out(Easing.cubic) },
}).duration(260);

/**
 * What the Warden just said, with its face. Shown, not spoken (the nudge loop
 * in GameRoot). The player can always put the Warden away: tap it, or its X.
 */
export function WardenBubble({ text, color, onClose }: { text: string; color: string; onClose: () => void }) {
  const styles = useThemedStyles(STYLE_PAIR);
  // iOS has no live regions: say it to VoiceOver as it appears.
  useEffect(() => {
    if (Platform.OS === "ios") announce(`The Warden: ${text}`);
  }, [text]);
  return (
    <Animated.View entering={BUBBLE_IN} exiting={BUBBLE_OUT}>
      <Pressable
        onPress={onClose}
        style={[styles.bubble, { borderColor: withAlpha(color, 0.7) }]}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`The Warden: ${text}`}
        accessibilityHint="Double tap to put the Warden away"
        accessibilityLiveRegion={Platform.OS === "android" ? "polite" : undefined}>
        <WardenBadge tint={color} size={36} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[styles.bubbleLabel, { color }]} maxFontSizeMultiplier={HUD_FONT_SCALE}>
            THE WARDEN
          </Text>
          <Text style={styles.bubbleText} maxFontSizeMultiplier={HUD_FONT_SCALE}>
            {text}
          </Text>
        </View>
        <Pressable onPress={onClose} hitSlop={9} style={styles.bubbleClose} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Ionicons name="close" size={13} color="rgba(255,255,255,0.7)" />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

/** A test server says so, on the map. */
export function StagingBadge({ label }: { label: string }) {
  const styles = useThemedStyles(STYLE_PAIR);
  return (
    <View pointerEvents="none" style={styles.staging}>
      <Text style={styles.stagingText}>{label}</Text>
    </View>
  );
}

const STYLE_PAIR = themedStyles({
  photo: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: "rgba(255,255,255,0.85)" },
  top: {
    position: "absolute",
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  chip: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 6,
    borderRadius: 999,
    backgroundColor: NAVY_PLATE,
    borderWidth: 1.5,
    borderColor: PLATE_STROKE,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  ring: { width: 54, height: 54, alignItems: "center", justifyContent: "center" },
  level: {
    position: "absolute",
    right: -4,
    bottom: -4,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 3,
    borderRadius: 11,
    backgroundColor: GP.skyDeep,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  levelText: { fontFamily: GF.display, fontSize: 14, color: "#FFFFFF" },
  handle: { fontFamily: GF.display, fontSize: 18, color: "#FFFFFF" },
  rank: { fontFamily: GF.body, fontSize: 13, color: "rgba(255,255,255,0.8)" },
  redactA: { width: 96, height: 16, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.22)" },
  redactB: { width: 60, height: 12, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.22)" },
  stats: { flexDirection: "row", gap: 6 },
  resource: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    height: 34,
    borderRadius: 17,
    backgroundColor: NAVY_PLATE,
    borderWidth: 1.5,
    borderColor: PLATE_STROKE,
  },
  resourceText: { fontFamily: GF.display, fontSize: 16, color: "#FFFFFF", fontVariant: ["tabular-nums"] },
  rail: { position: "absolute", right: 12, gap: 12, alignItems: "center", width: 50 },
  relics: { width: 50, height: 54, alignItems: "center", justifyContent: "center" },
  extras: { gap: 10, marginTop: 4, alignItems: "center" },
  plate: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    marginLeft: 14,
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: NAVY_PLATE,
  },
  plateText: { fontFamily: GF.display, fontSize: 13, letterSpacing: 1.4, color: "#FFFFFF" },
  trayRow: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, gap: CARD_GAP },
  cardWrap: { width: CARD_WIDTH, paddingBottom: 4 },
  cardEdge: { position: "absolute", left: 0, right: 0, top: 4, bottom: 0, borderRadius: 14 },
  card: {
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: GP.cream,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 3 },
  },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  tile: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  realmBadge: {
    position: "absolute",
    right: -4,
    bottom: -4,
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: GP.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  difficulty: { fontFamily: GF.display, fontSize: 11, letterSpacing: 0.6, paddingTop: 2 },
  here: { fontFamily: GF.display, fontSize: 15, letterSpacing: 0.6, color: GP.mint },
  distance: { flexDirection: "row", alignItems: "center", gap: 3 },
  distanceText: { fontFamily: GF.display, fontSize: 15, color: GP.mist, fontVariant: ["tabular-nums"] },
  cardName: { fontFamily: GF.display, fontSize: 17, lineHeight: 20, minHeight: 40, color: GP.ink },
  subline: { fontFamily: GF.bold, fontSize: 11, letterSpacing: 0.4 },
  nextTab: { position: "absolute", left: 12, top: -8, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, backgroundColor: GP.sun },
  nextText: { fontFamily: GF.display, fontSize: 10, letterSpacing: 1, color: GP.ink },
  shade: { ...StyleSheet.absoluteFill, borderRadius: 14, backgroundColor: "#000000" },
  bubble: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginLeft: 14,
    marginRight: 76,
    padding: 12,
    borderRadius: 20,
    borderWidth: 2,
    backgroundColor: withAlpha(GP.navy, 0.88),
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  bubbleLabel: { fontFamily: GF.display, fontSize: 12, letterSpacing: 1.2 },
  bubbleText: { fontFamily: GF.body, fontSize: 15, color: "#FFFFFF" },
  bubbleClose: { width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  staging: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: GP.berry },
  stagingText: { fontFamily: GF.bold, fontSize: 10, color: "#FFFFFF", letterSpacing: 1 },
});
