import assert from "node:assert/strict";
import { test } from "node:test";

import { LANDSCAPE_MIN_RAM_BYTES } from "../landscape.ts";
import { LOOK_HIGH_MIN_RAM_BYTES, lookTierDecision } from "../lookTier.ts";

const GB = 1024 ** 3;

test("high for 6 GB phones, mid for 4 GB, low for 3 GB", () => {
  assert.equal(lookTierDecision({ physicalMemory: 5.6 * GB }).tier, "high"); // a 6 GB iPhone reports ~5.5 GiB
  assert.equal(lookTierDecision({ physicalMemory: 7.5 * GB }).tier, "high");
  assert.equal(lookTierDecision({ physicalMemory: 3.6 * GB }).tier, "mid"); // Sammy's iPhone 13
  assert.equal(lookTierDecision({ physicalMemory: 2.8 * GB }).tier, "low");
  assert.equal(lookTierDecision({ physicalMemory: 4.9 * GB }).tier, "mid");
});

test("the high tier's line is the landscape flag's", () => {
  assert.equal(LOOK_HIGH_MIN_RAM_BYTES, LANDSCAPE_MIN_RAM_BYTES);
  assert.equal(lookTierDecision({ physicalMemory: LANDSCAPE_MIN_RAM_BYTES }).tier, "high");
});

test("unknown memory keeps the look as it was", () => {
  assert.deepEqual(lookTierDecision({ physicalMemory: 0 }), { tier: "low", reason: "ram-unknown" });
  assert.equal(lookTierDecision({ physicalMemory: undefined }).tier, "low");
  assert.equal(lookTierDecision({ physicalMemory: null }).tier, "low");
});

test("the env switch wins over the RAM rule", () => {
  assert.deepEqual(lookTierDecision({ physicalMemory: 8 * GB, env: "0" }), { tier: "low", reason: "env" });
  assert.equal(lookTierDecision({ physicalMemory: 8 * GB, env: "low" }).tier, "low");
  assert.equal(lookTierDecision({ physicalMemory: 3 * GB, env: "high" }).tier, "high");
  assert.equal(lookTierDecision({ physicalMemory: 8 * GB, env: "mid" }).tier, "mid");
  assert.equal(lookTierDecision({ physicalMemory: 8 * GB, env: "x" }).reason, "ram");
});
