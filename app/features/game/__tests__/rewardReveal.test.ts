// The Ranks screen's reveal: which promotion it shows, the weapon card, the
// notice that stays, and the beats (all zero under Reduce Motion).
import assert from "node:assert/strict";
import { test } from "node:test";

import { rankReveal, revealTimeline, topPromotion, weaponNotice, weaponReveal } from "../rewardReveal.ts";

test("the top promotion is the highest rank reached, whatever the order", () => {
  assert.equal(topPromotion([]), null);
  assert.equal(topPromotion(undefined), null);
  assert.equal(topPromotion(null), null);
  const p = topPromotion([
    { from: 3, to: 4, name: "Disciple" },
    { from: 2, to: 3, name: "Adept" },
  ]);
  assert.deepEqual(p, { from: 3, to: 4, name: "Disciple" });
});

test("a rank reveal names the rank and its number, and how far a double jump went", () => {
  assert.equal(rankReveal([]), null);
  const one = rankReveal([{ from: 1, to: 2, name: "Acolyte" }])!;
  assert.equal(one.kind, "rank");
  assert.equal(one.kicker, "PROMOTED");
  assert.equal(one.title, "Acolyte");
  assert.equal(one.detail, "Rank 2");
  assert.match(one.announce, /Promoted to Acolyte/);
  const two = rankReveal([
    { from: 2, to: 3, name: "Adept" },
    { from: 3, to: 4, name: "Disciple" },
  ])!;
  assert.equal(two.title, "Disciple");
  assert.equal(two.detail, "Rank 4 · up 2 ranks");
});

test("a weapon reveal shows the name and tier; a repeat buy reveals nothing", () => {
  const w = weaponReveal({ name: "Ember Blade", tier: 3, tier_label: "Rare" })!;
  assert.equal(w.kind, "weapon");
  assert.equal(w.kicker, "WEAPON UNLOCKED");
  assert.equal(w.title, "Ember Blade");
  assert.equal(w.detail, "T3 Rare");
  assert.equal(weaponReveal({ name: "Stick", tier: 1 })!.detail, "T1");
  assert.equal(weaponReveal({ name: "Stick", tier: 1 }, { repeat: true }), null);
});

test("the notice that stays reads as before", () => {
  assert.equal(weaponNotice("Ember Blade", []), "Ember Blade is yours.");
  assert.equal(
    weaponNotice("Ember Blade", [
      { from: 1, to: 2, name: "Acolyte" },
      { from: 2, to: 3, name: "Adept" },
    ]),
    "Ember Blade is yours. Promoted to Adept!",
  );
});

test("the reveal lasts about 1.5 s in order, and is instant under Reduce Motion", () => {
  const t = revealTimeline(false);
  assert.ok(t.doneAt >= 1200 && t.doneAt <= 2000);
  assert.ok(t.popAt < t.titleAt && t.titleAt < t.shineAt);
  assert.ok(t.shineAt + t.shineMs <= t.doneAt);
  assert.ok(t.glowAt + t.glowMs <= t.doneAt);
  const r = revealTimeline(true);
  for (const v of Object.values(r)) assert.equal(v, 0);
});
