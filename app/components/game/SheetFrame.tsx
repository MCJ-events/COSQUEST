// The frame the game's sheets share: a bottom sheet with the game's backdrop
// (GameBackdrop.tsx) and a grabber, slid up over the map. Wrap it in
// <SheetHost> (Sheet.tsx) for the scrim and the drag down that close it on iOS,
// and put <SheetHeader> (SheetHeader.tsx) at its top.
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeIn, SlideInDown, useReducedMotion } from "react-native-reanimated";

import { GameBackdrop } from "./GameBackdrop";
import { GP } from "./theme";

/**
 * `full` covers the whole screen (the Profile, which has its own top bar);
 * otherwise it stops `top` below the screen's top, like the Journal always has.
 */
export function SheetFrame({ children, top, full }: { children: ReactNode; top: number; full?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <Animated.View entering={reduce ? FadeIn.duration(120) : SlideInDown.springify().damping(20)} style={[styles.sheet, { top }, full && styles.full]}>
      <GameBackdrop />
      {full ? null : <View style={styles.grabber} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden />}
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: "hidden", backgroundColor: GP.ice, elevation: 18 },
  full: { borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, marginTop: 8, backgroundColor: "rgba(31,59,77,0.25)" },
});
