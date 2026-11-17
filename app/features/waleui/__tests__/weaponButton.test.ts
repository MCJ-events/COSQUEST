// The left button of Wale's weapon page (build 23): a real claim or purchase where the
// server offers one, a plain label everywhere else.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { LadderWeapon } from "../../game/progression.ts";
import { buildArmory, weaponButton } from "../armory.ts";

const w = (over: Partial<LadderWeapon>): LadderWeapon => ({ id: "w1", faction: "icons", tier: 1, name: "Void Kunai", cc_price: 250, state: "available", ...over });

test("weapon button: owned weapons only say so", () => {
  assert.deepEqual(weaponButton(w({ state: "owned" }), true, "coins", true), { kind: "equipped", label: "EQUIPPED" });
  assert.deepEqual(weaponButton(w({ state: "owned" }), false, "coins", true), { kind: "owned", label: "OWNED" });
});

test("weapon button: a locked weapon cannot be bought", () => {
  assert.equal(weaponButton(w({ state: "locked" }), false, "coins", true).kind, "locked");
});

test("weapon button: an unlocked weapon is claimed free or bought for its price", () => {
  assert.deepEqual(weaponButton(w({}), false, "stub", true), { kind: "buy", label: "CLAIM", price: null });
  assert.deepEqual(weaponButton(w({ cc_price: 1250 }), false, "coins", true), { kind: "buy", label: "BUY 1 250", price: 1250 });
});

test("weapon button: no price yet, or the shop closed, is not a button", () => {
  assert.equal(weaponButton(w({ cc_price: null }), false, "coins", true).kind, "soon");
  assert.equal(weaponButton(w({}), false, "disabled", true).kind, "soon");
});

test("weapon button: the bundled copy of the ladder never offers a purchase", () => {
  assert.equal(weaponButton(w({}), false, "coins", false).kind, "locked");
  const a = buildArmory(null, "icons");
  assert.ok([...a.owned, ...a.notOwned].every((x) => x.button.kind !== "buy"));
});

test("armory: the server's ladder carries the button for each weapon", () => {
  const ladder = [w({ id: "a", tier: 0, state: "owned", starter: true }), w({ id: "b", tier: 1 }), w({ id: "c", tier: 2, state: "locked" })];
  const a = buildArmory({ faction: "icons", faction_name: "Icons", ladder, purchase_mode: "coins" }, null);
  assert.equal(a.owned[0].button.kind, "equipped");
  assert.deepEqual(a.notOwned.map((x) => x.button.kind), ["buy", "locked"]);
});
