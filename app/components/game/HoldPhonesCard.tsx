// "Hold phones together", the big card at the top of Friends on iOS
// (costquest-ios Features/FriendsFeature.swift HoldPhonesCard). Both phones
// open Friends; each lists the other, and where the radio can measure, the
// claim fires on its own once the phones touch. The model is
// features/game/friendsNearby.ts; the radios are FriendBeaconIsland.swift.
// Not shown where there is no beacon (Android, web).
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, ZoomIn, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

import { addLabel, nearbyDistanceText, type NearbyPeer, peersOf, searchingLine, tooFar } from "@/features/game/friendsNearby";
import { nearbyFriends, useNearbyFriends } from "@/features/game/friendsNearbyDevice";
import { useGame } from "@/features/game/runtime";

import { GameButton, GamePanel, MAX_FONT_SCALE, withAlpha } from "./kit";
import { notify } from "./prefs";
import { playSound } from "./sound";
import { GF, GP } from "./theme";

export function HoldPhonesCard() {
  const model = nearbyFriends;
  const s = useNearbyFriends();
  const { fix } = useGame();
  const reduce = useReducedMotion();

  // The radios run exactly as long as the card is on screen.
  useEffect(() => {
    if (!model) return;
    void model.start();
    return () => model.stop();
  }, [model]);

  // A new friend: the fanfare and the success haptic (NearbyFriendModel.celebrate).
  const seen = useRef(s.celebrations);
  useEffect(() => {
    if (s.celebrations > seen.current) {
      notify(Haptics.NotificationFeedbackType.Success);
      playSound("fanfare");
    }
    seen.current = s.celebrations;
  }, [s.celebrations]);

  // The icon pulses while it looks (.symbolEffect(.pulse)).
  const pulse = useSharedValue(1);
  const searching = s.running && s.claiming === null && !reduce;
  useEffect(() => {
    pulse.set(searching ? withRepeat(withTiming(0.35, { duration: 700 }), -1, true) : withTiming(1, { duration: 200 }));
  }, [searching, pulse]);
  const iconStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }));

  // A distance goes stale after 3 s with no new fix: look again every second.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!s.running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [s.running]);

  if (!model) return null;
  const peers = peersOf(s, now);

  return (
    <GamePanel face={withAlpha(GP.sun, 0.97)}>
      <View style={styles.stack}>
        <View style={styles.head}>
          <Animated.View style={iconStyle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Ionicons name="phone-portrait" size={34} color={GP.berry} />
          </Animated.View>
          <View style={styles.headText}>
            <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
              Add a friend
            </Text>
            <Text style={styles.sub} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              Open this on both phones and hold them close.
            </Text>
          </View>
        </View>

        {s.success ? (
          <Animated.View entering={reduce ? FadeIn : ZoomIn.springify()} style={styles.row} accessible accessibilityLabel={s.success}>
            <Ionicons name="sparkles" size={26} color={GP.berry} />
            <Text style={styles.success} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {s.success}
            </Text>
          </Animated.View>
        ) : null}

        {s.denied ? (
          <View style={styles.stackTight}>
            <Text style={styles.line} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              CosQuest needs Local Network access to find the other phone.
            </Text>
            <GameButton title="Open Settings" size="small" color={GP.skyDeep} onPress={() => void Linking.openSettings()} style={styles.start} />
          </View>
        ) : !fix ? (
          <View style={styles.row}>
            <ActivityIndicator color={GP.ink} />
            <Text style={styles.line} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              Waiting for your location
            </Text>
          </View>
        ) : (
          <>
            {peers.length === 0 ? (
              <View style={styles.row}>
                <ActivityIndicator color={GP.ink} />
                <Text style={styles.line} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {searchingLine(s)}
                </Text>
              </View>
            ) : null}
            {peers.map((p) => (
              <PeerRow key={p.key} p={p} claiming={s.claiming} onAdd={() => model.claim(p.key)} />
            ))}
          </>
        )}

        {s.status ? (
          <Text style={styles.status} accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {s.status}
          </Text>
        ) : null}
      </View>
    </GamePanel>
  );
}

function PeerRow({ p, claiming, onAdd }: { p: NearbyPeer; claiming: string | null; onAdd: () => void }) {
  const far = tooFar(p);
  return (
    <View style={styles.peer}>
      <View style={[styles.dot, { backgroundColor: p.linked ? GP.mint : withAlpha(GP.ink, 0.25) }]} accessibilityElementsHidden importantForAccessibility="no" />
      <View style={styles.peerText}>
        <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {p.handle}
        </Text>
        {p.distance !== null ? (
          <Text style={styles.distance} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {nearbyDistanceText(p.distance)}
          </Text>
        ) : null}
      </View>
      {claiming === p.key ? (
        <ActivityIndicator color={GP.ink} accessibilityLabel={`Adding ${p.handle}`} />
      ) : (
        <GameButton title={addLabel(p)} size="small" color={GP.mint} onPress={onAdd} disabled={far || claiming !== null} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  stackTight: { gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  headText: { flex: 1, gap: 4 },
  title: { fontFamily: GF.display, fontSize: 24, color: GP.ink },
  sub: { fontFamily: GF.body, fontSize: 15, color: withAlpha(GP.ink, 0.8) },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  line: { fontFamily: GF.body, fontSize: 15, color: GP.ink, flexShrink: 1 },
  success: { fontFamily: GF.display, fontSize: 22, color: GP.ink, flexShrink: 1 },
  status: { fontFamily: GF.body, fontSize: 14, color: withAlpha(GP.ink, 0.75) },
  start: { alignSelf: "flex-start" },
  peer: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  peerText: { flex: 1, gap: 2 },
  name: { fontFamily: GF.bold, fontSize: 17, color: GP.ink },
  distance: { fontFamily: GF.body, fontSize: 13, color: withAlpha(GP.ink, 0.65), fontVariant: ["tabular-nums"] },
});
