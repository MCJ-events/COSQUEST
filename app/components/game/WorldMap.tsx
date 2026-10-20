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
// The whole world is one view that slides under a fixed player marker, so a
// new fix is one animated translate, and the paths are built once per ground.
import { Ionicons } from "@expo/vector-icons";
import { memo, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, Path, Pattern, Rect } from "react-native-svg";

import { toLocal, type LatLng } from "@/features/game/geo";
import { buildLayers, type MapLayers } from "@/features/game/mapPaths";
import { spreadPins } from "@/features/game/pinSpread";
import { effectiveHour, mapStyle, type MapStyle, timeOfDay } from "@/features/game/mapStyle";
import { raidTint } from "@/features/game/raids";
import { pinTint } from "@/features/game/siege";
import type { NearbyRoom } from "@/features/game/rooms";
import type { GroundGeometry, QuestPoint } from "@/features/game/wire";

import { useWorldClock } from "./prefs";
import { RaidCrown } from "./RaidParts";
import RoomBeacon from "./RoomBeacon";
import { GF, GP, realmColor, realmIcon, tierColor } from "./theme";
import { useRenderCount } from "@/utils/perfMarks";

/** Pixels per metre: about 260 m across a phone. */
export const MAP_SCALE = 1.5;
/** Where the player stands on screen, as a share of the height. */
export const PLAYER_Y = 0.56;

/** How far a building's wall shows below its roof, in metres: the board seen from a little south. */
const WALL_DROP_M = 3;

/** The map's colours for the hour the town is lit for, looked at again each minute. */
function useMapStyle(): MapStyle {
  const clock = useWorldClock();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const hour = effectiveHour(clock, now);
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
};

export default function WorldMap(props: Props) {
  const { width, height } = useWindowDimensions();
  const { ground, centre, fix, points } = props;
  const origin = ground?.origin ?? centre ?? fix;
  const extent = ground?.radius_m ?? 600;
  const size = extent * 2 * MAP_SCALE;
  const layers = useMemo(() => (ground ? buildLayers(ground) : null), [ground]);
  const look = useMapStyle();

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const anchor = { x: width / 2, y: height * PLAYER_Y };

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

  useEffect(() => {
    if (!origin || !fix) return;
    const p = toLocal(origin, fix);
    const px = (p.x + extent) * MAP_SCALE;
    const py = (extent - p.z) * MAP_SCALE;
    const first = tx.get() === 0 && ty.get() === 0;
    const timing = { duration: first ? 0 : 900, easing: Easing.out(Easing.cubic) };
    tx.set(withTiming(anchor.x - px, timing));
    ty.set(withTiming(anchor.y - py, timing));
  }, [origin, fix, extent, anchor.x, anchor.y, tx, ty]);

  const worldStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() }, { translateY: ty.get() }],
  }));

  return (
    <View style={[styles.root, { backgroundColor: look.land }]} accessibilityLabel="Map of the streets around you">
      {origin ? (
        <Animated.View style={[styles.world, { width: size, height: size }, worldStyle]}>
          <Ground layers={layers} extent={extent} size={size} look={look} />
          {points.map((p) => {
            const spot = spots.get(p.id);
            return spot && (spot.dx || spot.dy) ? <PinLeader key={`l-${p.id}`} left={spot.left} top={spot.top} dx={spot.dx} dy={spot.dy} /> : null;
          })}
          {points.map((p) => {
            const spot = spots.get(p.id);
            if (!spot) return null;
            return (
              <PointMarker
                key={p.id}
                point={p}
                left={spot.left + spot.dx}
                top={spot.top + spot.dy}
                selected={props.selectedId === p.id}
                inReach={props.inReach(p)}
                cooling={props.cooling(p)}
                onPress={props.onSelect}
              />
            );
          })}
          {(props.rooms ?? []).map((r) => {
            const local = toLocal(origin, r);
            return (
              <RoomBeacon key={r.game_id} room={r} left={(local.x + extent) * MAP_SCALE} top={(extent - local.z) * MAP_SCALE} onPress={(room) => props.onRoom?.(room)} />
            );
          })}
        </Animated.View>
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: look.land }]} />
      )}

      {fix ? (
        <PlayerMarker
          x={anchor.x}
          y={anchor.y}
          accuracyPx={Math.min(120, Math.max(10, fix.accuracy * MAP_SCALE))}
          reachPx={props.reachM * MAP_SCALE}
          color={props.factionColor}
        />
      ) : null}

      {ground?.attribution ? (
        <Text style={[styles.attribution, { color: look.ink }]} pointerEvents="none">
          {ground.attribution}
        </Text>
      ) : null}
    </View>
  );
}

const Ground = memo(function Ground({ layers, extent, size, look }: { layers: MapLayers | null; extent: number; size: number; look: MapStyle }) {
  const box = `${-extent} ${-extent} ${extent * 2} ${extent * 2}`;
  return (
    <Svg width={size} height={size} viewBox={box} style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id="grid" width={40} height={40} patternUnits="userSpaceOnUse">
          <Path d="M40 0L0 0 0 40" stroke={look.grid} strokeWidth={1} fill="none" />
        </Pattern>
      </Defs>
      <Rect x={-extent} y={-extent} width={extent * 2} height={extent * 2} fill={look.land} />
      {layers ? (
        <>
          <Path d={layers.green} fill={look.green} />
          <Path d={layers.water} fill={look.water} />
          {layers.waterways.map((w, i) => (
            <Path key={`ww${i}`} d={w.d} stroke={look.water} strokeWidth={w.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          ))}
          <Path d={layers.paved} fill={look.paved} />
          {layers.roads.map((r, i) => (
            <Path
              key={`re${i}`}
              d={r.d}
              stroke={r.kind === "rail" ? look.rail : look.casing}
              strokeWidth={r.width + (r.kind === "path" || r.kind === "rail" ? 0.6 : 2)}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}
          {layers.roads
            .filter((r) => r.kind !== "rail")
            .map((r, i) => (
              <Path
                key={`r${i}`}
                d={r.d}
                stroke={r.kind === "path" ? look.path : r.kind === "major" ? look.roadMajor : look.road}
                strokeWidth={r.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
          {/* The wall below each roof, then the roof: buildings stand up off the board. */}
          <Path d={layers.buildings} fill={look.wall} transform={`translate(0 ${WALL_DROP_M})`} />
          <Path d={layers.buildings} fill={look.roof} stroke={look.roofEdge} strokeWidth={0.8} />
        </>
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
  left,
  top,
  selected,
  inReach,
  cooling,
  onPress,
}: {
  point: QuestPoint;
  left: number;
  top: number;
  selected: boolean;
  inReach: boolean;
  cooling: boolean;
  onPress: (p: QuestPoint) => void;
}) {
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
      style={[styles.marker, { left: left - MARKER / 2, top: top - MARKER, zIndex: selected ? 3 : inReach ? 2 : 1 }]}
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

function PlayerMarker({ x, y, accuracyPx, reachPx, color }: { x: number; y: number; accuracyPx: number; reachPx: number; color: string }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg style={StyleSheet.absoluteFill}>
        <Circle cx={x} cy={y} r={reachPx} fill={color} fillOpacity={0.08} stroke={color} strokeOpacity={0.45} strokeWidth={2} strokeDasharray="6 6" />
        <Circle cx={x} cy={y} r={accuracyPx} fill={GP.skyDeep} fillOpacity={0.14} />
      </Svg>
      <View style={[styles.player, { left: x - 13, top: y - 13, backgroundColor: color }]}>
        <View style={styles.playerDot} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    overflow: "hidden",
  },
  world: {
    position: "absolute",
    left: 0,
    top: 0,
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
  player: {
    position: "absolute",
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
