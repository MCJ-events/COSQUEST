import assert from "node:assert/strict";
import { test } from "node:test";

import { LANDSCAPE_MIN_RAM_BYTES } from "../landscape.ts";
import { MOTION_HIGH_MIN_RAM_BYTES, motionTierDecision } from "../motionTier.ts";

const GB = 1024 ** 3;

test("high for 6 GB phones, mid for 4 GB, low for 3 GB", () => {
  assert.equal(motionTierDecision({ physicalMemory: 5.6 * GB }).tier, "high");
  assert.equal(motionTierDecision({ physicalMemory: 3.6 * GB }).tier, "mid");
  assert.equal(motionTierDecision({ physicalMemory: 4.9 * GB }).tier, "mid");
  assert.equal(motionTierDecision({ physicalMemory: 2.8 * GB }).tier, "low");
});

test("the config keys per tier: foot locking on the high tier only, nothing on the low tier", () => {
  assert.deepEqual(motionTierDecision({ physicalMemory: 6 * GB }).config, { motion_realism: true, foot_ik: true });
  assert.deepEqual(motionTierDecision({ physicalMemory: 3.6 * GB }).config, { motion_realism: true });
  assert.deepEqual(motionTierDecision({ physicalMemory: 2.8 * GB }).config, {});
});

test("the high tier's line is the landscape flag's", () => {
  assert.equal(MOTION_HIGH_MIN_RAM_BYTES, LANDSCAPE_MIN_RAM_BYTES);
  assert.equal(motionTierDecision({ physicalMemory: LANDSCAPE_MIN_RAM_BYTES }).tier, "high");
});

test("unknown memory keeps build 21's motion", () => {
  assert.deepEqual(motionTierDecision({ physicalMemory: 0 }), { tier: "low", reason: "ram-unknown", config: {} });
  assert.deepEqual(motionTierDecision({ physicalMemory: undefined }).config, {});
  assert.deepEqual(motionTierDecision({ physicalMemory: null }).config, {});
});

test("the env switch wins over the RAM rule", () => {
  assert.deepEqual(motionTierDecision({ physicalMemory: 8 * GB, env: "0" }).config, {});
  assert.equal(motionTierDecision({ physicalMemory: 8 * GB, env: "low" }).tier, "low");
  assert.deepEqual(motionTierDecision({ physicalMemory: 3 * GB, env: "high" }).config, { motion_realism: true, foot_ik: true });
  assert.equal(motionTierDecision({ physicalMemory: 8 * GB, env: "x" }).reason, "ram");
});
