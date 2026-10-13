// The ground (GET /v1/map/ground: metres east/north of an origin) turned into
// a handful of SVG path strings, one per layer, so the map is a few <Path>s
// rather than thousands of elements. Screen y is -north.
// Pure (tested in features/game/__tests__).
import type { GroundArea, GroundGeometry, GroundWay } from "./wire.ts";

export type MapLayers = {
  water: string;
  green: string;
  paved: string;
  buildings: string;
  /** Roads by class, widest first: [width in metres, path]. */
  roads: { width: number; kind: "major" | "minor" | "path" | "rail"; d: string }[];
  waterways: { width: number; d: string }[];
  /** Half-size of the square the ground covers, in metres. */
  extent: number;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

function ring(points: number[][]): string {
  if (points.length < 2) return "";
  let d = `M${r1(points[0][0])} ${r1(-points[0][1])}`;
  for (let i = 1; i < points.length; i++) d += `L${r1(points[i][0])} ${r1(-points[i][1])}`;
  return d;
}

function areas(list: GroundArea[] | null | undefined): string {
  if (!list) return "";
  return list.map((a) => (a.p.length >= 3 ? `${ring(a.p)}Z` : "")).join("");
}

function roadClass(way: GroundWay): "major" | "minor" | "path" | "rail" {
  if (way.k === "rail") return "rail";
  if (way.k === "major_road" || way.w >= 9) return "major";
  if (way.k === "path" || way.w <= 3) return "path";
  return "minor";
}

export function buildLayers(ground: GroundGeometry): MapLayers {
  const groups = new Map<string, { width: number; kind: MapLayers["roads"][number]["kind"]; parts: string[] }>();
  for (const way of ground.roads) {
    if (way.p.length < 2) continue;
    const kind = roadClass(way);
    // Bucket widths so a few strokes cover every road.
    const width = kind === "major" ? Math.max(9, Math.min(16, Math.round(way.w / 2) * 2)) : kind === "minor" ? 6 : kind === "rail" ? 2 : 2.5;
    const key = `${kind}:${width}`;
    let g = groups.get(key);
    if (!g) {
      g = { width, kind, parts: [] };
      groups.set(key, g);
    }
    g.parts.push(ring(way.p));
  }
  const order = { major: 0, minor: 1, path: 2, rail: 3 } as const;
  const roads = [...groups.values()]
    .sort((a, b) => order[a.kind] - order[b.kind] || b.width - a.width)
    .map((g) => ({ width: g.width, kind: g.kind, d: g.parts.join("") }));
  const waterways = (ground.waterways ?? [])
    .filter((w) => w.p.length >= 2)
    .map((w) => ({ width: Math.max(3, w.w), d: ring(w.p) }));
  return {
    water: areas(ground.water),
    green: areas(ground.green),
    paved: areas(ground.paved),
    buildings: ground.buildings.map((b) => (b.p.length >= 3 ? `${ring(b.p)}Z` : "")).join(""),
    roads,
    waterways,
    extent: ground.radius_m,
  };
}
