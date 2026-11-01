// The world map's ground, loaded as tiles round wherever the camera looks
// (features/game/mapTiles.ts has the why and the maths).
//
// Lives inside WorldMap's board view, so tiles are placed in board points and
// the camera's transform moves them with everything else. It watches the
// camera itself (quantised, on the UI thread) so a pan or pinch re-renders
// only this layer, never the pins. Cells are fetched nearest first, a few at
// a time, kept in a small LRU as drawable path strings, and faded in over a
// quiet placeholder rather than popping in over bare land.
import { memo, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { PixelRatio, StyleSheet } from "react-native";
import Animated, {
  type SharedValue,
  FadeIn,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg from "react-native-svg";

import { fromLocal, type LatLng } from "@/features/game/geo";
import { buildLayers, type MapLayers } from "@/features/game/mapPaths";
import type { MapStyle } from "@/features/game/mapStyle";
import { cellRect, cellsCovering, cellViewBox, coverRadiusM, gridFor, rasterDensity, type Cell } from "@/features/game/mapTiles";
import type { GroundGeometry } from "@/features/game/wire";

import { GroundPaths } from "./GroundPaths";

export type LoadGround = (lat: number, lng: number, radiusM: number) => Promise<GroundGeometry>;

/** Cells kept in memory (as path strings, ~20-60 KB each): a few screens' worth of panning. */
const CACHE_MAX = 48;
/** Requests in flight at once. */
const CONCURRENCY = 4;
/** Fetched (not drawn) this far past the cover radius, so a pan finds its ground ready. */
const PREFETCH_M = 300;
/** A failed cell is asked again after this long. */
const RETRY_MS = 8000;
/** The camera is watched in steps of this many board points (and zoom in 0.05 steps). */
const VIEW_STEP = 60;
/** A density change waits for the pinch to settle, so a zoom does not redraw every tile mid-gesture. */
const DENSITY_SETTLE_MS = 250;

type Tile = { origin: LatLng; layers: MapLayers | null };

// One map on screen at a time: the cache outlives the component, so leaving
// the map and coming back does not refetch what was just there.
const cache = new Map<string, Tile>();
const inflight = new Set<string>();
const failedAt = new Map<string, number>();
const listeners = new Set<() => void>();
let queue: Cell[] = [];

function remember(key: string, tile: Tile) {
  cache.delete(key);
  cache.set(key, tile);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function touch(key: string): Tile | undefined {
  const t = cache.get(key);
  if (t) {
    cache.delete(key);
    cache.set(key, t);
  }
  return t;
}

function pump(load: LoadGround) {
  while (inflight.size < CONCURRENCY && queue.length) {
    const cell = queue.shift()!;
    if (cache.has(cell.key) || inflight.has(cell.key)) continue;
    inflight.add(cell.key);
    load(cell.centre.lat, cell.centre.lng, cell.requestM)
      .then((g) => {
        remember(cell.key, { origin: g.origin, layers: g.covered === false ? null : buildLayers(g) });
        failedAt.delete(cell.key);
      })
      .catch(() => {
        failedAt.set(cell.key, Date.now());
      })
      .finally(() => {
        inflight.delete(cell.key);
        listeners.forEach((l) => l());
        pump(load);
      });
  }
}

/** Asks for the cells (nearest first) that are neither cached, in flight, nor recently failed. */
function want(cells: Cell[], load: LoadGround) {
  const now = Date.now();
  queue = cells.filter((c) => !cache.has(c.key) && !inflight.has(c.key) && now - (failedAt.get(c.key) ?? -Infinity) > RETRY_MS);
  pump(load);
}

type Props = {
  origin: LatLng;
  /** The board's half-size, metres (board point (0,0) is extent west and north of origin). */
  extent: number;
  /** Board points per metre. */
  scale: number;
  look: MapStyle;
  load: LoadGround;
  camX: SharedValue<number>;
  camY: SharedValue<number>;
  zoom: SharedValue<number>;
  /** The screen, and where the camera's centre sits on it. */
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
};

export default function GroundTiles({ origin, extent, scale, look, load, camX, camY, zoom, width, height, anchorX, anchorY }: Props) {
  const reduceMotion = useReducedMotion();
  const loadRef = useRef(load);
  loadRef.current = load;
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);

  // The camera, quantised: centre in VIEW_STEP points, zoom rounded down to
  // 0.05 (down, so the cover radius errs wide).
  const [view, setView] = useState(() => ({ x: camX.get(), y: camY.get(), zoom: Math.floor(zoom.get() * 20) / 20 }));
  useAnimatedReaction(
    () => ({ qx: Math.round(camX.get() / VIEW_STEP), qy: Math.round(camY.get() / VIEW_STEP), qz: Math.floor(zoom.get() * 20) }),
    (now, before) => {
      if (before && now.qx === before.qx && now.qy === before.qy && now.qz === before.qz) return;
      runOnJS(setView)({ x: now.qx * VIEW_STEP, y: now.qy * VIEW_STEP, zoom: now.qz / 20 });
    },
  );

  // Drawing density follows the zoom once it has settled.
  const pixelRatio = PixelRatio.get();
  const [density, setDensity] = useState(() => rasterDensity(view.zoom, pixelRatio));
  useEffect(() => {
    const next = rasterDensity(view.zoom, pixelRatio);
    if (next === density) return;
    const t = setTimeout(() => setDensity(next), DENSITY_SETTLE_MS);
    return () => clearTimeout(t);
  }, [view.zoom, pixelRatio, density]);

  const grid = useMemo(() => gridFor(origin.lat), [origin.lat]);
  const centre = useMemo(() => fromLocal(origin, { x: view.x / scale - extent, z: extent - view.y / scale }), [origin, view.x, view.y, scale, extent]);
  const radius = coverRadiusM(width, height, anchorX, anchorY, Math.max(view.zoom, 0.05), scale);
  const cells = useMemo(() => cellsCovering(grid, centre, radius), [grid, centre, radius]);
  const ahead = useMemo(() => cellsCovering(grid, centre, radius + PREFETCH_M), [grid, centre, radius]);

  const wantedKey = ahead.map((c) => c.key).join(",");
  useEffect(() => {
    want(ahead, loadRef.current);
  }, [wantedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {cells.map((cell) => {
        const rect = cellRect(cell, origin, extent, scale);
        const tile = touch(cell.key);
        return tile ? (
          <TileView key={cell.key} cell={cell} tile={tile} rect={rect} look={look} density={density} />
        ) : (
          <Placeholder key={cell.key} rect={rect} tint={look.grid} still={reduceMotion} />
        );
      })}
    </>
  );
}

type Rect = { left: number; top: number; width: number; height: number };

const TileView = memo(
  function TileView({ cell, tile, rect, look, density }: { cell: Cell; tile: Tile; rect: Rect; look: MapStyle; density: number }) {
    // Drawn at `density` pixels a board point, then stretched to the cell
    // (react-native-svg's bitmap is the view's own size).
    const pr = Math.max(1, PixelRatio.get());
    const k = Math.max(1, pr / density);
    const w = rect.width / k;
    const h = rect.height / k;
    return (
      <Animated.View entering={TILE_IN} pointerEvents="none" style={[styles.cell, rect]}>
        <Svg
          width={w}
          height={h}
          viewBox={cellViewBox(cell, tile.origin)}
          preserveAspectRatio="none"
          style={{ position: "absolute", left: (rect.width - w) / 2, top: (rect.height - h) / 2, transform: [{ scale: k }] }}>
          <GroundPaths layers={tile.layers} look={look} />
        </Svg>
      </Animated.View>
    );
  },
  (a, b) =>
    a.cell.key === b.cell.key &&
    a.tile === b.tile &&
    a.look === b.look &&
    a.density === b.density &&
    Math.abs(a.rect.left - b.rect.left) < 0.01 &&
    Math.abs(a.rect.top - b.rect.top) < 0.01,
);

/** Where a cell is still loading: the land, breathing faintly, so it reads as "coming" rather than empty. */
function Placeholder({ rect, tint, still }: { rect: Rect; tint: string; still: boolean }) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    t.set(withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0, { duration: 700 })), -1));
  }, [still, t]);
  const style = useAnimatedStyle(() => ({ opacity: 0.25 + 0.35 * t.get() }));
  return <Animated.View pointerEvents="none" style={[styles.cell, rect, { backgroundColor: tint }, style]} />;
}

const TILE_IN = FadeIn.duration(220);

const styles = StyleSheet.create({
  cell: { position: "absolute", overflow: "hidden" },
});
