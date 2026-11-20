// plugins/withStoreRelease.js: no Always-location sentences, and a signed store build carries the
// push entitlement and not the team's Apple Pay merchant.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { dropBoilerplate, stripAlwaysLocation, storeEntitlements, releaseSigning } = require("../withStoreRelease");

describe("withStoreRelease", () => {
  it("removes both Always sentences and keeps When In Use", () => {
    const plist = { NSLocationAlwaysUsageDescription: "a", NSLocationAlwaysAndWhenInUseUsageDescription: "b", NSLocationWhenInUseUsageDescription: "c" };
    assert.deepEqual(stripAlwaysLocation(plist), { NSLocationWhenInUseUsageDescription: "c" });
  });

  it("keeps them only when asked", () => {
    const plist = { NSLocationAlwaysUsageDescription: "a" };
    assert.equal(stripAlwaysLocation(plist, { locationAlways: true }).NSLocationAlwaysUsageDescription, "a");
  });

  it("drops expo's boilerplate sentence only when a real reason follows", () => {
    const plist = {
      NSMotionUsageDescription: "Allow $(PRODUCT_NAME) to detect your current motion activity. In the game, steps earn rewards.",
      NSCameraUsageDescription: "Allow $(PRODUCT_NAME) to access your camera",
      CFBundleName: "Allow $(PRODUCT_NAME) x. y",
    };
    dropBoilerplate(plist);
    assert.equal(plist.NSMotionUsageDescription, "In the game, steps earn rewards.");
    assert.equal(plist.NSCameraUsageDescription, "Allow $(PRODUCT_NAME) to access your camera");
    assert.equal(plist.CFBundleName, "Allow $(PRODUCT_NAME) x. y");
  });

  it("sets aps-environment for the store profile and drops the Apple Pay merchant", () => {
    const ent = storeEntitlements({ "aps-environment": "development", "com.apple.developer.in-app-payments": ["merchant.x"] });
    assert.deepEqual(ent, { "aps-environment": "production" });
    const keep = storeEntitlements({ "com.apple.developer.in-app-payments": ["merchant.x"] }, { applePayMerchant: true });
    assert.deepEqual(keep["com.apple.developer.in-app-payments"], ["merchant.x"]);
  });

  it("signs Release manually with the named profile", () => {
    const s = releaseSigning({}, { team: "T", profile: "My Store Profile" });
    assert.equal(s.CODE_SIGN_STYLE, "Manual");
    assert.equal(s.DEVELOPMENT_TEAM, "T");
    assert.equal(s.PROVISIONING_PROFILE_SPECIFIER, '"My Store Profile"');
    assert.equal(s.CODE_SIGN_IDENTITY, '"Apple Distribution"');
  });
});
