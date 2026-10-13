// WardenCheck: what a model-written line must pass (costquest-ios Warden/WardenCheck.swift).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WardenMoment } from "../warden.ts";
import { chooseVariant, cleanLine, lineProblem, numbersIn } from "../wardenCheck.ts";
import type { ModelManifest } from "../wire.ts";

const arrive = new WardenMoment("arrive", "arcade", [["name", "Ada"], ["place", "Caffè Nero"], ["level", "7"]]);

describe("WardenCheck", () => {
  it("cleans the model's line to the line itself", () => {
    assert.equal(cleanLine('"Caffè Nero is live, Ada."<|im_end|>\nmore'), "Caffè Nero is live, Ada.");
  });
  it("accepts a line built from the facts", () => {
    assert.equal(lineProblem("Caffè Nero is live, Ada. Level 7 starts now.", arrive), null);
  });
  it("refuses invented numbers, words included", () => {
    assert.match(lineProblem("Caffè Nero awaits, Ada, for the twelfth time and 12 more.", arrive) ?? "", /invented numbers \[12\]/);
    assert.ok(numbersIn("four in a row, 1,200 xp").has(4));
    assert.ok(numbersIn("four in a row, 1,200 xp").has(1200));
  });
  it("refuses the wrong length, markup, emoji, other scripts, money and a missing place", () => {
    assert.equal(lineProblem("Too short.", arrive), "too short");
    assert.match(lineProblem(Array(20).fill("word").join(" "), arrive) ?? "", /too long/);
    assert.equal(lineProblem("Caffè Nero is *live* now, Ada.", arrive), "markup");
    assert.equal(lineProblem("Caffè Nero is live now, Ada 🎮", arrive), "emoji");
    assert.equal(lineProblem("Caffè Nero is live now, Ada 你好", arrive), "non-Latin script");
    assert.match(lineProblem("Caffè Nero has cash for you, Ada.", arrive) ?? "", /banned/);
    assert.equal(lineProblem("The shrine is live now, Ada.", arrive), "arrive without the place");
  });
});

describe("which model", () => {
  const file = (n: string) => ({ file: n, url: `https://x/${n}`, bytes: 1, sha256: "0".repeat(64) });
  const manifest: ModelManifest = {
    version: "v",
    label: "AIMM 1.7B",
    model: file("big.mq"),
    tokenizer: file("q3.mtok"),
    min_ram_bytes: 6 * 2 ** 30,
    variants: [
      { label: "AIMM 1.7B", model: file("big.mq"), tokenizer: file("q3.mtok"), min_ram_bytes: 6 * 2 ** 30 },
      { label: "AIMM 0.5B", model: file("small.mq"), tokenizer: file("q.mtok"), min_ram_bytes: 3 * 2 ** 30 },
    ],
  };
  it("the best one this phone can hold, or none", () => {
    assert.equal(chooseVariant(manifest, 8 * 2 ** 30)?.label, "AIMM 1.7B");
    assert.equal(chooseVariant(manifest, 4 * 2 ** 30)?.label, "AIMM 0.5B");
    assert.equal(chooseVariant(manifest, 2 * 2 ** 30), null);
    assert.equal(chooseVariant(manifest, 2 * 2 ** 30, "0.5B")?.label, "AIMM 0.5B", "forced for a test build");
  });
});
