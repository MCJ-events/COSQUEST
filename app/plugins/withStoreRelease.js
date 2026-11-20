// Store-release fixes for the iOS project (build 30, release checklist 19 Nov 2026).
//
// Every build:
//  - No "Always" location sentences. Nothing asks for Always permission and there is no location
//    background mode, but expo-location writes NSLocationAlwaysUsageDescription and
//    NSLocationAlwaysAndWhenInUseUsageDescription by default, and App Review asks why they are there.
//    { locationAlways: true } keeps them for a build that one day needs them.
//  - No plugin boilerplate in front of a real reason. expo-location writes "Allow $(PRODUCT_NAME) to
//    detect your current motion activity" and the game plugin then adds what Motion is really for;
//    the boilerplate sentence goes whenever a real one follows it.
//
// With { signing: {...} } (the CosQuest Beta / store overlay in app.config.js):
//  - aps-environment = the profile's ("production" for an App Store profile). Builds 22 to 29 were
//    archived with CODE_SIGNING_ALLOWED=NO, so the archive carried no entitlements and the export
//    signed the app with only the basic ones: no aps-environment, so remote push never worked.
//  - The Apple Pay merchant entitlement goes unless { applePayMerchant: true }: it is the team's
//    merchant (Stripe plugin), the store profile does not allow it, and signing would fail on it.
//  - The app target's Release configuration signs manually with the named profile, so
//    `xcodebuild archive` (with signing allowed) puts the entitlements into the signature.
//    Debug, the simulator and every other target are untouched.
const { withEntitlementsPlist, withInfoPlist, withXcodeProject } = require("expo/config-plugins");

const ALWAYS_KEYS = ["NSLocationAlwaysUsageDescription", "NSLocationAlwaysAndWhenInUseUsageDescription"];
const APPLE_PAY = "com.apple.developer.in-app-payments";

/** The Info.plist without the Always sentences (unless asked to keep them). Exported for tests. */
function stripAlwaysLocation(plist, { locationAlways = false } = {}) {
  if (!locationAlways) for (const key of ALWAYS_KEYS) delete plist[key];
  return plist;
}

/** "Allow $(PRODUCT_NAME) to x. Real reason." -> "Real reason." (left alone when nothing follows). Exported for tests. */
function dropBoilerplate(plist) {
  for (const key of Object.keys(plist)) {
    const v = plist[key];
    if (!key.endsWith("UsageDescription") || typeof v !== "string") continue;
    const m = /^Allow \$\(PRODUCT_NAME\) [^.]*\.\s+(\S[\s\S]*)$/.exec(v);
    if (m) plist[key] = m[1];
  }
  return plist;
}

/** The entitlements a signed store build needs. Exported for tests. */
function storeEntitlements(ent, { apsEnvironment = "production", applePayMerchant = false } = {}) {
  ent["aps-environment"] = apsEnvironment;
  if (!applePayMerchant) delete ent[APPLE_PAY];
  return ent;
}

/** Manual Release signing for the app target's build settings (an XCBuildConfiguration's buildSettings). Exported for tests. */
function releaseSigning(settings, { team, profile, identity = "Apple Distribution" }) {
  settings.CODE_SIGN_STYLE = "Manual";
  settings.DEVELOPMENT_TEAM = team;
  settings.PROVISIONING_PROFILE_SPECIFIER = `"${profile}"`;
  settings['"CODE_SIGN_IDENTITY[sdk=iphoneos*]"'] = `"${identity}"`;
  settings.CODE_SIGN_IDENTITY = `"${identity}"`;
  return settings;
}

function withStoreRelease(config, props = {}) {
  config = withInfoPlist(config, (cfg) => {
    stripAlwaysLocation(cfg.modResults, props);
    dropBoilerplate(cfg.modResults);
    return cfg;
  });
  if (!props.signing) return config;
  config = withEntitlementsPlist(config, (cfg) => {
    storeEntitlements(cfg.modResults, props);
    return cfg;
  });
  config = withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const target = project.getFirstTarget();
    const listId = target.firstTarget.buildConfigurationList;
    const lists = project.pbxXCConfigurationList();
    const list = lists[listId];
    const configs = project.pbxXCBuildConfigurationSection();
    for (const ref of (list && list.buildConfigurations) || []) {
      const c = configs[ref.value];
      if (c && c.name === "Release" && c.buildSettings) releaseSigning(c.buildSettings, props.signing);
    }
    return cfg;
  });
  return config;
}

module.exports = withStoreRelease;
module.exports.stripAlwaysLocation = stripAlwaysLocation;
module.exports.storeEntitlements = storeEntitlements;
module.exports.dropBoilerplate = dropBoilerplate;
module.exports.releaseSigning = releaseSigning;
module.exports.ALWAYS_KEYS = ALWAYS_KEYS;
