import assert from "node:assert/strict";
import { test } from "node:test";

import { MOTION_MID_MIN_RAM_BYTES } from "../../game/motionTier.ts";
import { HERO_IDLE, heroIdleAt, heroIdleOn } from "../heroIdle.ts";

const GIB = 1024 * 1024 * 1024;

test("the Home hero idles on 4 GB phones and up, stays still below, with memory unknown or with Reduce motion", () => {
  assert.equal(heroIdleOn({ physicalMemory: 3.6 * GIB, reduceMotion: false }), true);
  assert.equal(heroIdleOn({ physicalMemory: 5.5 * GIB, reduceMotion: false }), true);
  assert.equal(heroIdleOn({ physicalMemory: 2.8 * GIB, reduceMotion: false }), false);
  assert.equal(heroIdleOn({ physicalMemory: 0, reduceMotion: false }), false);
  assert.equal(heroIdleOn({ physicalMemory: null, reduceMotion: false }), false);
  assert.equal(heroIdleOn({ physicalMemory: 8 * GIB, reduceMotion: true }), false);
  assert.equal(heroIdleOn({ physicalMemory: MOTION_MID_MIN_RAM_BYTES, reduceMotion: false }), true);
});

test("the idle is subtle and keeps its rhythm: a breath under 2 % of the height, a sway under 1 degree", () => {
  let maxScale = 0;
  let minScale = 9;
  let maxRot = 0;
  for (let t = 0; t <= 30000; t += 25) {
    const p = heroIdleAt(t);
    maxScale = Math.max(maxScale, p.scaleY);
    minScale = Math.min(minScale, p.scaleY);
    maxRot = Math.max(maxRot, Math.abs(p.rotateDeg));
  }
  assert.ok(minScale >= 1 && maxScale <= 1.02, `scale ${minScale}..${maxScale}`);
  assert.ok(maxScale > 1.008, "the breath shows");
  assert.ok(maxRot <= 1 && maxRot > 0.4, `sway ${maxRot}`);
  // it loops: one breath and one weight shift later the pose comes back
  const a = heroIdleAt(1234);
  const b = heroIdleAt(1234 + HERO_IDLE.breathMs * HERO_IDLE.shiftMs);
  assert.ok(Math.abs(a.scaleY - b.scaleY) < 1e-9 && Math.abs(a.rotateDeg - b.rotateDeg) < 1e-6);
});
