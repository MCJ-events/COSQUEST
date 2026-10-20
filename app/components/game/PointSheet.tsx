// A Quest Point, tapped: one card, floating above the bottom, with what is
// going on at the place (a wandering challenge, who holds it, a Guardian on
// it, a boss) and the one button that fits where the player stands. The
// server decides (its refusal is shown in its words). costquest-ios
// Roam/RoamHomeView.swift PointCard.
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { Easing, Keyframe } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { distanceText } from "@/features/game/geo";
import { challengeLabel, difficultyLabel, pointSubtitle, rechargeText, realmLine, tierName } from "@/features/game/guide";
import { isRaidPoint, RAID_COLOR } from "@/features/game/raids";
import { useGame } from "@/features/game/runtime";
import { siegeOf } from "@/features/game/siege";
import { type QuestPoint, spinReady } from "@/features/game/wire";

import { Chip, GameButton, GameIconButton, GamePanel, MAX_FONT_SCALE, withAlpha } from "./kit";
import { HoldLine, SiegeLine, SpawnLine } from "./PointLines";
import RaidLine from "./RaidLine";
import { RaidCrown } from "./RaidParts";
import { GF, GP, realmColor, realmIcon, tierColor } from "./theme";

/** `.move(edge: .bottom).combined(with: .opacity)` under `.smooth(duration: 0.3)`. */
const EASE = Easing.inOut(Easing.cubic);
const CARD_IN = new Keyframe({
  from: { opacity: 0, transform: [{ translateY: 90 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }], easing: EASE },
}).duration(300);
const CARD_OUT = new Keyframe({
  from: { opacity: 1, transform: [{ translateY: 0 }] },
  to: { opacity: 0, transform: [{ translateY: 90 }], easing: EASE },
}).duration(300);

/** Color(white: 0.6): the face of a button that cannot be pressed yet. */
const WAIT_FACE = "#999999";

export default function PointSheet({
  point,
  distance,
  inReach,
  cooling,
  factionName,
  legend,
  onPlay,
  onSpin,
  onShare,
  onClose,
}: {
  point: QuestPoint;
  distance: number | null;
  inReach: boolean;
  cooling: boolean;
  /** Kept for callers written before the card read the point itself. */
  asDuel?: boolean;
  factionName: (id: string) => string;
  /** The Warden's line about the place, once written. */
  legend?: string | null;
  onPlay: () => void;
  /** Spin the point for items (in reach, not resting). */
  onSpin?: () => void;
  onShare: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { me } = useGame();
  const [now, setNow] = useState(() => Date.now());
  // The spin's rest ends on its own: tick while it runs.
  const resting = !spinReady(point, now);
  useEffect(() => {
    if (!cooling && !resting) return;
    const t = setInterval(() => setNow(Date.now()), resting ? 5000 : 15000);
    return () => clearInterval(t);
  }, [cooling, resting]);

  const duel = point.challenge === "duel";
  const boss = isRaidPoint(point);
  const siege = siegeOf(point, me, factionName);
  const tint = tierColor(point.tier);

  return (
    <Animated.View
      entering={CARD_IN}
      exiting={CARD_OUT}
      style={[styles.wrap, { bottom: insets.bottom + 14 }]}>
      <GamePanel>
        <View style={{ gap: 12 }}>
          <View style={styles.head}>
            <View style={{ flex: 1, gap: 6 }}>
              <View style={styles.chips}>
                <Chip text={duel ? difficultyLabel(point.tier) : tierName(point.tier)} color={tint} />
                <Chip text={challengeLabel(point.challenge)} color={GP.skyDeep} />
              </View>
              <Text style={styles.name} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {point.name}
              </Text>
              <Text style={styles.subtitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {pointSubtitle(point)}
              </Text>
            </View>
            <GameIconButton icon="chatbubbles" color={GP.skyDeep} diameter={36} onPress={onShare} accessibilityLabel={`Invite a chat to ${point.name}`} />
            <GameIconButton icon="close" color="#7D949E" diameter={36} onPress={onClose} accessibilityLabel="Close" />
          </View>

          <SpawnLine point={point} />
          <HoldLine point={point} me={me} factionName={factionName} />
          <SiegeLine point={point} me={me} factionName={factionName} />
          <RaidLine point={point} />
          {legend ? <Text style={styles.legend}>{legend}</Text> : null}

          <View style={styles.realm} accessible accessibilityLabel={realmLine(point, factionName)}>
            <Ionicons name={realmIcon(point.realm)} size={16} color={realmColor(point.realm)} />
            <Text style={[styles.realmText, { color: realmColor(point.realm) }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {realmLine(point, factionName)}
            </Text>
          </View>

          {cooling ? (
            <GameButton title={rechargeText(point, now)} color={WAIT_FACE} disabled onPress={() => {}} icon={<Ionicons name="hourglass" size={22} color="#FFFFFF" />} />
          ) : inReach ? (
            <View style={styles.buttons}>
              {onSpin ? (
                <GameButton
                  title={spinReady(point, now) ? "Spin" : "Resting"}
                  color={GP.sky}
                  disabled={!spinReady(point, now)}
                  onPress={onSpin}
                  style={{ flex: 1 }}
                  icon={<Ionicons name="sync" size={22} color="#FFFFFF" />}
                />
              ) : null}
              <View style={{ flex: 1 }}>
              {siege ? (
              // A rival holds it: one answer won't take it, its Guardian has to be beaten.
              <GameButton title="Siege" color={realmColor(siege.faction)} onPress={onPlay} icon={<Ionicons name="flag" size={22} color="#FFFFFF" />} />
            ) : boss ? (
              <GameButton title="Fight the boss" color={RAID_COLOR} onPress={onPlay} icon={<RaidCrown size={22} />} />
            ) : duel ? (
              <GameButton title="Fight" color={GP.mint} onPress={onPlay} icon={<Ionicons name="flash" size={22} color="#FFFFFF" />} />
            ) : (
              <GameButton title="Play" color={GP.mint} onPress={onPlay} icon={<Ionicons name="play" size={22} color="#FFFFFF" />} />
            )}
              </View>
            </View>
          ) : (
            <GameButton
              title={`${distanceText(distance)} away · walk closer`}
              color={WAIT_FACE}
              disabled
              onPress={() => {}}
              icon={<Ionicons name="walk" size={22} color="#FFFFFF" />}
            />
          )}
        </View>
      </GamePanel>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 14, right: 14 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  chips: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  name: { fontFamily: GF.display, fontSize: 26, color: GP.ink },
  subtitle: { fontFamily: GF.regular, fontSize: 15, color: withAlpha(GP.ink, 0.7) },
  legend: { fontFamily: GF.regular, fontSize: 15, fontStyle: "italic", color: withAlpha(GP.ink, 0.75) },
  realm: { flexDirection: "row", alignItems: "center", gap: 8 },
  buttons: { flexDirection: "row", gap: 10 },
  realmText: { flexShrink: 1, fontFamily: GF.body, fontSize: 14 },
});
