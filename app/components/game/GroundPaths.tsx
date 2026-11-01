// The ground's layers as SVG paths, in a ground answer's own metres (x east,
// y = -north): what both the single board (WorldMap Ground) and each tile
// (GroundTiles) draw inside their <Svg>.
import { Path } from "react-native-svg";

import type { MapLayers } from "@/features/game/mapPaths";
import type { MapStyle } from "@/features/game/mapStyle";

/** How far a building's wall shows below its roof, in metres: the board seen from a little south. */
const WALL_DROP_M = 3;

export function GroundPaths({ layers, look }: { layers: MapLayers | null; look: MapStyle }) {
  if (!layers) return null;
  return (
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
  );
}
