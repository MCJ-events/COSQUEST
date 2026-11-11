import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanRealmLabel, realmName, realmReviver } from "../realmNames.ts";

test("realm ids under the brief's names, no two alike", () => {
  assert.equal(realmName("marvel"), "Icons");
  assert.equal(realmName("dc"), "Everborns");
  assert.equal(realmName("anime"), "Ascendants");
  assert.equal(realmName("movies"), "Blockbusters");
  assert.equal(realmName("gaming"), "Controllers");
  assert.equal(realmName(null), "No faction");
  assert.equal(realmName("celestials"), "Celestials");
  const names = ["anime", "marvel", "dc", "movies", "gaming"].map(realmName);
  assert.equal(new Set(names).size, 5);
});

test("old labels the server sends are replaced", () => {
  assert.equal(cleanRealmLabel("Marvel"), "Icons");
  assert.equal(cleanRealmLabel("DC"), "Everborns");
  assert.equal(cleanRealmLabel("Guardian of Marvel"), "Guardian of Icons");
  assert.equal(cleanRealmLabel("House Marvel"), "House Icons");
  assert.equal(cleanRealmLabel("Trafalgar Square"), "Trafalgar Square");
});

test("the reviver changes names, never ids", () => {
  const wire = JSON.stringify({
    faction: "marvel",
    faction_name: "Marvel",
    config: { factions: [{ id: "marvel", name: "Marvel" }, { id: "dc", name: "DC" }] },
    realm_names: { anime: "Anime", marvel: "Marvel", dc: "DC", movies: "Movies", gaming: "Gaming" },
    points: [{ id: "p1", name: "Gaming Arcade", realm: "gaming", extra: { holder: "dc", holder_name: "DC", guardian: "Guardian of DC" } }],
    lost: [{ by_faction: "movies", by_faction_name: "Movies" }],
    trial: { faction: "anime", faction_name: "Anime", name: "Guardian of Anime" },
  });
  const r = JSON.parse(wire, realmReviver);
  assert.equal(r.faction, "marvel");
  assert.equal(r.faction_name, "Icons");
  assert.deepEqual(r.config.factions, [{ id: "marvel", name: "Icons" }, { id: "dc", name: "Everborns" }]);
  assert.deepEqual(r.realm_names, { anime: "Ascendants", marvel: "Icons", dc: "Everborns", movies: "Blockbusters", gaming: "Controllers" });
  assert.equal(r.points[0].name, "Gaming Arcade");
  assert.equal(r.points[0].realm, "gaming");
  assert.equal(r.points[0].extra.holder, "dc");
  assert.equal(r.points[0].extra.holder_name, "Everborns");
  assert.equal(r.points[0].extra.guardian, "Guardian of Everborns");
  assert.equal(r.lost[0].by_faction_name, "Blockbusters");
  assert.equal(r.trial.faction_name, "Ascendants");
  assert.equal(r.trial.name, "Guardian of Ascendants");
});
