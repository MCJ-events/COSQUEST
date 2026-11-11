import assert from "node:assert/strict";
import { test } from "node:test";

import { armoryFooter, buildArmory, complexityForTier, countLabel, equippedWeaponId, findWeapon, spaced, statusText, xpRatio } from "../armory.ts";
import { waleUiFor } from "../flag.ts";
import { createSheetIntent } from "../intent.ts";
import { SNAPSHOT_FACTIONS, SNAPSHOT_RANKS, SNAPSHOT_WEAPONS } from "../ladderSnapshot.ts";
import {
  DEFAULT_LOOK,
  DEFAULT_WARDROBE,
  FACES,
  LOOK_SIZES,
  activeLook,
  cleanLook,
  equippedLine,
  lookSummary,
  parseWardrobe,
  pickSlot,
  randomLook,
  serializeWardrobe,
  setPart,
  withActiveLook,
} from "../look.ts";

test("flag: 1 and 0 win, unset follows a dev or test build", () => {
  assert.equal(waleUiFor("1", undefined, false), true);
  assert.equal(waleUiFor("0", "1", true), false);
  assert.equal(waleUiFor(undefined, "1", false), true);
  assert.equal(waleUiFor(undefined, undefined, true), true);
  assert.equal(waleUiFor(undefined, undefined, false), false);
  assert.equal(waleUiFor("", "0", false), false);
});

test("snapshot: six factions, ten ranks, ten weapons each, real names", () => {
  assert.equal(SNAPSHOT_FACTIONS.length, 6);
  assert.equal(SNAPSHOT_RANKS.length, 10);
  for (const f of SNAPSHOT_FACTIONS) assert.equal(SNAPSHOT_WEAPONS.filter((w) => w.faction === f.id).length, 10);
  assert.equal(SNAPSHOT_WEAPONS.find((w) => w.id === "ascendants-t0")?.name, "Ember Dagger");
  // none of the Figma mock-up names
  for (const mock of ["Speedshot", "Hornbow", "Head Banger", "Storm Weaver"]) assert.ok(!SNAPSHOT_WEAPONS.some((w) => w.name.toLowerCase() === mock.toLowerCase()));
});

test("armory: offline shows the snapshot with only the starter owned", () => {
  const a = buildArmory(null, "controllers");
  assert.equal(a.source, "snapshot");
  assert.equal(a.factionId, "controllers");
  assert.equal(a.owned.length, 1);
  assert.equal(a.notOwned.length, 9);
  assert.equal(a.owned[0].equipped, true);
  assert.equal(armoryFooter(a), "1 owned · 10 weapons");
  assert.equal(buildArmory(null, "nonsense").factionId, "ascendants");
});

test("armory: the server's ladder wins and keeps its states", () => {
  const ladder = SNAPSHOT_WEAPONS.filter((w) => w.faction === "icons").map((w) => ({ ...w, state: w.tier < 2 ? ("owned" as const) : w.tier === 2 ? ("available" as const) : ("locked" as const), unlocks_at_rank: w.tier + 1 }));
  const a = buildArmory({ faction: "icons", faction_name: "Icons", ladder }, "ascendants");
  assert.equal(a.source, "server");
  assert.equal(a.owned.length, 2);
  assert.equal(a.owned[1].equipped, true);
  assert.equal(a.notOwned[0].status, "READY TO UNLOCK");
  assert.equal(a.notOwned[1].status, "UNLOCKS AT RANK 4");
  assert.equal(findWeapon(a, "icons-t5")?.tier, 5);
  assert.equal(findWeapon(a, "nope")?.id, "icons-t1");
});

test("armory: small helpers", () => {
  assert.deepEqual([0, 1, 2, 5, 8, 9].map(complexityForTier), [1, 1, 2, 3, 5, 5]);
  assert.equal(statusText("owned", {}), "OWNED");
  assert.equal(statusText("locked", {}), "NOT OWNED");
  assert.equal(equippedWeaponId([]), null);
  assert.equal(countLabel(1), "1 weapon");
  assert.equal(countLabel(12), "12 weapons");
  assert.equal(spaced(14220), "14 220");
  assert.equal(spaced(null), "0");
  assert.equal(xpRatio(25044, 30000) > 0.83, true);
  assert.equal(xpRatio(5, 0), 0);
  assert.equal(xpRatio(50, 10), 1);
});

test("look: one character with eight face variants, same lists for every faction", () => {
  assert.equal(FACES.length, 8);
  assert.ok(FACES.every((f) => f.startsWith("Variant")));
  assert.deepEqual(Object.keys(LOOK_SIZES).sort(), ["eye", "face", "hair", "hairColor", "headwear", "outfit", "skin"]);
});

test("look: set, clean, randomise", () => {
  assert.equal(setPart(DEFAULT_LOOK, "hair", 5).hair, 5);
  assert.equal(setPart(DEFAULT_LOOK, "hair", 99).hair, DEFAULT_LOOK.hair);
  assert.deepEqual(cleanLook({ face: 7, skin: -1, eye: "x" }), { ...DEFAULT_LOOK, face: 7 });
  const top = randomLook(() => 0.9999);
  for (const k of Object.keys(LOOK_SIZES) as (keyof typeof LOOK_SIZES)[]) assert.equal(top[k], LOOK_SIZES[k] - 1);
  assert.equal(randomLook(() => 0).face, 0);
  assert.ok(lookSummary(DEFAULT_LOOK).includes("Variant 1"));
  assert.equal(equippedLine("Headwear", 0), "Headwear 1 equipped");
});

test("look: two style slots survive a save and a broken save", () => {
  let w = withActiveLook(DEFAULT_WARDROBE, setPart(DEFAULT_LOOK, "outfit", 2));
  w = pickSlot(w, 1);
  w = withActiveLook(w, setPart(DEFAULT_LOOK, "headwear", 4));
  const back = parseWardrobe(serializeWardrobe(w));
  assert.deepEqual(back, w);
  assert.equal(activeLook(back).headwear, 4);
  assert.equal(back.slots[0].outfit, 2);
  assert.deepEqual(parseWardrobe("{not json"), DEFAULT_WARDROBE);
  assert.deepEqual(parseWardrobe(null), DEFAULT_WARDROBE);
});

test("intent: one request, taken once", () => {
  const i = createSheetIntent();
  let calls = 0;
  const off = i.subscribe(() => calls++);
  i.request("friends");
  i.request("coins");
  assert.equal(calls, 2);
  assert.equal(i.take(), "coins");
  assert.equal(i.take(), null);
  off();
  i.request("war");
  assert.equal(calls, 2);
});
