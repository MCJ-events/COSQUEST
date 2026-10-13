// The ground turned into a few SVG paths.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildLayers } from "../mapPaths.ts";
import type { GroundGeometry } from "../wire.ts";

const ground: GroundGeometry = {
  origin: { lat: 51.5, lng: -0.12 },
  radius_m: 500,
  attribution: "© OpenStreetMap contributors",
  roads: [
    { w: 11, k: "major_road", p: [[0, 0], [10, 10]] },
    { w: 6, k: "minor_road", p: [[0, 0], [0, 20]] },
    { w: 2, k: "path", p: [[1, 1], [2, 2]] },
    { w: 6, k: "minor_road", p: [[5, 5]] },
  ],
  water: [{ p: [[0, 0], [1, 0], [1, 1]] }],
  green: [{ k: "grass", p: [[0, 0], [1, 0]] }],
  buildings: [{ h: 10, p: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
};

describe("map layers", () => {
  it("one path per layer, y flipped (north is up), degenerate shapes dropped", () => {
    const layers = buildLayers(ground);
    assert.equal(layers.buildings, "M0 0L4 0L4 -3L0 -3Z");
    assert.equal(layers.water, "M0 0L1 0L1 -1Z");
    assert.equal(layers.green, "", "a two-point area is no area");
    assert.deepEqual(layers.roads.map((r) => r.kind), ["major", "minor", "path"]);
    assert.equal(layers.roads[1].d, "M0 0L0 -20", "the one-point road is dropped");
    assert.equal(layers.extent, 500);
  });
});
