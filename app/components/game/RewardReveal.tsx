// A short reveal for a rank promotion or a weapon landing on the Ranks screen
// (about 1.5 s, features/game/rewardReveal.ts revealTimeline): the card scales
// and fades in, a glow blooms behind the badge, the badge pops in with a
// haptic tick, the name rises, one shine sweeps across, and it settles into a
// plain static card (kicker, name, detail). Reduce Motion (the app setting or
// the system one) shows that final card at once. Motion is tight and settled
// like the rest of the game (features/game/spring.ts settle), no overshoot.
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withSpring, withTiming } from "react-native-reanimated";

import { RADIUS } from "@/features/game/lookTokens";
import { type RevealCard, revealTimeline } from "@/features/game/rewardReveal";
import { settle } from "@/features/game/spring";
import { useAppSelector } from "@/store/hooks";

import { announce, GamePanel, MAX_FONT_SCALE } from "./kit";
import { useLook } from "./look";
import { RankBadge } from "./RankBadge";
import { impact } from "./prefs";
import { GF } from "./theme";

const BADGE = 52;
const GLOW = 84;
/** The faint halo the glow settles to, so the finished card still reads as a reward. */
const HALO = 0.18;
const SHINE_W = 56;

export function useRevealReduceMotion(): boolean {
  const app = useAppSelector((state) => Boolean(state.settings.appearance?.reduceMotion));
  const system = useReducedMotion();
  return app || system;
}

export function RewardReveal({
  card,
  icon,
  tint,
  delayMs = 0,
  testID,
  kickerTestID,
}: {
  card: RevealCard;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  /** Start later (a promotion that follows a weapon reveal). */
  delayMs?: number;
  /** On the whole card (prog-reveal-rank, prog-reveal-weapon). */
  testID?: string;
  /** On the kicker line, for screens that already test it (prog-promoted). */
  kickerTestID?: string;
}) {
  const look = useLook();
  const reduce = useRevealReduceMotion();
  const t = revealTimeline(reduce);

  const card0 = useSharedValue(reduce ? 1 : 0);
  const pop = useSharedValue(reduce ? 1 : 0);
  const rise = useSharedValue(reduce ? 1 : 0);
  const glow = useSharedValue(reduce ? HALO : 0);
  const shine = useSharedValue(reduce ? 1 : 0);
  const width = useSharedValue(0);

  useEffect(() => {
    if (reduce) {
      card0.value = 1;
      pop.value = 1;
      rise.value = 1;
      glow.value = HALO;
      shine.value = 1;
      announce(card.announce);
      impact(Haptics.ImpactFeedbackStyle.Medium);
      return;
    }
    card0.value = withDelay(delayMs, withTiming(1, { duration: t.cardMs, easing: Easing.out(Easing.cubic) }));
    glow.value = withDelay(
      delayMs + t.glowAt,
      withSequence(withTiming(0.6, { duration: t.glowMs * 0.3, easing: Easing.out(Easing.quad) }), withTiming(HALO, { duration: t.glowMs * 0.7, easing: Easing.inOut(Easing.quad) })),
    );
    pop.value = withDelay(delayMs + t.popAt, withSpring(1, settle(0.4)));
    rise.value = withDelay(delayMs + t.titleAt, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    shine.value = withDelay(delayMs + t.shineAt, withTiming(1, { duration: t.shineMs, easing: Easing.inOut(Easing.quad) }));
    const tick = setTimeout(() => {
      impact(Haptics.ImpactFeedbackStyle.Medium);
      announce(card.announce);
    }, delayMs + t.popAt);
    return () => clearTimeout(tick);
    // One reveal per card: a new title is a new reveal (the parent keys it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  const cardStyle = useAnimatedStyle(() => ({ opacity: card0.value, transform: [{ scale: 0.92 + 0.08 * card0.value }] }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value, transform: [{ scale: 0.7 + 0.5 * Math.min(1, glow.value / 0.6) }] }));
  const badgeStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, pop.value * 2), transform: [{ scale: 0.3 + 0.7 * pop.value }] }));
  const titleStyle = useAnimatedStyle(() => ({ opacity: rise.value, transform: [{ translateY: 8 * (1 - rise.value) }] }));
  const shineStyle = useAnimatedStyle(() => {
    const s = shine.value;
    // Gone before and after its one pass.
    const visible = s > 0 && s < 1;
    return { opacity: visible ? 1 : 0, transform: [{ translateX: -SHINE_W * 2 + (width.value + SHINE_W * 3) * s }, { rotate: "18deg" }] };
  });

  return (
    <Animated.View style={cardStyle} testID={testID}>
      <GamePanel>
        <View style={[StyleSheet.absoluteFill, styles.clip]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden onLayout={(e) => (width.value = e.nativeEvent.layout.width)}>
          <Animated.View style={[styles.shine, { backgroundColor: look.dark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.55)" }, shineStyle]} />
        </View>
        <View style={styles.row}>
          <View style={styles.badgeSlot}>
            <Animated.View style={[styles.glow, { backgroundColor: tint }, glowStyle]} pointerEvents="none" />
            {card.rank ? (
              <Animated.View style={badgeStyle}>
                <RankBadge rank={card.rank} size={BADGE} />
              </Animated.View>
            ) : (
              <Animated.View style={[styles.badge, { backgroundColor: tint }, badgeStyle]}>
                <Ionicons name={icon} size={26} color="#FFFFFF" />
              </Animated.View>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text testID={kickerTestID} style={[txt.kicker, { color: look.textMuted }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {card.kicker}
            </Text>
            <Animated.View style={titleStyle}>
              <Text style={[txt.h2, { color: look.text }]} maxFontSizeMultiplier={MAX_FONT_SCALE} testID={testID ? `${testID}-title` : undefined}>
                {card.title}
              </Text>
              {card.detail ? (
                <Text style={[txt.small, { color: look.textMuted }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {card.detail}
                </Text>
              ) : null}
            </Animated.View>
          </View>
        </View>
      </GamePanel>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { borderRadius: RADIUS.card, overflow: "hidden" },
  shine: { position: "absolute", top: -40, bottom: -40, left: 0, width: SHINE_W },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  badgeSlot: { width: BADGE, height: BADGE, alignItems: "center", justifyContent: "center" },
  glow: { position: "absolute", width: GLOW, height: GLOW, borderRadius: GLOW / 2 },
  badge: { width: BADGE, height: BADGE, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});

// ProgressionSheet's type (txt there), so the settled card matches the panels around it.
const txt = {
  h2: { fontFamily: GF.display, fontSize: 21, lineHeight: 26 },
  small: { fontFamily: GF.regular, fontSize: 13, lineHeight: 18 },
  kicker: { fontFamily: GF.body, fontSize: 12, lineHeight: 16, letterSpacing: 0.4 },
} as const;
