import assert from "node:assert/strict";
import { test } from "node:test";

import { FACTION_HEROES, factionId, heroForFaction } from "../heroCast.ts";
import { SNAPSHOT_FACTIONS } from "../ladderSnapshot.ts";

test("every faction of the ladder has a hero, and only one", () => {
  for (const f of SNAPSHOT_FACTIONS) {
    const h = heroForFaction(f.id);
    assert.ok(h, `no hero for ${f.id}`);
    assert.equal(h.faction, f.id);
  }
  assert.equal(new Set(FACTION_HEROES.map((h) => h.key)).size, FACTION_HEROES.length);
});

test("the faction can come as an id, an object or with the other plural", () => {
  assert.equal(heroForFaction("ascendants")?.name, "Zuri");
  assert.equal(heroForFaction({ id: "Controllers" })?.name, "Tavo");
  assert.equal(heroForFaction("everborn")?.name, "Oren");
  assert.equal(heroForFaction("everborns")?.name, "Oren");
  assert.equal(factionId({ id: null }), null);
});

test("no faction, no hero: the placeholder stays", () => {
  assert.equal(heroForFaction(null), null);
  assert.equal(heroForFaction(undefined), null);
  assert.equal(heroForFaction("nobody"), null);
});
