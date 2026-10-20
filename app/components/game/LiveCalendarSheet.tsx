// The events calendar: what is on now, and every Quest Hour and Landmark Day
// in the next 30 days, in the phone's time. The server computes the calendar
// for where the player stands and pays the bonus on the answer itself.
// costquest-ios Features/LiveFeature.swift (LiveCalendarSheet).
import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { liveAt, type LiveEvent, times, upcomingAfter, whenText } from "@/features/game/live";
import { liveCalendar, livePlace, useLiveCalendar } from "@/features/game/liveRuntime";
import { useGame } from "@/features/game/runtime";

import { GameBackdrop } from "./GameBackdrop";
import { Chip, GameButton, GamePanel, MAX_FONT_SCALE } from "./kit";
import { LIVE_CLOCK, useLiveNow, withAlpha } from "./LiveBanner";
import { SheetHeader } from "./SheetHeader";
import { GF, GP } from "./theme";

function reload() {
  const here = livePlace();
  if (here) void liveCalendar.load(here.lat, here.lng);
}

export default function LiveCalendarSheet({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { calendar, error } = useLiveCalendar();
  const { fix, centre } = useGame();
  const hasPlace = fix !== null || centre !== null;
  const now = useLiveNow(calendar);

  // Fresh on open, as iOS does (.task { load }).
  useEffect(() => {
    if (hasPlace) reload();
  }, [hasPlace]);

  const live = calendar ? liveAt(calendar, now) : null;
  const next = calendar ? upcomingAfter(calendar, now) : [];

  return (
    <Animated.View entering={SlideInDown.springify().damping(20)} exiting={SlideOutDown.duration(180)} style={[styles.sheet, { top: insets.top + 40 }]}>
      <GameBackdrop />
      <View style={styles.head}>
        <SheetHeader title="Events" onClose={onClose} closeLabel="Close" />
      </View>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        {calendar ? (
          <>
            {live ? (
              <GamePanel face={GP.sun} padding={14}>
                <EventRow event={live} badge="Live now" color={GP.berry} />
              </GamePanel>
            ) : null}
            {!live && !next.length ? <Text style={styles.note}>Nothing on the calendar for the next 30 days. Check back soon.</Text> : null}
            {next.map((e) => (
              <GamePanel key={`${e.key}@${e.starts_at}`} padding={14}>
                <EventRow event={e} badge={`${times(e.multiplier)} XP`} color={colorFor(e)} />
              </GamePanel>
            ))}
            <Text style={styles.note}>
              Every Wednesday evening is Quest Hour (2× XP). The first Saturday afternoon of each month is Landmark Day (3× XP). Times are local.
            </Text>
          </>
        ) : error ? (
          <View style={{ gap: 10 }}>
            <Text style={styles.note}>{`Couldn't load events. ${error}`}</Text>
            <GameButton title="Try again" size="medium" color={GP.sky} onPress={reload} />
          </View>
        ) : !hasPlace ? (
          <Text style={styles.note}>Waiting for your location: events run on local time.</Text>
        ) : (
          <ActivityIndicator color="#FFF" style={{ marginTop: 40 }} />
        )}
      </ScrollView>
    </Animated.View>
  );
}

function colorFor(e: LiveEvent): string {
  return e.key === "landmark_day" ? GP.berry : GP.skyDeep;
}

function EventRow({ event, badge, color }: { event: LiveEvent; badge: string; color: string }) {
  const when = whenText(event, LIVE_CLOCK);
  return (
    <View style={styles.row} accessible accessibilityLabel={`${event.title}, ${when}, ${badge}`}>
      <View style={[styles.icon, { backgroundColor: color }]}>
        <Ionicons name={event.key === "landmark_day" ? "business" : "flash"} size={22} color="#FFF" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {event.title}
        </Text>
        <Text style={styles.rowWhen} maxFontSizeMultiplier={MAX_FONT_SCALE}>{when}</Text>
      </View>
      <Chip text={badge} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: GP.ice, overflow: "hidden", elevation: 18 },
  head: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10 },
  body: { paddingHorizontal: 18, gap: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontFamily: GF.display, fontSize: 21, color: GP.ink },
  rowWhen: { fontFamily: GF.body, fontSize: 14, color: withAlpha(GP.ink, 0.7) },
  // White on the light backdrop, as on iOS; a soft shadow keeps it legible.
  note: {
    fontFamily: GF.bold,
    fontSize: 14,
    color: "rgba(255,255,255,0.95)",
    paddingHorizontal: 4,
    textShadowColor: "rgba(30,58,76,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
