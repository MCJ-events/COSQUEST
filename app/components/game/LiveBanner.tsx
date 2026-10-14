// The live banner on the map, under the player chip: Quest Hour (or Landmark
// Day) on now with its countdown, or the next one if it starts within a day.
// Tapping it opens the events calendar. It wakes exactly when what it says
// could change, so it flips on the minute by the phone's clock without a
// refetch; the calendar itself is fetched every 5 minutes.
// costquest-ios Features/LiveFeature.swift (LiveBanner, LiveCard).
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { bannerAt, type LiveCalendar, type LiveClock, nextChange, phoneClock, soonText, times } from "@/features/game/live";
import { liveCalendar, livePlace, useLiveCalendar } from "@/features/game/liveRuntime";
import { useGame } from "@/features/game/runtime";

import { GF, GP } from "./theme";

/** The phone's clock (its zone is read per instant, so a zone change still shows). */
export const LIVE_CLOCK: LiveClock = phoneClock();

/** How often to look for a fix or a stale calendar (iOS waits 5 s for a fix). */
const POLL_MS = 15000;

/** `#rrggbb` at an opacity. */
export function withAlpha(hex: string, alpha: number): string {
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}

/** The phone's time, re-read whenever the calendar could say something new. */
export function useLiveNow(calendar: LiveCalendar | null, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!calendar || !active) return;
    const t0 = Date.now();
    // A calendar that just arrived, or a page that was parked: catch up first.
    const at = t0 - now > 1000 ? t0 : nextChange(calendar, t0, LIVE_CLOCK);
    // Land just past the boundary; never sleep longer than a minute (a clock
    // the user moves by hand is noticed within it).
    const delay = at === null ? 60000 : Math.min(60000, Math.max(0, at - t0 + 50));
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [calendar, now, active]);
  return now;
}

/** Fetch the calendar once there is a place, and again when it is 5 minutes old. */
function useCalendarPolling(active: boolean) {
  const { fix, centre } = useGame();
  const hasPlace = fix !== null || centre !== null;
  useEffect(() => {
    if (!active || !hasPlace) return;
    const tick = () => {
      const here = livePlace();
      if (here) void liveCalendar.refreshIfStale(here.lat, here.lng);
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, [active, hasPlace]);
}

/**
 * The map banner. Draws nothing until there is something on (or soon).
 * `parked`: the game page is off screen; nothing polls or ticks.
 */
export default function LiveBanner({ parked, onOpen }: { parked: boolean; onOpen: () => void }) {
  const { calendar } = useLiveCalendar();
  useCalendarPolling(!parked);
  const now = useLiveNow(calendar, !parked);
  const banner = bannerAt(calendar, now);
  if (!banner) return null;
  const open = () => {
    Haptics.selectionAsync().catch(() => {});
    onOpen();
  };
  const isLive = banner.kind === "live";
  const detail = isLive ? `On now · ${banner.left}` : soonText(banner.start, now, LIVE_CLOCK);
  const mult = times(banner.event.multiplier);
  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)}>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`${banner.event.title}, ${mult} XP, ${isLive ? banner.left : detail}`}
        accessibilityHint="Opens the events calendar">
        {({ pressed }) => <LiveCard title={banner.event.title} detail={detail} multiplier={mult} isLive={isLive} pressed={pressed} />}
      </Pressable>
    </Animated.View>
  );
}

/** One flat card for "on now" and "starting soon", drawn like the nearby
 * cards: a hard edge, a sun tile, the name, and when (no pulse, no glow). */
function LiveCard({ title, detail, multiplier, isLive, pressed }: { title: string; detail: string; multiplier: string; isLive: boolean; pressed: boolean }) {
  return (
    <View style={[styles.edge, { paddingBottom: pressed ? 1 : 3, marginTop: pressed ? 2 : 0 }]}>
      <View style={[styles.card, { borderColor: isLive ? GP.sun : withAlpha(GP.navy, 0.18) }]}>
        <View style={[styles.tile, { backgroundColor: isLive ? GP.sun : withAlpha(GP.sun, 0.22) }]}>
          <Ionicons name={isLive ? "flash" : "time"} size={20} color={isLive ? "#FFF" : GP.sunDeep} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            {title.toUpperCase()}
          </Text>
          <Text style={styles.detail} numberOfLines={1}>
            {detail}
          </Text>
        </View>
        <Text style={styles.mult}>{multiplier} XP</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  edge: { borderRadius: 16, backgroundColor: "rgba(0,0,0,0.18)" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 2,
    backgroundColor: GP.cream,
  },
  tile: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 1 },
  title: { fontFamily: GF.display, fontSize: 16, letterSpacing: 0.6, color: GP.ink },
  detail: { fontFamily: GF.body, fontSize: 13, color: GP.mist },
  mult: {
    fontFamily: GF.display,
    fontSize: 15,
    color: GP.sunDeep,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: withAlpha(GP.sun, 0.2),
  },
});
