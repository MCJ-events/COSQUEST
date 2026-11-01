// The home map: the player's real streets, drawn from the game server's own
// ground geometry (GET /v1/map/ground, the same data costquest-ios builds its
// 3D world from), with the Quest Points on it.
//
// Why not react-native-maps on Android: it needs a Google Maps key and
// billing (the project has neither, so it draws an empty grid), it would look
// like a maps app rather than the game, and the ground is already on the
// game server. The Unity world can replace this once the Android Unity export
// exists (docs/android-port.md).
//
// The ground is loaded as tiles round wherever the camera looks
// (GroundTiles.tsx, features/game/mapTiles.ts), so zoomed out, turned or
// dragged far, the screen is always covered.
//
// The board is one view under a camera, as in Pokemon GO: drag to look
// around (with momentum), pinch to zoom, twist to turn, double tap to zoom in.
// The streets are drawn once per tile; the camera is a transform. Until the map is
// moved the camera follows the player; dragged away, it stays put until
// "Back to me" (or the rail's Centre on me). Pins, beacons and the player's
// face stay upright and screen-sized (mapCamera.tsx MapPin).
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { PixelRatio, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  type SharedValue,
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  FadeInDown,
  FadeOutDown,
  withDecay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, Path, Pattern, Rect } from "react-native-svg";

import { toLocal, type LatLng } from "@/features/game/geo";
import { keepFocal, panned, shortAngle } from "@/features/game/mapCameraMath";
import { buildLayers, type MapLayers } from "@/features/game/mapPaths";
import { groundRaster } from "@/features/game/mapRaster";
import { spreadPins } from "@/features/game/pinSpread";
import { effectiveHour, hourForScheme, mapStyle, type MapStyle, timeOfDay } from "@/features/game/mapStyle";
import { useScheme } from "@/theme/scheme";
import { raidTint } from "@/features/game/raids";
import { pinTint } from "@/features/game/siege";
import type { NearbyRoom } from "@/features/game/rooms";
import type { GroundGeometry, QuestPoint } from "@/features/game/wire";

import { GroundPaths } from "./GroundPaths";
import GroundTiles, { type LoadGround } from "./GroundTiles";
import { useMapBench } from "./mapBenchRunner";
import { SHEET_EASE_OUT } from "./sheetMotion";
import { MapCameraContext, MapPin, PIN_SPOT, useUpright } from "./mapCamera";
import { useWorldClock } from "./prefs";
import { RaidCrown } from "./RaidParts";
import RoomBeacon from "./RoomBeacon";
import { GF, GP, realmColor, realmIcon, tierColor } from "./theme";
import { useRenderCount } from "@/utils/perfMarks";
import { themedStyles, useThemedStyles } from "@/constants/chatTheme";

/** Pixels per metre at zoom 1: about 260 m across a phone. */
export const MAP_SCALE = 1.5;
/** Where the player stands on screen, as a share of the height. */
export const PLAYER_Y = 0.56;

/** Zoom limits: out to about 520 m across, in to about 120 m (the ground is a raster: sharper past this would blur). */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.2;
/** A twist must pass this (radians) before the map turns, so a pinch does not turn it by accident. */
const TWIST_START = 0.14;
/** How fast a flung map slows (Reanimated withDecay; closer to 1 glides further). */
const DECELERATION = 0.994;
/** A pan that ends this soon (ms) after a pinch or twist moved does not glide: lifting two fingers unevenly is not a fling. */
const NO_FLING_AFTER_MULTI_MS = 150;
/** The fastest a fling may glide, screen points a second. */
const FLING_MAX = 5000;
/** Following you to a new fix, and flying back to you. */
const FOLLOW_MS = 900;
const RECENTRE_MS = 480;
/** Where a flown-to spot lands, as a share of the screen's height (above a point's sheet). */
const FLY_Y = 0.34;

/** How far the map may be dragged from where the world was cut, metres (tiles load all the way). */
export const PAN_LIMIT_M = 1500;

/** The map's colours for the hour the town is lit for, looked at again each minute. */
function useMapStyle(): MapStyle {
  const clock = useWorldClock();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const dark = useScheme() === "dark";
  const hour = hourForScheme(clock, effectiveHour(clock, now), dark);
  // Only a change of bucket redraws the ground.
  const bucket = timeOfDay(hour);
  return useMemo(() => mapStyle(hour), [bucket]); // eslint-disable-line react-hooks/exhaustive-deps
}

type Props = {
  ground: GroundGeometry | null;
  /** Where the world is cut when there is no ground yet. */
  centre: LatLng | null;
  fix: (LatLng & { accuracy: number }) | null;
  points: QuestPoint[];
  reachM: number;
  selectedId: string | null;
  inReach: (p: QuestPoint) => boolean;
  cooling: (p: QuestPoint) => boolean;
  factionColor: string;
  onSelect: (p: QuestPoint) => void;
  /** Public Rooms near you (Battle unlocked), as beacons. */
  rooms?: NearbyRoom[];
  onRoom?: (room: NearbyRoom) => void;
  /**
   * More things on the board (Forge finds, cq 056), placed with the board's
   * own projection. Wrap each in <MapPin> (mapCamera.tsx) so it stays upright.
   */
  overlay?: (place: (p: LatLng) => { left: number; top: number }) => ReactNode;
  /** A face in the player's marker (their Forge avatar). */
  playerBadge?: ReactNode;
  /**
   * Fetches the ground round a point (the game client's /v1/map/ground). With
   * it the map loads tiles wherever it is looked at; without it, only `ground`
   * is drawn and the map cannot be dragged past it.
   */
  loadGround?: LoadGround;
  /** Bump to fly the camera back to the player (the rail's Centre on me). */
  recentreSignal?: number;
  /** Whether the camera is following the player (false once the map is dragged away). */
  onFollowChange?: (following: boolean) => void;
  /** The map's turn (radians), shared out so the HUD can point with it (the Nearby tray's arrows). */
  camRot?: SharedValue<number>;
  /** True while a finger pans, pinches or twists the map (the Nearby tray steps aside). */
  mapBusy?: SharedValue<boolean>;
  /** Fly the camera to a spot (bump `n` for each flight); it lands a little above the middle, clear of a sheet. */
  flyTo?: { lat: number; lng: number; n: number } | null;
};

export default function WorldMap(props: Props) {
  const styles = useThemedStyles(STYLE_PAIR);
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const { ground, centre, fix, points } = props;
  const origin = ground?.origin ?? centre ?? fix;
  const extent = ground?.radius_m ?? 600;
  const size = extent * 2 * MAP_SCALE;
  // Only the untiled board draws the store's single ground answer.
  const layers = useMemo(() => (ground && !props.loadGround ? buildLayers(ground) : null), [ground, props.loadGround]);
  const look = useMapStyle();

  const ax = width / 2;
  const ay = height * PLAYER_Y;
  const tiled = !!props.loadGround;
  // How far the camera may go, in board points.
  const panLo = tiled ? (extent - PAN_LIMIT_M) * MAP_SCALE : 0;
  const panHi = tiled ? (extent + PAN_LIMIT_M) * MAP_SCALE : size;

  // The camera: the board point under the anchor (where the player stands on
  // screen when followed), the zoom and the turn. Board points: 0..size.
  const camX = useSharedValue(size / 2);
  const camY = useSharedValue(size / 2);
  const zoom = useSharedValue(1);
  const ownRot = useSharedValue(0);
  const rot = props.camRot ?? ownRot;
  const ownBusy = useSharedValue(false);
  const busy = props.mapBusy ?? ownBusy;
  // Which gestures are moving the camera now (pan 1, pinch 2, twist 4): busy while any is.
  const moving = useSharedValue(0);
  const follow = useSharedValue(true);
  // The player's spot on the board (eased to each new fix).
  const meX = useSharedValue(size / 2);
  const meY = useSharedValue(size / 2);
  const twisting = useSharedValue(false);
  // When a pinch or twist last moved the camera (ms), so a pan ending just after it does not fling.
  const multiAt = useSharedValue(-1e9);
  // The screen spot a double tap zooms about while its zoom animates (null when none).
  const tapFocal = useSharedValue<{ x: number; y: number } | null>(null);
  const camera = useMemo(() => ({ zoom, rot }), [zoom, rot]);

  // Mirrored to JS for the "Back to me" button (GameRoot shows it).
  const [following, setFollowing] = useState(true);
  const onFollowChange = useRef(props.onFollowChange);
  onFollowChange.current = props.onFollowChange;
  useAnimatedReaction(
    () => follow.get(),
    (now, before) => {
      if (before !== null && now !== before) runOnJS(setFollowing)(now);
    },
  );
  useEffect(() => {
    onFollowChange.current?.(following);
  }, [following]);

  // Each point's spot on the board, and an offset that spreads crowded pins
  // apart (F-37); recomputed only when the points or the board change.
  const spotsKey = origin ? `${origin.lat},${origin.lng},${extent}|${points.map((p) => `${p.id}:${p.lat}:${p.lng}`).join(";")}` : "";
  const spots = useMemo(() => {
    if (!origin) return new Map<string, { left: number; top: number; dx: number; dy: number }>();
    const raw = points.map((p) => {
      const local = toLocal(origin, p);
      return { id: p.id, x: (local.x + extent) * MAP_SCALE, y: (extent - local.z) * MAP_SCALE };
    });
    const offsets = spreadPins(raw);
    return new Map(raw.map((r) => [r.id, { left: r.x, top: r.y, ...(offsets.get(r.id) ?? { dx: 0, dy: 0 }) }]));
  }, [spotsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new fix: the player's dot eases there, and so does the camera while it
  // follows. A new board (the ground arrived, or a far move re-cut it) puts
  // the camera back on the player at once: old board points mean nothing.
  const boardKey = origin ? `${origin.lat},${origin.lng},${extent}` : "";
  const placedBoard = useRef<string | null>(null);
  useEffect(() => {
    if (!origin) return;
    const fresh = placedBoard.current !== boardKey;
    let px = size / 2;
    let py = size / 2;
    if (fix) {
      const p = toLocal(origin, fix);
      px = (p.x + extent) * MAP_SCALE;
      py = (extent - p.z) * MAP_SCALE;
    }
    if (fresh) {
      placedBoard.current = boardKey;
      cancelAnimation(camX);
      cancelAnimation(camY);
      meX.set(px);
      meY.set(py);
      camX.set(px);
      camY.set(py);
      follow.set(true);
      return;
    }
    const timing = { duration: reduceMotion ? 0 : FOLLOW_MS, easing: Easing.out(Easing.cubic) };
    meX.set(withTiming(px, timing));
    meY.set(withTiming(py, timing));
    if (follow.get()) {
      camX.set(withTiming(px, timing));
      camY.set(withTiming(py, timing));
    }
  }, [boardKey, fix?.lat, fix?.lng, size, extent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back to the player: north up, centred, the zoom kept.
  const recentre = () => {
    const timing = { duration: reduceMotion ? 0 : RECENTRE_MS, easing: Easing.inOut(Easing.cubic) };
    cancelAnimation(camX);
    cancelAnimation(camY);
    cancelAnimation(rot);
    // The short way round to north.
    rot.set(shortAngle(rot.get()));
    rot.set(withTiming(0, timing));
    camX.set(withTiming(meX.get(), timing));
    camY.set(withTiming(meY.get(), timing));
    follow.set(true);
  };
  const signal = props.recentreSignal ?? 0;
  const lastSignal = useRef(signal);
  useEffect(() => {
    if (signal === lastSignal.current) return;
    lastSignal.current = signal;
    recentre();
  }, [signal]); // eslint-disable-line react-hooks/exhaustive-deps

  // What a finger does to the camera, as worklets: the gestures call these,
  // and so does the scripted bench (mapBenchRunner.tsx).
  const ops = useMemo(() => {
    // Keeps the board point under the focal point (screen fx, fy) fixed while
    // the zoom or the turn changes from (s0, r0) to (s1, r1). While the camera
    // follows the player, zoom and turn are about the player instead, so the
    // player stays put (and the camera keeps following).
    const about = (fx: number, fy: number, s0: number, r0: number, s1: number, r1: number) => {
      "worklet";
      if (follow.get()) return;
      const c = keepFocal({ x: camX.get(), y: camY.get(), zoom: s0, rot: r0 }, { x: ax, y: ay }, { x: fx, y: fy }, { zoom: s1, rot: r1 });
      camX.set(c.x);
      camY.set(c.y);
    };
    const stopGlide = () => {
      "worklet";
      cancelAnimation(camX);
      cancelAnimation(camY);
    };
    // A double tap's zoom stops when fingers take over.
    const stopTapZoom = () => {
      "worklet";
      if (tapFocal.get() === null) return;
      tapFocal.set(null);
      cancelAnimation(zoom);
    };
    const touchDown = () => {
      "worklet";
      stopGlide();
      stopTapZoom();
      cancelAnimation(rot);
      follow.set(false);
    };
    const panBy = (dx: number, dy: number) => {
      "worklet";
      const c = panned({ x: camX.get(), y: camY.get(), zoom: zoom.get(), rot: rot.get() }, dx, dy);
      camX.set(Math.max(panLo, Math.min(panHi, c.x)));
      camY.set(Math.max(panLo, Math.min(panHi, c.y)));
    };
    const fling = (vx: number, vy: number) => {
      "worklet";
      // Momentum: the fling's speed carried on in board points, slowing.
      // (panned() on a velocity gives the camera's own velocity, from 0.)
      if (Date.now() - multiAt.get() < NO_FLING_AFTER_MULTI_MS) return;
      const speed = Math.hypot(vx, vy);
      const k = speed > FLING_MAX ? FLING_MAX / speed : 1;
      const v = panned({ x: 0, y: 0, zoom: zoom.get(), rot: rot.get() }, vx * k, vy * k);
      camX.set(withDecay({ velocity: v.x, deceleration: DECELERATION, clamp: [panLo, panHi] }));
      camY.set(withDecay({ velocity: v.y, deceleration: DECELERATION, clamp: [panLo, panHi] }));
    };
    const pinchBy = (fx: number, fy: number, scaleChange: number) => {
      "worklet";
      stopTapZoom();
      multiAt.set(Date.now());
      const s0 = zoom.get();
      const s1 = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, s0 * scaleChange));
      if (s1 === s0) return;
      const r = rot.get();
      about(fx, fy, s0, r, s1, r);
      zoom.set(s1);
    };
    const twistBy = (x: number, y: number, rotChange: number) => {
      "worklet";
      multiAt.set(Date.now());
      const s = zoom.get();
      const r0 = rot.get();
      const r1 = r0 + rotChange;
      about(x, y, s, r0, s, r1);
      rot.set(r1);
    };
    const doubleTap = (x: number, y: number) => {
      "worklet";
      const s0 = zoom.get();
      const s1 = Math.min(ZOOM_MAX, s0 * 1.6);
      if (s1 === s0) return;
      // The camera follows the zoom frame by frame (the reaction below), so the
      // tapped spot stays under the finger the whole way, not just at the end.
      tapFocal.set({ x, y });
      zoom.set(
        withTiming(s1, { duration: 220, easing: Easing.out(Easing.cubic) }, (finished) => {
          // Not when a newer double tap took over (it has its own spot).
          if (finished) tapFocal.set(null);
        }),
      );
    };
    return { about, stopGlide, touchDown, panBy, fling, pinchBy, twistBy, doubleTap };
  }, [ax, ay, panLo, panHi, camX, camY, zoom, rot, follow, multiAt, tapFocal]);

  useAnimatedReaction(
    () => zoom.get(),
    (now, before) => {
      const f = tapFocal.get();
      if (f === null || before === null || now === before) return;
      const r = rot.get();
      ops.about(f.x, f.y, before, r, now, r);
    },
    [ops],
  );

  const gesture = useMemo(() => {
    const mark = (bit: number, on: boolean) => {
      "worklet";
      const m = on ? moving.get() | bit : moving.get() & ~bit;
      moving.set(m);
      busy.set(m !== 0);
    };
    const pan = Gesture.Pan()
      .minDistance(8)
      .maxPointers(2)
      .onStart(() => {
        ops.touchDown();
        mark(1, true);
      })
      .onFinalize(() => {
        mark(1, false);
      })
      .onChange((e) => {
        ops.panBy(e.changeX, e.changeY);
      })
      .onEnd((e) => {
        ops.fling(e.velocityX, e.velocityY);
      });
    const pinch = Gesture.Pinch()
      .onStart(() => {
        ops.stopGlide();
        multiAt.set(Date.now());
        mark(2, true);
      })
      .onFinalize(() => {
        mark(2, false);
      })
      .onChange((e) => {
        ops.pinchBy(e.focalX, e.focalY, e.scaleChange);
      });
    const twist = Gesture.Rotation()
      .onStart(() => {
        twisting.set(false);
        cancelAnimation(rot);
      })
      .onChange((e) => {
        if (!twisting.get()) {
          if (Math.abs(e.rotation) < TWIST_START) return;
          twisting.set(true);
          mark(4, true);
          runOnJS(Haptics.selectionAsync)();
          return;
        }
        ops.twistBy(e.anchorX, e.anchorY, e.rotationChange);
      })
      .onFinalize(() => {
        twisting.set(false);
        mark(4, false);
      });
    // A double tap zooms in on the spot, as in every map.
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDelay(250)
      .onEnd((e, ok) => {
        if (!ok) return;
        ops.doubleTap(e.x, e.y);
      });
    return Gesture.Simultaneous(pan, pinch, twist, doubleTap);
  }, [ops, rot, twisting, multiAt, moving, busy]);

  // Fly to a spot (the Nearby tray): it lands at FLY_Y of the screen, above
  // where a point's sheet rises, and the camera stops following the player.
  const fly = props.flyTo;
  useEffect(() => {
    if (!fly || !origin) return;
    const p = toLocal(origin, fly);
    const bx = (p.x + extent) * MAP_SCALE;
    const by = (extent - p.z) * MAP_SCALE;
    // The camera that puts board point (bx, by) at screen (ax, FLY_Y * height).
    const c = panned({ x: bx, y: by, zoom: zoom.get(), rot: rot.get() }, 0, height * FLY_Y - ay);
    const timing = { duration: reduceMotion ? 0 : RECENTRE_MS, easing: SHEET_EASE_OUT };
    cancelAnimation(camX);
    cancelAnimation(camY);
    follow.set(false);
    camX.set(withTiming(Math.max(panLo, Math.min(panHi, c.x)), timing));
    camY.set(withTiming(Math.max(panLo, Math.min(panHi, c.y)), timing));
  }, [fly?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  useMapBench(ops, width, height, !!origin, recentre, () => ({ pins: points.length, rooms: (props.rooms ?? []).length }));

  const worldStyle = useAnimatedStyle(() => ({
    // A point p on the board lands at anchor + R(rot) * zoom * (p - cam).
    transform: [
      { translateX: ax },
      { translateY: ay },
      { rotate: `${rot.get()}rad` },
      { scale: zoom.get() },
      { translateX: -camX.get() },
      { translateY: -camY.get() },
    ],
  }));
  const meStyle = useAnimatedStyle(() => ({ transform: [{ translateX: meX.get() }, { translateY: meY.get() }] }));

  const reachPx = props.reachM * MAP_SCALE;
  const accuracyPx = fix ? Math.min(120, Math.max(10, fix.accuracy * MAP_SCALE)) : 0;

  return (
    <MapCameraContext.Provider value={camera}>
      <GestureDetector gesture={gesture}>
        <View style={[styles.root, { backgroundColor: look.land }]} accessibilityLabel="Map of the streets around you. Drag to look around, pinch to zoom, twist to turn.">
          {origin ? (
            <Animated.View style={[styles.world, { width: size, height: size }, worldStyle]}>
              {props.loadGround && origin ? (
                <GroundTiles
                  origin={origin}
                  extent={extent}
                  scale={MAP_SCALE}
                  look={look}
                  load={props.loadGround}
                  camX={camX}
                  camY={camY}
                  zoom={zoom}
                  width={width}
                  height={height}
                  anchorX={ax}
                  anchorY={ay}
                />
              ) : (
                <Ground layers={layers} extent={extent} size={size} look={look} />
              )}
              {/* Your reach and the fix's accuracy, in metres on the ground: they zoom with it. */}
              {fix ? (
                <Animated.View pointerEvents="none" style={[styles.me, meStyle]}>
                  <View style={[styles.ring, { width: reachPx * 2, height: reachPx * 2, borderRadius: reachPx, left: -reachPx, top: -reachPx, borderColor: props.factionColor }]}>
                    <View style={[StyleSheet.absoluteFill, { borderRadius: reachPx, backgroundColor: props.factionColor, opacity: 0.08 }]} />
                  </View>
                  <View style={[styles.accuracy, { width: accuracyPx * 2, height: accuracyPx * 2, borderRadius: accuracyPx, left: -accuracyPx, top: -accuracyPx }]} />
                </Animated.View>
              ) : null}
              {points.map((p) => {
                const spot = spots.get(p.id);
                return spot && (spot.dx || spot.dy) ? <PinLeader key={`l-${p.id}`} left={spot.left} top={spot.top} dx={spot.dx} dy={spot.dy} /> : null;
              })}
              {points.map((p) => {
                const spot = spots.get(p.id);
                if (!spot) return null;
                const selected = props.selectedId === p.id;
                const inReach = props.inReach(p);
                return (
                  <MapPin key={p.id} left={spot.left + spot.dx} top={spot.top + spot.dy} zIndex={selected ? 3 : inReach ? 2 : 1}>
                    <PointMarker point={p} selected={selected} inReach={inReach} cooling={props.cooling(p)} onPress={props.onSelect} />
                  </MapPin>
                );
              })}
              {(props.rooms ?? []).map((r) => {
                const local = toLocal(origin, r);
                return (
                  <MapPin key={r.game_id} left={(local.x + extent) * MAP_SCALE} top={(extent - local.z) * MAP_SCALE} zIndex={2}>
                    <RoomBeacon room={r} left={PIN_SPOT.left} top={PIN_SPOT.top} onPress={(room) => props.onRoom?.(room)} />
                  </MapPin>
                );
              })}
              {props.overlay?.((p) => {
                const local = toLocal(origin, p);
                return { left: (local.x + extent) * MAP_SCALE, top: (extent - local.z) * MAP_SCALE };
              })}
              {fix ? (
                <Animated.View pointerEvents="none" style={[styles.me, styles.meTop, meStyle]}>
                  <PlayerFace color={props.factionColor} badge={props.playerBadge} />
                </Animated.View>
              ) : null}
            </Animated.View>
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: look.land }]} />
          )}

          {ground?.attribution ? (
            <Text style={[styles.attribution, { color: look.ink }]} pointerEvents="none">
              {ground.attribution}
            </Text>
          ) : null}
        </View>
      </GestureDetector>
    </MapCameraContext.Provider>
  );
}

/** "Back to me": GameRoot shows it once the map has been moved off the player (WorldMap onFollowChange). */
export function BackToMe({ onPress }: { onPress: () => void }) {
  const styles = useThemedStyles(STYLE_PAIR);
  return (
    <Animated.View entering={BACK_IN} exiting={BACK_OUT} pointerEvents="box-none" style={styles.backWrap}>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          onPress();
        }}
        hitSlop={8}
        style={({ pressed }) => [styles.back, pressed && { transform: [{ scale: 0.96 }] }]}
        accessibilityRole="button"
        accessibilityLabel="Back to me: centre the map on you">
        <Ionicons name="navigate" size={16} color="#FFFFFF" />
        <Text style={styles.backText}>Back to me</Text>
      </Pressable>
    </Animated.View>
  );
}

const Ground = memo(function Ground({ layers, extent, size, look }: { layers: MapLayers | null; extent: number; size: number; look: MapStyle }) {
  const box = `${-extent} ${-extent} ${extent * 2} ${extent * 2}`;
  // Drawn at most MAX_GROUND_PX square and scaled up (mapRaster.ts): the full
  // size crashed Android on 560 dpi screens and cost ~160 MB.
  const raster = groundRaster(size, PixelRatio.get());
  return (
    <Svg
      width={raster.drawn}
      height={raster.drawn}
      viewBox={box}
      style={{ position: "absolute", left: raster.offset, top: raster.offset, transform: [{ scale: raster.scale }] }}>
      <Defs>
        <Pattern id="grid" width={40} height={40} patternUnits="userSpaceOnUse">
          <Path d="M40 0L0 0 0 40" stroke={look.grid} strokeWidth={1} fill="none" />
        </Pattern>
      </Defs>
      <Rect x={-extent} y={-extent} width={extent * 2} height={extent * 2} fill={look.land} />
      {layers ? (
        <GroundPaths layers={layers} look={look} />
      ) : (
        <Rect x={-extent} y={-extent} width={extent * 2} height={extent * 2} fill="url(#grid)" />
      )}
    </Svg>
  );
});

const MARKER = 46;

/** The pin's colour by the rule the iOS world uses: raid > holder > tier (siege.ts pinTint). */
export function pinFill(p: QuestPoint): string {
  const tint = pinTint(p);
  if (tint.kind === "raid") return raidTint(p) ?? tierColor(p.tier);
  if (tint.kind === "holder") return realmColor(tint.faction);
  return tierColor(tint.tier);
}

const PointMarker = memo(function PointMarker({
  point,
  selected,
  inReach,
  cooling,
  onPress,
}: {
  point: QuestPoint;
  selected: boolean;
  inReach: boolean;
  cooling: boolean;
  onPress: (p: QuestPoint) => void;
}) {
  const styles = useThemedStyles(STYLE_PAIR);
  useRenderCount("PointMarker");
  // RoamHomeView.object: a boss's raid tint, else its holder's colour, else its tier's.
  const color = cooling ? "#9AA7B0" : pinFill(point);
  const ring = cooling ? "#C9D1D6" : "#FFFFFF";
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (inReach && !cooling) {
      pulse.set(withRepeat(withSequence(withTiming(1, { duration: 900 }), withTiming(0, { duration: 0 })), -1));
    } else {
      pulse.set(0);
    }
  }, [inReach, cooling, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - pulse.get()),
    transform: [{ scale: 1 + pulse.get() * 0.9 }],
  }));
  const isDuel = point.challenge === "duel";
  return (
    <Pressable
      onPress={() => onPress(point)}
      // Small: spread pins sit a little over a pin's width apart (pinSpread.ts),
      // so a bigger slop would reach into the neighbour's face.
      hitSlop={4}
      // Stands on its spot in the MapPin box (the box keeps it upright).
      style={[styles.marker, { left: PIN_SPOT.left - MARKER / 2, top: PIN_SPOT.top - MARKER }]}
      accessibilityRole="button"
      accessibilityLabel={`${point.name}, ${point.tier} ${isDuel ? "Guardian" : point.challenge}${point.extra?.holder ? ", held" : ""}${cooling ? ", recharging" : ""}${inReach ? ", in reach" : ""}`}>
      {inReach && !cooling ? <Animated.View style={[styles.pulse, { borderColor: color }, pulseStyle]} /> : null}
      <View style={[styles.pin, { backgroundColor: color, borderColor: selected ? GP.navy : ring, transform: [{ scale: selected ? 1.15 : 1 }] }]}>
        {point.source === "raid" ? <RaidCrown size={20} /> : <Ionicons name={isDuel ? "shield" : realmIcon(point.realm)} size={20} color="#FFFFFF" />}
      </View>
      <View style={[styles.stem, { backgroundColor: selected ? GP.navy : color }]} />
    </Pressable>
  );
});

/** A crowded pin's thin line back to its real spot, with a dot on the spot. */
function PinLeader({ left, top, dx, dy }: { left: number; top: number; dx: number; dy: number }) {
  const styles = useThemedStyles(STYLE_PAIR);
  // From the real spot to the moved pin's stem (its bottom centre).
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  return (
    <>
      <View
        pointerEvents="none"
        style={[
          styles.leader,
          { left: left + dx / 2 - length / 2, top: top + dy / 2 - 1, width: length, transform: [{ rotate: `${angle}rad` }] },
        ]}
      />
      <View pointerEvents="none" style={[styles.leaderDot, { left: left - 4, top: top - 4 }]} />
    </>
  );
}

/** The player's face (or dot), upright and screen-sized at the centre of their spot. */
function PlayerFace({ color, badge }: { color: string; badge?: ReactNode }) {
  const styles = useThemedStyles(STYLE_PAIR);
  const upright = useUpright();
  return (
    <Animated.View style={[styles.face, upright]}>
      {badge ? (
        <View style={[styles.playerBadge, { borderColor: color }]}>{badge}</View>
      ) : (
        <View style={[styles.player, { backgroundColor: color }]}>
          <View style={styles.playerDot} />
        </View>
      )}
    </Animated.View>
  );
}

const BACK_IN = FadeInDown.duration(220);
const BACK_OUT = FadeOutDown.duration(160);

const STYLE_PAIR = themedStyles({
  root: {
    ...StyleSheet.absoluteFill,
    overflow: "hidden",
  },
  world: {
    position: "absolute",
    left: 0,
    top: 0,
    // The camera's transform is written about the board's top-left corner.
    transformOrigin: [0, 0, 0],
  },
  marker: {
    position: "absolute",
    width: MARKER,
    height: MARKER + 8,
    alignItems: "center",
  },
  pin: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  leader: {
    position: "absolute",
    height: 2,
    borderRadius: 1,
    backgroundColor: "rgba(31,59,77,0.45)",
  },
  leaderDot: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(31,59,77,0.6)",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },
  stem: {
    width: 4,
    height: 8,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  pulse: {
    position: "absolute",
    top: 0,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
  },
  me: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  },
  meTop: {
    zIndex: 5,
  },
  ring: {
    position: "absolute",
    borderWidth: 2,
    borderStyle: "dashed",
    opacity: 0.6,
  },
  accuracy: {
    position: "absolute",
    backgroundColor: GP.skyDeep,
    opacity: 0.14,
  },
  face: {
    position: "absolute",
    left: -20,
    top: -20,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  backWrap: {
    alignSelf: "center",
  },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: GP.navy,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  backText: {
    fontFamily: GF.display,
    fontSize: 15,
    color: "#FFFFFF",
  },
  player: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 3,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  playerBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    elevation: 6,
  },
  playerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FFFFFF",
  },
  attribution: {
    position: "absolute",
    right: 6,
    bottom: 2,
    fontFamily: GF.regular,
    fontSize: 9,
    color: "rgba(30,58,76,0.55)",
  },
});
