// The events calendar: what is on now, and every Quest Hour and Landmark Day
// in the next 30 days, in the phone's time. The server computes the calendar
// for where the player stands and pays the bonus on the answer itself.
// costquest-ios Features/LiveFeature.swift (LiveCalendarSheet).
import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { liveAt, type LiveEvent, times, upcomingAfter, whenText } from "@/features/game/live";
import { liveCalendar, livePlace, useLiveCalendar } from "@/features/game/liveRuntime";
import { useGame } from "@/features/game/runtime";

import { Chip, GameButton } from "./kit";
import { LIVE_CLOCK, useLiveNow, withAlpha } from "./LiveBanner";
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
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">
          Events
        </Text>
        <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close the events calendar" hitSlop={8}>
          <Ionicons name="close" size={20} color={GP.navy} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        {calendar ? (
          <>
            {live ? <EventRow event={live} badge="Live now" color={GP.berry} highlighted /> : null}
            {!live && !next.length ? <Text style={styles.note}>Nothing on the calendar for the next 30 days. Check back soon.</Text> : null}
            {next.map((e) => (
              <EventRow key={`${e.key}@${e.starts_at}`} event={e} badge={`${times(e.multiplier)} XP`} color={colorFor(e)} />
            ))}
            <Text style={styles.note}>
              Every Wednesday evening is Quest Hour (2× XP). The first Saturday afternoon of each month is Landmark Day (3× XP). Times are local.
            </Text>
          </>
        ) : error ? (
          <View style={{ gap: 10 }}>
            <Text style={styles.note}>{`Couldn't load events. ${error}`}</Text>
            <GameButton title="Try again" small color={GP.sky} onPress={reload} style={{ alignSelf: "flex-start" }} />
          </View>
        ) : !hasPlace ? (
          <Text style={styles.note}>Waiting for your location: events run on local time.</Text>
        ) : (
          <ActivityIndicator color={GP.navy} style={{ marginTop: 40 }} />
        )}
      </ScrollView>
    </Animated.View>
  );
}

function colorFor(e: LiveEvent): string {
  return e.key === "landmark_day" ? GP.berry : GP.skyDeep;
}

function EventRow({ event, badge, color, highlighted }: { event: LiveEvent; badge: string; color: string; highlighted?: boolean }) {
  const when = whenText(event, LIVE_CLOCK);
  return (
    <View
      style={[styles.row, highlighted && { backgroundColor: withAlpha(GP.sun, 0.25), borderColor: GP.sun }]}
      accessible
      accessibilityLabel={`${event.title}, ${when}, ${badge}`}>
      <View style={[styles.icon, { backgroundColor: color }]}>
        <Ionicons name={event.key === "landmark_day" ? "business" : "flash"} size={22} color="#FFF" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {event.title}
        </Text>
        <Text style={styles.rowWhen}>{when}</Text>
      </View>
      <Chip text={badge} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: GP.cream, elevation: 18 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10 },
  title: { fontFamily: GF.display, fontSize: 26, color: GP.ink },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: GP.ice, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: 16, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18, borderWidth: 2, borderColor: "transparent", backgroundColor: "#FFF" },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontFamily: GF.display, fontSize: 19, color: GP.ink },
  rowWhen: { fontFamily: GF.body, fontSize: 14, color: withAlpha(GP.ink, 0.7) },
  note: { fontFamily: GF.body, fontSize: 14, color: GP.mist, paddingHorizontal: 4 },
});
