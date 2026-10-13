// The world store and the prewarm policy.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LOW_MEMORY_BYTES, prewarmDecision } from "../prewarm.ts";
import { createWorldStore, factionVeilColor } from "../worldState.ts";

describe("world store", () => {
  it("an open request mounts the game, carries the spot once, and bumps the serial", () => {
    const store = createWorldStore();
    let calls = 0;
    store.subscribe(() => calls++);
    store.openGame({ raidId: "r1" });
    assert.equal(store.get().gameMounted, true);
    assert.equal(store.get().openSerial, 1);
    assert.deepEqual(store.takeTarget(), { raidId: "r1" });
    assert.equal(store.takeTarget(), null, "taken once");
    assert.ok(calls >= 2);
  });
  it("back to chat can carry a conversation", () => {
    const store = createWorldStore();
    store.openChat("c1");
    assert.equal(store.get().closeSerial, 1);
    assert.equal(store.takeChatId(), "c1");
    assert.equal(store.takeChatId(), null);
  });
  it("settles and resets", () => {
    const store = createWorldStore();
    store.settled("game");
    assert.equal(store.get().page, "game");
    store.reset();
    assert.equal(store.get().page, "chat");
    assert.equal(store.get().gameMounted, false);
  });
  it("unsubscribes", () => {
    const store = createWorldStore();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    off();
    store.mountGame();
    assert.equal(calls, 0);
  });
});

describe("faction veil colour", () => {
  it("prefers the game faction, then the chat's, then the sky", () => {
    assert.equal(factionVeilColor("marvel", "icons"), "#E33636");
    assert.equal(factionVeilColor(null, "icons"), "#6E80F6");
    assert.equal(factionVeilColor("nope", "nope"), "#2B99D6");
  });
});

describe("prewarm policy", () => {
  const ok = { physicalMemory: 6 * 1024 ** 3, gameAvailable: true, hadMemoryWarning: false };
  it("warms on phones with room", () => {
    assert.deepEqual(prewarmDecision(ok), { prewarm: true, reason: "enough-memory" });
  });
  it("waits for the first swipe on a 3 GB phone", () => {
    assert.equal(prewarmDecision({ ...ok, physicalMemory: 3 * 1024 ** 3 }).prewarm, false);
    assert.equal(prewarmDecision({ ...ok, physicalMemory: LOW_MEMORY_BYTES }).prewarm, true);
  });
  it("never after a memory warning, in low power, or without a game", () => {
    assert.equal(prewarmDecision({ ...ok, hadMemoryWarning: true }).reason, "memory-warning");
    assert.equal(prewarmDecision({ ...ok, lowPower: true }).reason, "low-power");
    assert.equal(prewarmDecision({ ...ok, gameAvailable: false }).reason, "no-game");
  });
  it("warms when memory is unknown", () => {
    assert.equal(prewarmDecision({ ...ok, physicalMemory: null }).prewarm, true);
  });
});
