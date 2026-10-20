// What closes a sheet on iOS, which has no Back button: a scrim you can tap and
// a drag down on the sheet's top edge (a native .sheet gives both for free).
// Wrap a sheet in <SheetHost> and pass the `close` it hands you to the sheet's
// own X, so every way out takes the same slide down. Android's Back is still
// GameRoot's BackHandler.
import { type ReactNode, useCallback } from "react";
import { Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Easing, FadeIn, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

/** Where a drag may start: a strip of the screen (the sheet's header), or anywhere ("any", for short sheets). */
export type DragBand = { top: number; height: number } | "any";

/** A drag of this far, or a flick this fast, dismisses. */
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 900;

export function SheetHost({
  onClose,
  band,
  scrimLabel = "Close",
  children,
}: {
  /** Called once the sheet has slid away. */
  onClose: () => void;
  band: DragBand;
  scrimLabel?: string;
  children: (close: () => void) => ReactNode;
}) {
  const { height } = useWindowDimensions();
  const ty = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const closing = useSharedValue(false);
  const bandTop = band === "any" ? -1 : band.top;
  const bandBottom = band === "any" ? Number.MAX_SAFE_INTEGER : band.top + band.height;

  const close = useCallback(() => {
    if (closing.get()) return;
    closing.set(true);
    ty.set(
      withTiming(height, { duration: 220, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(onClose)();
      }),
    );
  }, [closing, height, onClose, ty]);

  const pan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((e) => {
      const t = e.allTouches[0];
      if (!t) return;
      startX.set(t.absoluteX);
      startY.set(t.absoluteY);
    })
    .onTouchesMove((e, manager) => {
      const t = e.allTouches[0];
      if (!t) return;
      const y0 = startY.get();
      if (y0 < bandTop || y0 > bandBottom) {
        manager.fail();
        return;
      }
      const dy = t.absoluteY - y0;
      const dx = Math.abs(t.absoluteX - startX.get());
      if (dx > 16 && dx > dy) manager.fail();
      else if (dy > 10) manager.activate();
    })
    .onUpdate((e) => {
      ty.set(Math.max(0, e.translationY));
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) runOnJS(close)();
      else ty.set(withSpring(0, { stiffness: 400, damping: 30, mass: 1 }));
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.get() }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: interpolate(ty.get(), [0, height], [1, 0], "clamp") }));

  return (
    <Animated.View entering={FadeIn.duration(200)} style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel={scrimLabel} />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[StyleSheet.absoluteFill, sheetStyle]} pointerEvents="box-none" accessibilityViewIsModal>
          {children(close)}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: "rgba(20,32,44,0.35)" },
});
