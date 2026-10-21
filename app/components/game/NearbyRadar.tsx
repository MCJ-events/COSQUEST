// A strip above the Nearby tray naming what is close and what is about to
// appear or vanish: "2 in reach · 1 wandering · next in 4 min". Polls the
// server's public "next spawn" once a minute and redraws every 20 s, so the
// counts stay true between point refreshes. costquest-ios
// Features/SpawnsFeature.swift NearbyRadar.
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { gameStore } from "@/features/game/runtime";
import { nextAtFrom, radarCounts, radarParts, spawnsNext } from "@/features/game/siege";
import type { QuestPoint } from "@/features/game/wire";

import { MAX_FONT_SCALE } from "./kit";
import { GF, GP } from "./theme";
import { themedStyles, useThemedStyles } from "@/constants/chatTheme";

const POLL_MS = 60_000;
const REDRAW_MS = 20_000;

export default function NearbyRadar({
  points,
  fix,
  inReach,
}: {
  points: QuestPoint[];
  fix: { lat: number; lng: number } | null;
  inReach: (p: QuestPoint) => boolean;
}) {
  const styles = useThemedStyles(STYLE_PAIR);
  const [nextAt, setNextAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const fixRef = useRef(fix);
  useEffect(() => {
    fixRef.current = fix;
  });
  const hasFix = fix !== null;

  // Poll while the strip is on screen. The server derives wandering
  // challenges from place and time, so this is a cheap, public read; a
  // failure just hides the "next" part.
  useEffect(() => {
    if (!hasFix) return;
    let alive = true;
    const refresh = async () => {
      const f = fixRef.current;
      if (!f) return;
      try {
        const r = await spawnsNext(gameStore.client, f.lat, f.lng);
        if (alive) setNextAt(nextAtFrom(r, Date.now()));
      } catch {
        if (alive) setNextAt(null);
      }
    };
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [hasFix]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), REDRAW_MS);
    return () => clearInterval(t);
  }, []);

  if (!hasFix) return null;
  const { reach, wandering } = radarCounts(points, inReach, now);
  const parts = radarParts(reach, wandering, nextAt, now);
  if (parts.length === 0) return null;
  return (
    <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.panel} accessible accessibilityLabel={parts.join(", ")}>
      {wandering > 0 ? (
        <MaterialCommunityIcons name="weather-windy" size={18} color={GP.sun} />
      ) : (
        <Ionicons name="radio" size={18} color={GP.sun} />
      )}
      <Text style={styles.text} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {parts.join(" · ")}
      </Text>
    </Animated.View>
  );
}

const STYLE_PAIR = themedStyles({
  // GameHUDPanel(padding: 10)
  panel: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    marginHorizontal: 14,
    padding: 10,
    borderRadius: 18,
    backgroundColor: "rgba(31,59,77,0.78)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.18)",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    maxWidth: "88%",
  },
  text: { flexShrink: 1, fontFamily: GF.body, fontSize: 14, color: "#FFFFFF" },
});
