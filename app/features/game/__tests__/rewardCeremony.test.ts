import assert from "node:assert/strict";
import { test } from "node:test";

import { ceremonyTimeline, dailiesDone, factionLine, ioniconForSymbol, lineAmount, standingProgress } from "../rewardCeremony.ts";

test("standing progress is the fraction of the level, full at the top", () => {
  assert.equal(standingProgress({ into_level: 30, level_span: 120, max_level: false }), 0.25);
  assert.equal(standingProgress({ into_level: 0, level_span: 0, max_level: false }), 0);
  assert.equal(standingProgress({ into_level: 5, level_span: 100, max_level: true }), 1);
  assert.equal(standingProgress({ into_level: 500, level_span: 100, max_level: false }), 1);
  assert.equal(standingProgress(null), 0);
});

test("lines appear a quarter second in, every 280 ms", () => {
  const t = ceremonyTimeline(3, 100, false);
  assert.deepEqual(t.lineAt, [250, 530, 810]);
  // The XP counts after the last line's 280 ms.
  assert.equal(t.xp[0].atMs, 250 + 280 * 3);
});

test("XP counts in 20 steps of 30 ms to the total", () => {
  const t = ceremonyTimeline(2, 87, false);
  assert.equal(t.xp.length, 20);
  assert.equal(t.xp[1].atMs - t.xp[0].atMs, 30);
  assert.equal(t.xp[19].value, 87);
  assert.equal(t.xp[0].value, Math.floor(87 / 20));
  for (let i = 1; i < 20; i++) assert.ok(t.xp[i].value >= t.xp[i - 1].value);
  assert.equal(t.xpDoneAt, t.xp[0].atMs + 600);
});

test("no level-up: the bar settles as the XP finishes", () => {
  const t = ceremonyTimeline(1, 10, false);
  assert.equal(t.level, null);
  assert.equal(t.settleAt, t.xpDoneAt);
  assert.equal(t.settleMs, 600);
});

test("level-up: bar fills in 500 ms, the overlay pops 550 ms after the count, the bar settles then", () => {
  const t = ceremonyTimeline(1, 10, true);
  assert.deepEqual(t.level, { fillAt: t.xpDoneAt, fillMs: 500, popAt: t.xpDoneAt + 550 });
  assert.equal(t.settleAt, t.xpDoneAt + 550);
});

test("no lines and no XP still has a timeline", () => {
  const t = ceremonyTimeline(0, 0, false);
  assert.deepEqual(t.lineAt, []);
  assert.equal(t.xp[19].value, 0);
});

test("a line shows XP only, never coins", () => {
  assert.equal(lineAmount({ xp: 12, factionPoints: 3 }), "+12 XP");
  assert.equal(lineAmount({ xp: 0, factionPoints: 3 }), "+3 FP");
  assert.equal(lineAmount({ xp: 0, factionPoints: 0 }), "+0 XP");
  assert.equal(factionLine(4), "+4 for your faction");
  assert.equal(factionLine(0), null);
});

test("completed dailies are named by their title", () => {
  const dailies = [
    { id: "play3", title: "Play three points" },
    { id: "walk", title: "Walk a kilometre" },
  ];
  const done = dailiesDone(["walk", "mystery"], dailies);
  assert.deepEqual(done.map((d) => d.title), ["Walk a kilometre", "Daily quest"]);
  assert.equal(done[0].daily?.id, "walk");
  assert.equal(done[1].daily, null);
  assert.deepEqual(dailiesDone(["x"], null).map((d) => d.title), ["Daily quest"]);
});

test("the server's SF Symbol maps to an Ionicon, else by kind", () => {
  assert.equal(ioniconForSymbol("rectangle.stack.fill", "codex"), "albums");
  assert.equal(ioniconForSymbol("sparkles", "x"), "sparkles");
  assert.equal(ioniconForSymbol("bolt.circle.fill", "x"), "flash");
  assert.equal(ioniconForSymbol(null, "stamps"), "ribbon");
  assert.equal(ioniconForSymbol("weird.symbol", "other"), "sparkles");
});
