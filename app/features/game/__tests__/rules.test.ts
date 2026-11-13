import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RULEBOOK, RULES_LEAD } from "../rules.ts";

describe("the rules", () => {
  it("is the fixed rulebook, every rule with a topic and its text", () => {
    assert.equal(RULEBOOK.length, 8);
    assert.deepEqual(
      RULEBOOK.map((r) => r.topic),
      ["Cooldown", "Friendly fire", "Range", "Weapons", "Scoring", "Being downed", "The venue boundary", "Trivia"],
    );
    for (const r of RULEBOOK) assert.ok(r.topic.trim() && r.text.trim().endsWith("."), r.topic);
    assert.equal(RULEBOOK[4].text.split(".")[0], "Tokens are the score");
  });
  it("has no model, download or character wording", () => {
    const all = [RULES_LEAD, ...RULEBOOK.flatMap((r) => [r.topic, r.text])].join("\n");
    assert.doesNotMatch(all, /\b(model|download|downloading|Warden|Proctor|on your phone|no signal|wifi|I|I'm|I'll|ask)\b/i);
  });
});
