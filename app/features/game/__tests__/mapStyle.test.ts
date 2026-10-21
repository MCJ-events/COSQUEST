// The map lit by the hour (mapStyle.ts), against Map/TimeOfDay.swift and
// UI/Preferences.swift WorldClock.
import assert from "node:assert/strict";
import { describe, it, test } from "node:test";

import { effectiveHour, hourForScheme, isWorldClock, mapStyle, timeOfDay, WORLD_CLOCKS } from "../mapStyle.ts";

describe("the map by the hour (TimeOfDay.swift)", () => {
  it("buckets the hour as TimeOfDay.now does", () => {
    assert.deepEqual(
      [0, 4, 5, 7, 8, 12, 16, 17, 19, 20, 23].map(timeOfDay),
      ["night", "night", "dawn", "dawn", "day", "day", "day", "dusk", "dusk", "night", "night"],
    );
    assert.equal(timeOfDay(18.4), "dusk");
    assert.equal(timeOfDay(-1), "night");
  });

  it("follows the clock unless Time in town is fixed (Preferences.WorldClock)", () => {
    const at = new Date(2026, 9, 20, 21, 30);
    assert.equal(effectiveHour("real", at), 21.5);
    assert.equal(timeOfDay(effectiveHour("morning", at)), "day");
    assert.equal(timeOfDay(effectiveHour("noon", at)), "day");
    assert.equal(timeOfDay(effectiveHour("dusk", at)), "dusk");
    assert.equal(timeOfDay(effectiveHour("night", new Date(2026, 9, 20, 12))), "night");
    assert.deepEqual(WORLD_CLOCKS.map((c) => c.label), ["Follow the clock", "Morning", "Midday", "Dusk", "Night"]);
    assert.equal(isWorldClock("dusk"), true);
    assert.equal(isWorldClock("evening"), false);
  });

  it("uses the Roam board's colours with the hour's light multiplied in", () => {
    const day = mapStyle(12);
    // meadow earth D2DFAE x day grade (0.9, 0.9, 0.88)
    assert.equal(day.land, "#BDC999");
    assert.equal(day.windows, null);
    const night = mapStyle(23);
    // meadowNight earth 232B47 x (0.97, 0.98, 1.0)
    assert.equal(night.land, "#222A47");
    assert.equal(night.windows, "#FFD37A");
    // After dark the streets are the brightest ground (WorldView.meadowNight).
    const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    for (const s of [mapStyle(18), night]) assert.ok(lum(s.road) > lum(s.land) && lum(s.road) > lum(s.paved), s.hour);
    // Dawn is the day board in warmer light.
    assert.notEqual(mapStyle(6).land, day.land);
    assert.equal(mapStyle(6).hour, "dawn");
  });
});

test("dark mode lights the town as at night when the world follows the clock (task 059)", () => {
  assert.equal(hourForScheme("real", 13, false), 13);
  assert.equal(hourForScheme("real", 13, true), 22);
  assert.equal(hourForScheme("real", 23, true), 23);
  assert.equal(hourForScheme("noon", 13, true), 13);
});
