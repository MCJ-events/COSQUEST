import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SPRING_DROP_FLIP, SPRING_RAID_HP, springOf } from "../spring.ts";

describe("springOf", () => {
  it("matches the audit's numbers", () => {
    assert.ok(Math.abs(SPRING_RAID_HP.stiffness - 195) < 1);
    assert.ok(Math.abs(SPRING_RAID_HP.damping - 19.5) < 0.2);
    assert.ok(Math.abs(SPRING_DROP_FLIP.stiffness - 110) < 1);
    assert.ok(Math.abs(SPRING_DROP_FLIP.damping - 13) < 0.2);
  });
  it("is critically damped at fraction 1", () => {
    const s = springOf(1, 1);
    assert.equal(s.mass, 1);
    assert.ok(Math.abs(s.damping - 2 * Math.sqrt(s.stiffness)) < 1e-9);
  });
});
