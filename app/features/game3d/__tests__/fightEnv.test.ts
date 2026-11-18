import assert from "node:assert/strict";
import { test } from "node:test";

import { envFightsOn, fightEnvConfig, fightEnvFiles, fightEnvLod, pieceLine, pointPiece } from "../fightEnv.ts";

const lod = (n: number, bytes: number) => ({
  lod: n,
  glb: { file: `shrine__lod${n}.glb`, url: `/v1/catalogue/files/e1/2/shrine__lod${n}.glb`, bytes, sha256: `sha${n}` },
  usdz: null,
});

const shrine = {
  id: "e1",
  type: "environment",
  name: "Lantern Shrine",
  version: 2,
  lods: [lod(0, 2_239_356), lod(1, 715_212), lod(2, 208_544)],
  thumbnail: { file: "shrine__thumb.png", url: "/v1/catalogue/files/e1/2/shrine__thumb.png", sha256: "t" },
  height_m: null,
  gameplay: { placement: "ground", radius_m: 12 },
} as const;
const station = { ...shrine, id: "s1", type: "station", name: "Forge Anvil" } as const;
const entries = [shrine, station] as unknown as Parameters<typeof pointPiece>[1];

test("the flag is the server's: on only when /me says env_fights true", () => {
  assert.equal(envFightsOn(null), false);
  assert.equal(envFightsOn({}), false);
  assert.equal(envFightsOn({ features: { forge_world: { on: true } } }), false, "a server before forge-env-28 sends no key");
  assert.equal(envFightsOn({ features: { forge_world: { on: true, env_fights: false } } }), false);
  assert.equal(envFightsOn({ features: { forge_world: { on: true, env_fights: "yes" } } }), false);
  assert.equal(envFightsOn({ features: { forge_world: { on: true, env_fights: true } } }), true);
  assert.equal(envFightsOn({ features: { forge_world: [] } }), false);
});

test("a point's piece: only a published environment the point names, only with the flag", () => {
  const dressed = { id: "p1", forge: { environment: { element_id: "e1", version: 2 } } };
  assert.equal(pointPiece(dressed, entries, true)?.name, "Lantern Shrine");
  assert.equal(pointPiece(dressed, entries, false), null, "flag off: build 27's look");
  assert.equal(pointPiece({ id: "p2" }, entries, true), null, "an undressed point");
  assert.equal(pointPiece({ forge: { environment: { element_id: "gone" } } }, entries, true), null, "unpublished since");
  assert.equal(pointPiece({ forge: { environment: { element_id: "s1" } } }, entries, true), null, "not an environment");
  assert.equal(pointPiece(null, entries, true), null);
});

test("LOD by look tier: high 1, mid 2, low none (the card)", () => {
  assert.equal(fightEnvLod("high"), 1);
  assert.equal(fightEnvLod("mid"), 2);
  assert.equal(fightEnvLod("low"), null);
  const high = fightEnvFiles(shrine as never, "high");
  assert.equal(high.glb?.file, "shrine__lod1.glb");
  assert.equal(high.thumb?.file, "shrine__thumb.png");
  assert.equal(fightEnvFiles(shrine as never, "mid").glb?.file, "shrine__lod2.glb");
  const low = fightEnvFiles(shrine as never, "low");
  assert.equal(low.glb, null, "the low tier downloads no model");
  assert.equal(low.thumb?.url, "/v1/catalogue/files/e1/2/shrine__thumb.png");
  // a piece with only its heaviest LOD: the nearest there is (Godot's size check then decides)
  const only0 = { ...shrine, lods: [lod(0, 2_239_356)] };
  assert.equal(fightEnvFiles(only0 as never, "mid").glb?.file, "shrine__lod0.glb");
  assert.deepEqual(fightEnvFiles({ lods: [], thumbnail: null } as never, "high"), { glb: null, thumb: null });
});

test("the config keys: none at all when nothing is on the phone", () => {
  assert.equal(fightEnvConfig(shrine as never, { glb: "", thumb: "" }), null);
  assert.deepEqual(fightEnvConfig(shrine as never, { glb: "/c/e1/2/shrine__lod1.glb", thumb: "/c/e1/2/shrine__thumb.png" }), {
    env_name: "Lantern Shrine",
    env_placement: "ground",
    env_glb: "/c/e1/2/shrine__lod1.glb",
    env_thumb: "/c/e1/2/shrine__thumb.png",
  });
  assert.deepEqual(fightEnvConfig({ ...shrine, height_m: 1.5, gameplay: { placement: "backdrop" } } as never, { glb: "", thumb: "/t.png" }), {
    env_name: "Lantern Shrine",
    env_placement: "backdrop",
    env_thumb: "/t.png",
    env_height_m: 1.5,
  });
  assert.equal(fightEnvConfig({ ...shrine, gameplay: {} } as never, { glb: "/a.glb", thumb: "" })?.env_placement, "ground");
});

test("the card line", () => {
  assert.equal(pieceLine("Lantern Shrine", false), "Lantern Shrine stands here");
  assert.equal(pieceLine("Lantern Shrine", true), "Lantern Shrine stands at this fight");
});
