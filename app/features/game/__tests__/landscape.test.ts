import assert from "node:assert/strict";
import { test } from "node:test";

import { hudLandscape, LANDSCAPE_MIN_RAM_BYTES, landscapeDecision, landscapePx } from "../landscape.ts";

const GB = 1024 ** 3;

test("on for 6 GB phones, off for Spark-class 3-4 GB phones", () => {
  assert.equal(landscapeDecision({ physicalMemory: 5.6 * GB }).on, true); // a 6 GB iPhone reports ~5.5 GiB
  assert.equal(landscapeDecision({ physicalMemory: 7.5 * GB }).on, true);
  assert.equal(landscapeDecision({ physicalMemory: 3.6 * GB }).on, false); // Sammy's iPhone 13
  assert.equal(landscapeDecision({ physicalMemory: 3 * GB }).reason, "low-ram");
  assert.equal(landscapeDecision({ physicalMemory: LANDSCAPE_MIN_RAM_BYTES }).on, true);
});

test("unknown memory stays portrait", () => {
  assert.deepEqual(landscapeDecision({ physicalMemory: 0 }), { on: false, reason: "ram-unknown" });
  assert.equal(landscapeDecision({ physicalMemory: undefined }).on, false);
});

test("env and the tester's switch win, in that order", () => {
  assert.equal(landscapeDecision({ physicalMemory: 3 * GB, env: "1" }).on, true);
  assert.equal(landscapeDecision({ physicalMemory: 8 * GB, env: "0" }).on, false);
  assert.equal(landscapeDecision({ physicalMemory: 8 * GB, env: "0", override: "on" }).on, true);
  assert.equal(landscapeDecision({ physicalMemory: 8 * GB, override: "off" }).on, false);
  assert.equal(landscapeDecision({ physicalMemory: 8 * GB, env: "x" }).reason, "ram");
});

test("the HUD's landscape safe area in HUD px", () => {
  // iPhone 15 Pro landscape: 852 x 393 pt, Dynamic Island 59 pt on the left, home bar 34 on the right
  const l = hudLandscape({ top: 0, left: 59, right: 59 }, 852, 393);
  const k = Math.max(1280 / 852, 720 / 393);
  assert.deepEqual(l.side, [Math.round(59 * k), Math.round(59 * k)]);
  assert.equal(l.top, 0);
  assert.equal(l.closeLeft, 69);
  // landscape-fit-32: the close button's right edge in HUD px (the hero card starts past it)
  assert.equal(l.close, Math.round((69 + 40) * k));
  assert.equal(hudLandscape({ top: 0, left: 1, right: 1 }, 0, 0).close, 0);
  // either way round
  assert.deepEqual(hudLandscape({ top: 0, left: 10, right: 0 }, 393, 852).side, [Math.round(10 * k), 0]);
  assert.deepEqual(hudLandscape({ top: 0, left: 1, right: 1 }, 0, 0).side, [0, 0]);
});

test("landscape-fit-32: the close button never covers the hero card on any iPhone sideways", () => {
  // hud.gd card_rect: x = max(side_l + 16, hud_close + 12), y 26..90 HUD px; the button is 40 pt at (closeLeft, 14)
  for (const [side, w, h] of [[0, 667, 375], [47, 844, 390], [59, 852, 393], [62, 874, 402], [59, 932, 430], [62, 956, 440]]) {
    const l = hudLandscape({ top: 0, left: side, right: side }, w, h);
    const k = Math.max(1280 / w, 720 / h);
    const cardX = Math.max(l.side[0] + 16, l.close + 12);
    assert.ok(cardX >= (l.closeLeft + 40) * k, `${w}x${h}: card ${cardX} vs close ${(l.closeLeft + 40) * k}`);
    assert.ok(cardX >= l.side[0], `${w}x${h}: card inside the safe area`);
    // the card ends well before the timer pill (hud.gd _draw_top: centre x - 137)
    const canvasW = (w / h) * 720 > 1280 ? (w / h) * 720 : 1280;
    assert.ok(cardX + 196 < canvasW / 2 - 137 - 40, `${w}x${h}: card clear of the timer`);
  }
});

test("view pixels with the long side across", () => {
  assert.deepEqual(landscapePx(393, 852, 3), [2556, 1179]);
  assert.deepEqual(landscapePx(852, 393, 3), [2556, 1179]);
});
