import assert from "node:assert/strict";
import { test } from "node:test";

import { actionLabel, NOT_OURS, pickAction, pickCards, preselect } from "../factionPick.ts";

// The six factions as production's /v1/progression/config sends them (13 Nov 2026).
const PROD = [
  { id: "ascendants", name: "Ascendants", realm: "Anime", themes: "Energy, transformation, speed, aura, elemental powers", placeholder: false, active: true, sort: 0 },
  { id: "controllers", name: "Controllers", realm: "Gaming", themes: "Precision, combat, critical hits, defense, technology", placeholder: false, active: true, sort: 1 },
  { id: "icons", name: "Icons", realm: "Comic book", themes: "Strength, genius, mutation, superhuman abilities", placeholder: false, active: true, sort: 2 },
  { id: "everborns", name: "Everborns", realm: "Fantasy / magic", themes: "Magic, ancient bloodlines, mystical essence", placeholder: false, active: true, sort: 3 },
  { id: "celestials", name: "Celestials", realm: "Space / sci-fi", themes: "Cosmic evolution, advanced technology", placeholder: false, active: true, sort: 4 },
  { id: "blockbusters", name: "Blockbusters", realm: "Movies", themes: "Not finalized; identity pending team input", placeholder: true, active: true, sort: 5 },
];

test("six original factions, in the server's order, with no other company's brands or genres on screen", () => {
  const cards = pickCards(PROD);
  assert.deepEqual(cards.map((c) => c.name), ["Ascendants", "Controllers", "Icons", "Everborns", "Celestials", "Blockbusters"]);
  for (const c of cards) {
    assert.doesNotMatch(`${c.name} ${c.line}`, NOT_OURS);
  }
  assert.doesNotMatch(JSON.stringify(cards), /Anime|Comic book|Marvel|\bDC\b/);
});

test("a faction the server has not finished is shown as coming soon and cannot be picked", () => {
  const bb = pickCards(PROD).find((c) => c.id === "blockbusters")!;
  assert.equal(bb.soon, true);
  assert.equal(bb.line, "Coming soon");
  assert.equal(preselect(pickCards(PROD), null, "blockbusters"), null);
});

test("an inactive faction is left out", () => {
  assert.equal(pickCards([...PROD.slice(0, 5), { ...PROD[5], active: false }]).length, 5);
});

test("a theme line that names another company's brand is not shown", () => {
  const [c] = pickCards([{ id: "x", name: "X", themes: "Marvel heroes", sort: 0 }]);
  assert.equal(c.line, "");
});

test("preselect: the joined faction, then the one being joined, then the chat app's choice", () => {
  const cards = pickCards(PROD);
  assert.equal(preselect(cards, { faction: "icons", pending: null }, "celestials"), "icons");
  assert.equal(preselect(cards, { faction: null, pending: { faction: "everborns" } }, "celestials"), "everborns");
  assert.equal(preselect(cards, { faction: null, pending: null }, "celestials"), "celestials");
  assert.equal(preselect(cards, null, { id: "Controllers" }), "controllers");
  assert.equal(preselect(cards, null, null), null);
  assert.equal(preselect(cards, null, "nonsense"), null);
});

test("the main button: join, resume the entry test, or see the rank once in", () => {
  assert.deepEqual(pickAction("icons", null), { kind: "join", faction: "icons" });
  assert.deepEqual(pickAction("icons", { faction: null, pending: { faction: "icons" } }), { kind: "test", faction: "icons" });
  assert.deepEqual(pickAction("celestials", { faction: null, pending: { faction: "icons" } }), { kind: "join", faction: "celestials" });
  assert.deepEqual(pickAction("icons", { faction: "icons" }), { kind: "ranks" });
  assert.deepEqual(pickAction(null, null), { kind: "none" });
  assert.equal(actionLabel({ kind: "join", faction: "icons" }, "Icons"), "JOIN ICONS");
  assert.equal(actionLabel({ kind: "test", faction: "icons" }, "Icons"), "TAKE THE ENTRY TEST");
  assert.equal(actionLabel({ kind: "ranks" }, null), "SEE YOUR RANK");
});
