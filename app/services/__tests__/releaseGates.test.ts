import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { envOn, releaseGates, signupLegalLinks, withoutPlaceholders } from "../releaseGates.ts";

describe("releaseGates", () => {
  it("a store build (nothing set) hides coin buying, placeholders and test screens on phones", () => {
    for (const platform of ["ios", "android"]) {
      assert.deepEqual(releaseGates({}, platform, false), { coinPurchase: false, showPlaceholders: false, devScreens: false });
    }
  });

  it("each switch turns on only its own part", () => {
    assert.equal(releaseGates({ EXPO_PUBLIC_COIN_PURCHASE: "1" }, "ios", false).coinPurchase, true);
    assert.equal(releaseGates({ EXPO_PUBLIC_COIN_PURCHASE: "1" }, "ios", false).showPlaceholders, false);
    assert.equal(releaseGates({ EXPO_PUBLIC_SHOW_PLACEHOLDERS: "true" }, "android", false).showPlaceholders, true);
    assert.equal(releaseGates({ EXPO_PUBLIC_DEV_SCREENS: "1" }, "ios", false).devScreens, true);
  });

  it("the web build keeps its coin shop; a dev or E2E build has the test screens", () => {
    assert.equal(releaseGates({}, "web", false).coinPurchase, true);
    assert.equal(releaseGates({}, "ios", true).devScreens, true);
    assert.equal(releaseGates({ EXPO_PUBLIC_E2E: "1" }, "ios", false).devScreens, true);
  });

  it("only 1 or true count as on", () => {
    assert.equal(envOn(" TRUE "), true);
    assert.equal(envOn("0"), false);
    assert.equal(envOn("yes"), false);
    assert.equal(envOn(undefined), false);
  });
});

describe("withoutPlaceholders", () => {
  const items = [{ id: "a" }, { id: "b", soon: true }, { id: "c", soon: false }];
  it("drops the not-built entries unless placeholders are shown", () => {
    assert.deepEqual(withoutPlaceholders(items, false).map((i) => i.id), ["a", "c"]);
    assert.deepEqual(withoutPlaceholders(items, true).map((i) => i.id), ["a", "b", "c"]);
  });
});

describe("signupLegalLinks", () => {
  it("links nothing while no page is published", () => {
    assert.deepEqual(signupLegalLinks({ terms: null, privacy: null, guidelines: null }), { agree: [], privacy: null });
  });

  it("links each published page, privacy on its own", () => {
    const all = signupLegalLinks({ terms: "https://x/t", privacy: "https://x/p", guidelines: "https://x/g" });
    assert.deepEqual(all.agree.map((l) => l.doc), ["terms", "guidelines"]);
    assert.equal(all.privacy?.doc, "privacy");
    const onlyPrivacy = signupLegalLinks({ terms: null, privacy: "https://x/p", guidelines: null });
    assert.deepEqual(onlyPrivacy.agree, []);
    assert.equal(onlyPrivacy.privacy?.label, "Privacy Policy");
  });
});
