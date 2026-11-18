import assert from "node:assert/strict";
import { test } from "node:test";

import { badgeMetal, rankOf, rankSpoken, toRoman } from "../roman.ts";

test("ranks I to X", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(toRoman),
    ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"],
  );
});

test("larger numbers and edges", () => {
  assert.equal(toRoman(14), "XIV");
  assert.equal(toRoman(40), "XL");
  assert.equal(toRoman(1994), "MCMXCIV");
  assert.equal(toRoman(3999), "MMMCMXCIX");
  assert.equal(toRoman(0), "0");
  assert.equal(toRoman(4000), "4000");
  assert.equal(toRoman(null), "?");
  assert.equal(toRoman(Number.NaN), "?");
  assert.equal(toRoman(4.7), "IV");
});

test("kicker and spoken forms", () => {
  assert.equal(rankOf(4, 10), "RANK IV OF X");
  assert.equal(rankOf(null, 10), "RANK I OF X");
  assert.equal(rankSpoken(4, 10), "rank 4 of 10");
  assert.equal(rankSpoken(9), "rank 9");
});

test("a metal per rank, clamped", () => {
  const all = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => JSON.stringify(badgeMetal(r))));
  assert.equal(all.size, 10);
  assert.deepEqual(badgeMetal(0), badgeMetal(1));
  assert.deepEqual(badgeMetal(12), badgeMetal(10));
  assert.deepEqual(badgeMetal(undefined), badgeMetal(1));
});
