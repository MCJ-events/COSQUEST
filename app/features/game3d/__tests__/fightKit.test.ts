import assert from "node:assert/strict";
import { test } from "node:test";

import { parseForgeEntry } from "../../game/forgeWorld.ts";
import { fetchFightKit, fighterFiles, kitFolder, kitMemo, kitModel, NO_KIT_RETRY_MS, parseFightKit } from "../fightKit.ts";

const K = "0123456789abcdef";
const f = (file: string, sha = "a".repeat(64)) => ({ file, url: `/v1/catalogue/fightkits/e/1/${K}/${file}`, bytes: 1000, sha256: sha });
const RAW = {
  v: 1,
  kit: K,
  key: "fk_courier",
  anim: { glb: f("anim.glb"), json: f("anim.json") },
  lods: [{ lod: 2, glb: f("lod2.glb") }, { lod: 0, glb: f("lod0.glb") }, { lod: 1, glb: f("lod1.glb") }],
};

test("a kit parses, its LODs in order", () => {
  const k = parseFightKit(RAW)!;
  assert.equal(k.kit, K);
  assert.equal(k.key, "fk_courier");
  assert.deepEqual(k.lods.map((l) => l.lod), [0, 1, 2]);
  assert.equal(k.anim.json.file, "anim.json");
  assert.equal(kitFolder(k), `fight-${K}`);
});

test("anything this build can't use is no kit", () => {
  for (const bad of [
    null,
    "kit",
    { ...RAW, v: 2 },
    { ...RAW, kit: "../../etc" },
    { ...RAW, kit: "ABCDEF0123456789" },
    { ...RAW, anim: { glb: f("anim.glb") } },
    { ...RAW, anim: { glb: f("anim.glb"), json: { ...f("anim.json"), sha256: null } } },
    // a file named for somewhere else in the cache
    { ...RAW, anim: { glb: f("../lod0.glb"), json: f("anim.json") } },
  ]) {
    assert.equal(parseFightKit(bad), null, JSON.stringify(bad));
  }
  // bad LODs are dropped, the library stays
  const k = parseFightKit({ ...RAW, lods: [{ lod: 5, glb: f("lod5.glb") }, { lod: 1, glb: f("lod0.glb") }, { lod: 1, glb: f("lod1.glb") }] })!;
  assert.deepEqual(k.lods.map((l) => l.glb.file), ["lod1.glb"]);
});

test("the kit's model follows the fight's LOD like the published one", () => {
  const k = parseFightKit(RAW)!;
  assert.equal(kitModel(k, 1)!.file, "lod1.glb");
  const only2 = parseFightKit({ ...RAW, lods: [{ lod: 2, glb: f("lod2.glb") }] })!;
  assert.equal(kitModel(only2, 0)!.lod, 2);
  const only0 = parseFightKit({ ...RAW, lods: [{ lod: 0, glb: f("lod0.glb") }] })!;
  assert.equal(kitModel(only0, 2)!.lod, 0);
  assert.equal(kitModel(parseFightKit({ ...RAW, lods: [] })!, 1), null);
});

test("what a fighter loads: no kit = as before; a kit's model replaces the static one", () => {
  const pub = { file: "courier__lod1.glb", url: "/v1/catalogue/files/e/1/courier__lod1.glb", lod: 1 };
  assert.deepEqual(fighterFiles(pub, null, 1), { model: pub, fromKit: false, anim: null });
  const k = parseFightKit(RAW)!;
  const withLods = fighterFiles(pub, k, 1);
  assert.equal(withLods.model!.file, "lod1.glb");
  assert.equal(withLods.fromKit, true);
  assert.equal(withLods.anim!.glb.file, "anim.glb");
  // a kit for an already rigged version: the published file with the library
  const libOnly = fighterFiles(pub, parseFightKit({ ...RAW, lods: [] }), 1);
  assert.deepEqual([libOnly.model, libOnly.fromKit, libOnly.anim?.json.file], [pub, false, "anim.json"]);
  // no published file and no kit model: nothing to put the library on
  assert.equal(fighterFiles(null, parseFightKit({ ...RAW, lods: [] }), 1).anim, null);
});

test("the catalogue entry carries the kit for characters only", () => {
  const base = { id: "e", type: "character", name: "Courier", version: 1, rarity: "common", files: [], fight: RAW };
  assert.equal(parseForgeEntry(base)!.fight!.kit, K);
  assert.equal(parseForgeEntry({ ...base, fight: undefined })!.fight, null, "an old server sends none");
  assert.equal(parseForgeEntry({ ...base, type: "weapon" })!.fight, null);
});

test("the kit route: a 404 or a bad answer is no kit; 'none' is asked again later", async () => {
  const calls: string[] = [];
  const client = {
    request: async (_m: string, path: string) => {
      calls.push(path);
      if (path.endsWith("/2")) throw new Error("404");
      return RAW;
    },
  } as never;
  assert.equal((await fetchFightKit(client, "e", 1))!.kit, K);
  assert.equal(await fetchFightKit(client, "e", 2), null);
  assert.equal(calls[0], "v1/catalogue/fightkits/e/1");
  let now = 0;
  const memo = kitMemo(() => now);
  assert.equal(memo.get("e", 1), undefined);
  memo.set("e", 1, null);
  assert.equal(memo.get("e", 1), null);
  now = NO_KIT_RETRY_MS;
  assert.equal(memo.get("e", 1), undefined, "a kit attached after the publish is found");
  memo.set("e", 1, parseFightKit(RAW));
  now = 10 * NO_KIT_RETRY_MS;
  assert.equal(memo.get("e", 1)!.kit, K);
});
