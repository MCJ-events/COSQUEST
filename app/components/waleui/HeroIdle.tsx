// The Home hero idles in place (features/waleui/heroIdle.ts: Wale, 13 Nov). Wraps the hero picture: a slow breath
// (the body a little taller) and a small weight shift (a sway), both about the feet so the feet stay planted. On the
// native driver: no JavaScript runs per frame. A still picture on low-memory phones and with Reduce motion.
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Animated, Easing } from "react-native";

import { HERO_IDLE, heroIdleOn } from "@/features/waleui/heroIdle";
import { CostQuestGame } from "@/modules/costquest-game/src";

export function HeroIdle({ children, testID }: { children: ReactNode; testID?: string }) {
  const [reduce, setReduce] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((r) => live && setReduce(r))
      .catch(() => live && setReduce(false));
    return () => {
      live = false;
    };
  }, []);
  const on = reduce !== null && heroIdleOn({ physicalMemory: CostQuestGame?.physicalMemory, reduceMotion: reduce });
  const breath = useMemo(() => new Animated.Value(0), []);
  const shift = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    if (!on) return;
    const ease = Easing.inOut(Easing.sin);
    const half = (v: Animated.Value, to: number, ms: number) => Animated.timing(v, { toValue: to, duration: ms, easing: ease, useNativeDriver: true });
    const b = Animated.loop(Animated.sequence([half(breath, 1, HERO_IDLE.breathMs / 2), half(breath, 0, HERO_IDLE.breathMs / 2)]));
    const s = Animated.loop(Animated.sequence([half(shift, 1, HERO_IDLE.shiftMs / 4), half(shift, -1, HERO_IDLE.shiftMs / 2), half(shift, 0, HERO_IDLE.shiftMs / 4)]));
    b.start();
    s.start();
    return () => {
      b.stop();
      s.stop();
    };
  }, [on, breath, shift]);
  if (!on) return <>{children}</>;
  const scaleY = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1 + HERO_IDLE.breathScale] });
  const rotate = shift.interpolate({ inputRange: [-1, 1], outputRange: [`${-HERO_IDLE.shiftDeg}deg`, `${HERO_IDLE.shiftDeg}deg`] });
  return (
    <Animated.View testID={testID} style={{ transformOrigin: "bottom", transform: [{ rotate }, { scaleY }] }}>
      {children}
    </Animated.View>
  );
}
