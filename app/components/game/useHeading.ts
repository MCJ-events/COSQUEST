// Which way the phone faces, for the bearing arrow on the Nearby cards
// (RoamStore.bearing is relative to the heading; nil without one). Follows the
// compass only while `enabled`, and only reports a turn of a few degrees.
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

const MIN_TURN = 6;

export function useHeading(enabled: boolean): number | null {
  const [heading, setHeading] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled || Platform.OS === "web") return;
    let alive = true;
    let sub: Location.LocationSubscription | null = null;
    Location.watchHeadingAsync((h) => {
      const deg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
      if (!Number.isFinite(deg) || deg < 0) return;
      setHeading((prev) => {
        if (prev === null) return deg;
        const turn = Math.abs(((deg - prev + 540) % 360) - 180);
        return turn >= MIN_TURN ? deg : prev;
      });
    })
      .then((s) => {
        if (alive) sub = s;
        else s.remove();
      })
      .catch(() => {});
    return () => {
      alive = false;
      sub?.remove();
    };
  }, [enabled]);
  return enabled ? heading : null;
}
