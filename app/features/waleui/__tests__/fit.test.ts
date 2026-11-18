import assert from "node:assert/strict";
import { test } from "node:test";

import { makeSampleQuests } from "../../../constants/sampleQuests.ts";
import { fitFrame, HOME_HERO, HOME_QUEST_Y, HOME_TOP, homeStretch, pinnedBarTop } from "../fit.ts";

// The room under the status bar and above the floating tab bar (constants/tabBar.ts: 68 tall, max(24, inset + 8) up).
const tabsBottom = (inset: number) => Math.max(24, inset + 8) + 68;
const PHONES = {
  "iPhone SE": { width: 375, height: 667, top: 20, bottom: tabsBottom(0) },
  "iPhone 15": { width: 393, height: 852, top: 59, bottom: tabsBottom(34) },
  "iPhone 15 Pro Max": { width: 430, height: 932, top: 59, bottom: tabsBottom(34) },
  "small Android": { width: 360, height: 640, top: 24, bottom: tabsBottom(0) },
};
const HOME = { frameW: 403, frameH: 575 };

test("fit: at his frame's own size nothing changes (scale 1, no extra, no offset)", () => {
  const f = fitFrame({ width: 403, height: 575, top: 0, bottom: 0, ...HOME });
  assert.equal(f.scale, 1);
  assert.equal(f.extra, 0);
  assert.equal(f.left, 0);
});

test("fit: on every phone the Home canvas fills the room exactly, full width, no empty band", () => {
  for (const [name, p] of Object.entries(PHONES)) {
    const f = fitFrame({ ...p, ...HOME });
    const room = p.height - p.top - p.bottom;
    assert.ok(Math.abs((HOME.frameH + f.extra) * f.scale - room) < 0.01, `${name}: canvas ${(HOME.frameH + f.extra) * f.scale} vs room ${room}`);
    assert.ok(Math.abs(f.scale - p.width / HOME.frameW) < 1e-9, `${name}: full width`);
    assert.equal(f.left, 0);
  }
  // the tall phone of the report: about 125 frame px of room that build 26 left empty
  const i15 = fitFrame({ ...PHONES["iPhone 15"], ...HOME });
  assert.ok(i15.extra > 120 && i15.extra < 130, String(i15.extra));
});

test("fit: a phone too short for the frame scales it to the height and centres it (nothing cut, nothing scrolls)", () => {
  // a small Android with the three-button bar (48 pt inset)
  const p = { width: 360, height: 640, top: 24, bottom: tabsBottom(48) };
  const f = fitFrame({ ...p, ...HOME });
  assert.equal(f.extra, 0);
  assert.ok(Math.abs(HOME.frameH * f.scale - (p.height - p.top - p.bottom)) < 0.01);
  assert.ok(HOME.frameW * f.scale < p.width);
  assert.ok(Math.abs(f.left * 2 + HOME.frameW * f.scale - p.width) < 0.01);
});

test("Home stretch: with no extra every block is where his frame has it", () => {
  const s = homeStretch(0);
  assert.equal(s.f, 1);
  assert.deepEqual(s.hero, { x: HOME_HERO.x, y: HOME_HERO.y, w: HOME_HERO.w, h: HOME_HERO.h });
  assert.deepEqual(s.web, { x: 1, y: 220, w: 254, h: 278 });
  assert.equal(s.rightDy, 0);
  assert.equal(s.questY, HOME_QUEST_Y);
});

test("Home stretch: ENTER QUEST keeps his 13 px over the bottom, the header stays, the hero stands his 14 px (grown with the band) above the button", () => {
  for (const extra of [12, 22, 125, 140]) {
    const s = homeStretch(extra);
    assert.equal(575 + extra - (s.questY + 60), 13);
    assert.equal(s.y(HOME_TOP), HOME_TOP);
    assert.equal(s.y(40), 40);
    assert.ok(Math.abs(s.questY - (s.hero.y + s.hero.h) - 14.25 * s.f) < 1e-9);
  }
});

test("Home stretch: the hero grows with the room but never reaches the right-hand panel (x 256) or the left edge", () => {
  for (const extra of [0, 50, 125, 140, 400]) {
    const s = homeStretch(extra);
    assert.ok(s.hero.x + s.hero.w <= 256 + 1e-9, `extra ${extra}: right edge ${s.hero.x + s.hero.w}`);
    assert.ok(s.hero.x >= 91);
    assert.ok(s.hero.y >= HOME_TOP, `extra ${extra}: hero top ${s.hero.y} under the header`);
    // the panel stays between the rank badge (bottom 202) and ENTER QUEST
    assert.ok(208 + s.rightDy >= 202 && 441 + s.rightDy <= s.questY);
  }
  // iPhone 15 room: the hero is about 29 % taller than build 26 drew it
  const s = homeStretch(125);
  assert.ok(s.f > 1.28 && s.f < 1.3, String(s.f));
});

test("pinned bar: on every phone the customiser's DONE bar is on screen; at his frame's size it is where he drew it", () => {
  // Faces frame 430 x 932, footer band from 876 (56 tall)
  for (const [name, p] of Object.entries({ "iPhone SE": [375, 667, 20, 0], "iPhone 15": [393, 852, 59, 34], "iPhone 15 Pro Max": [430, 932, 59, 34], "small Android": [360, 640, 24, 0] })) {
    const [w, h, top, bottom] = p;
    const scale = w / 430;
    const barTop = pinnedBarTop({ screenH: h, top, bottom, scale, barY: 876, barH: 56 });
    assert.ok(barTop + 56 * scale <= h - bottom + 1e-9, `${name}: bar bottom ${barTop + 56 * scale} over the home bar`);
    assert.ok(barTop < top + 876 * scale, `${name}: the frame does not fit, so the bar is pinned`);
  }
  assert.equal(pinnedBarTop({ screenH: 932, top: 0, bottom: 0, scale: 1, barY: 876, barH: 56 }), 876);
  // a screen taller than the frame: the bar follows the frame (no gap above it)
  assert.equal(pinnedBarTop({ screenH: 1000, top: 0, bottom: 0, scale: 1, barY: 760, barH: 120 }), 760);
});

test("demo quests: no title names Marvel, DC, anime or another company's franchise", () => {
  const banned = /marvel|\bdc\b|anime|manga|naruto|pok[eé]mon|star wars|disney|pixar|nintendo|zelda|mario|sonic|spider-?man|batman|superman|avengers|x-men|dragon ball|one piece|fortnite|minecraft|roblox/i;
  const quests = makeSampleQuests();
  assert.ok(quests.length > 0);
  for (const q of quests) assert.doesNotMatch(q.title ?? "", banned, q.title);
});
