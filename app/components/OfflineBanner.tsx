// "You're offline" across the top of every screen while the phone has no
// connection, with how many messages are waiting to go. Slides away when the
// connection is back (and the waiting messages are sent).
//
// It waits until offline has held for OFFLINE_SHOW_MS: the first reachability
// reading after sign-in is often a false "offline" that clears within seconds
// (build 19 flashed the banner for ~5 s while online). Back online hides it at once.
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONTS } from "@/constants/fonts";
import { useOffline, useQueuedCount } from "@/services/network";
import { C, space, type } from "@/theme/tokens";

/** How long offline must hold before the banner shows. */
const OFFLINE_SHOW_MS = 3000;

export default function OfflineBanner() {
  const offline = useOffline();
  const queued = useQueuedCount();
  const insets = useSafeAreaInsets();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!offline) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), OFFLINE_SHOW_MS);
    return () => clearTimeout(t);
  }, [offline]);
  if (!offline || !shown) return null;
  const text = queued ? `You're offline. ${queued} ${queued === 1 ? "message" : "messages"} will send when you're back.` : "You're offline. We'll reconnect when you're back.";
  return (
    <Animated.View
      entering={FadeInUp.duration(180)}
      exiting={FadeOutUp.duration(180)}
      pointerEvents="none"
      style={[styles.wrap, { paddingTop: insets.top + space.xs }]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      accessibilityLabel={text}
      testID="offline-banner">
      <View style={styles.row}>
        <Ionicons name="cloud-offline-outline" size={16} color={C.white} />
        <Text style={styles.text} numberOfLines={2}>
          {text}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 1000, elevation: 30, backgroundColor: C.inkNavy, paddingBottom: space.sm, paddingHorizontal: space.lg },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm },
  text: { flexShrink: 1, fontFamily: FONTS.medium, ...type.small, color: C.white, textAlign: "center" },
});
