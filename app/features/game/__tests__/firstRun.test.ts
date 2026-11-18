import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { GAME_NAME_MAX, LOCATION_REASON, quietGameName, shouldStartLocation, WARDEN_ONBOARDING } from "../firstRun.ts";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const gameRoot = readFileSync(join(APP, "components", "game", "GameRoot.tsx"), "utf8");
const code = gameRoot.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("a new session never reaches the Warden onboarding", () => {
  assert.equal(WARDEN_ONBOARDING, false);
  // GameRoot is the only place that ever showed it: it must not import or render it, nor gate on it
  assert.doesNotMatch(code, /from\s+["']\.\/Onboarding["']/);
  assert.doesNotMatch(code, /<Onboarding\b/);
  assert.doesNotMatch(code, /needsOnboarding/);
});

test("the game name comes from the chat profile, quietly, only when the game has none", () => {
  assert.equal(quietGameName("kofi", null), "kofi");
  assert.equal(quietGameName("  Ada   Nwosu ", ""), "Ada Nwosu");
  assert.equal(quietGameName("kofi", "kofi23"), null); // already named: never overwritten
  assert.equal(quietGameName("", null), null);
  assert.equal(quietGameName("a", null), null); // the server's minimum is 2
  assert.equal(quietGameName(undefined, undefined), null);
  const long = quietGameName("a".repeat(40), null);
  assert.equal(long?.length, GAME_NAME_MAX);
});

test("location is asked for when the map is on screen, not while parked behind the chat", () => {
  assert.equal(shouldStartLocation({ session: true, onScreen: true, parked: false }), true);
  assert.equal(shouldStartLocation({ session: true, onScreen: true, parked: true }), false);
  assert.equal(shouldStartLocation({ session: true, onScreen: false, parked: false }), false);
  assert.equal(shouldStartLocation({ session: false, onScreen: true, parked: false }), false);
});

test("the location reason is one plain line, not the Warden's voice", () => {
  assert.ok(LOCATION_REASON.length < 100);
  assert.doesNotMatch(LOCATION_REASON, /\n|Warden|\bI\b/);
});
