import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { CHARACTERS, FORGE_CHARACTERS, characterByKey, characterLine, parsePick, pickConfig, playerCharacter, shareLine } from "../characters.ts";
import { FACTION_HEROES } from "../heroCast.ts";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("the roster is the six faction heroes and the playable Forge characters, each key once", () => {
  assert.equal(CHARACTERS.length, FACTION_HEROES.length + FORGE_CHARACTERS.length);
  assert.equal(new Set(CHARACTERS.map((c) => c.key)).size, CHARACTERS.length);
  assert.ok(characterByKey("forge_courier"));
  // made but not playable yet (their rigs tear in the clips): never offered
  for (const k of ["forge_bram", "forge_mei", "forge_catboy"]) assert.equal(characterByKey(k), null, k);
});

test("no pick means the faction hero; a pick wins over the faction", () => {
  assert.equal(playerCharacter(null, "ascendants")?.name, "Zuri");
  assert.equal(playerCharacter("", { id: "icons" })?.name, "Imani");
  assert.equal(playerCharacter("forge_courier", "ascendants")?.name, "Courier");
  assert.equal(playerCharacter("celestials_lyra", "icons")?.name, "Lyra");
  assert.equal(playerCharacter(null, null), null);
  assert.equal(playerCharacter("forge_courier", null)?.kind, "forge");
});

test("a stored pick this build does not know is dropped, never passed on", () => {
  assert.equal(parsePick("forge_courier"), "forge_courier");
  assert.equal(parsePick(" icons_imani "), "icons_imani");
  for (const raw of [null, undefined, "", "nobody", "forge_mei", "../x", "FORGE_COURIER", "a".repeat(80)]) assert.equal(parsePick(raw), null, String(raw));
  assert.equal(playerCharacter("nobody", "icons")?.name, "Imani");
  assert.deepEqual(pickConfig("nobody"), {});
  assert.deepEqual(pickConfig(null), {});
  assert.deepEqual(pickConfig("forge_courier"), { hero_pick: "forge_courier" });
});

test("lines under the name and with the share card", () => {
  assert.equal(characterLine(characterByKey("everborn_oren")!), "Everborns");
  assert.equal(characterLine(characterByKey("ascendants_zuri")!), "Ascendants");
  assert.equal(characterLine(characterByKey("forge_courier")!), "Forge character");
  assert.equal(shareLine(characterByKey("forge_courier")!, null), "I play as Courier in CosQuest.");
  assert.equal(shareLine(characterByKey("icons_imani")!, "https://x.test/play"), "I play as Imani in CosQuest. https://x.test/play");
});

test("every character has its 2D art (card, portrait, share card) and is wired in characterArt.ts", () => {
  const art = readFileSync(join(APP, "components", "waleui", "characterArt.ts"), "utf8");
  for (const c of CHARACTERS) {
    for (const f of [`${c.key}_card.png`, `${c.key}_portrait.png`, `${c.key}_share.jpg`]) {
      assert.ok(existsSync(join(APP, "assets", "images", "characters", f)), f);
      assert.ok(art.includes(`characters/${f}`), `characterArt.ts misses ${f}`);
    }
  }
});

test("the game ships the same playable Forge characters (fight.gd FORGE_CAST) with both detail levels", () => {
  const gd = readFileSync(join(APP, "game3d", "fight.gd"), "utf8");
  const m = gd.match(/const FORGE_CAST: Array\[String\] = \[([^\]]*)\]/);
  assert.ok(m, "FORGE_CAST not found in fight.gd");
  const keys = [...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]).sort();
  assert.deepEqual(keys, FORGE_CHARACTERS.map((c) => c.key).sort());
  for (const k of keys) {
    for (const l of [0, 1]) assert.ok(existsSync(join(APP, "game3d", "cast", "heroes", `${k}_lod${l}.glb`)), `${k}_lod${l}.glb`);
    assert.ok(existsSync(join(APP, "game3d", "anim", `${k}.glb`)), `anim/${k}.glb`);
  }
});
