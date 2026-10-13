// Config plugin for the CostQuest game module (iOS; Android comes with task 2).
//
// app.json: ["./modules/costquest-game/plugin/withCostQuestGame", { "nfc": false, "serverUrl": "" }]
//
// - Info.plist: the game's permission strings, MERGED with the chat app's
//   (a key the chat already has keeps its sentence and gains the game's
//   purpose, never a second copy), its Bonjour services (the peer mesh), and
//   CQServerURL when serverUrl is given (empty = the game's production).
// - Entitlements: NFC tag reading, only with { nfc: true }. It needs the NFC
//   capability on the App ID first, or device signing fails.
// - Build phase "[CostQuest] Embed UnityFramework": on device builds that
//   link Unity (see CostQuestGame.podspec), copies the pinned framework into
//   the app and signs it. Simulator and no-Unity builds skip it.
//
// The iOS deployment target (18.0, what the game needs) is set with
// expo-build-properties in app.json, not here.
const {
  createRunOncePlugin,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require("expo/config-plugins");

// The game's purpose for each permission, in the merged app's name. The
// standalone game's wording is in costquest-ios project.yml.
const GAME_USAGE = {
  NSCameraUsageDescription:
    "In the game, the camera places the game world around you.",
  NSLocationWhenInUseUsageDescription:
    "In the game, your location places Quest Points around you and tells when you reach one.",
  NSMotionUsageDescription:
    "In the game, motion counts your steps and tells which floor of a venue you are on.",
  NSMicrophoneUsageDescription:
    "In the game, you can say your answer out loud; your voice is recognised on this phone and never leaves it.",
  NSSpeechRecognitionUsageDescription:
    "In the game, your spoken answer is recognised on this phone to pick the choice you said.",
  NFCReaderUsageDescription: "In the game, tap a checkpoint to capture it.",
  NSNearbyInteractionUsageDescription:
    "In the game, ultra wideband shows exactly how far away another player is, and in which direction.",
  NSLocalNetworkUsageDescription:
    "In the game, CosQuest shares game data directly with players standing near you, so the game keeps up when the network does not.",
};

const BONJOUR = ["_costquest._udp", "_costquest._tcp"];

/** The chat's sentence plus the game's, once. Exported for tests. */
function mergeUsage(existing, game) {
  const current = typeof existing === "string" ? existing.trim() : "";
  if (!current) return game;
  if (current.includes(game)) return current;
  const sentence = /[.!?]$/.test(current) ? current : `${current}.`;
  return `${sentence} ${game}`;
}

function withGameInfoPlist(config, { serverUrl }) {
  return withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults;
    for (const [key, game] of Object.entries(GAME_USAGE)) {
      plist[key] = mergeUsage(plist[key], game);
    }
    const bonjour = Array.isArray(plist.NSBonjourServices) ? plist.NSBonjourServices : [];
    plist.NSBonjourServices = [...new Set([...bonjour, ...BONJOUR])];
    if (serverUrl) {
      plist.CQServerURL = serverUrl;
    }
    return cfg;
  });
}

function withGameEntitlements(config, { nfc }) {
  if (!nfc) return config;
  return withEntitlementsPlist(config, (cfg) => {
    const key = "com.apple.developer.nfc.readersession.formats";
    const formats = Array.isArray(cfg.modResults[key]) ? cfg.modResults[key] : [];
    cfg.modResults[key] = [...new Set([...formats, "NDEF"])];
    return cfg;
  });
}

const PHASE_NAME = "[CostQuest] Embed UnityFramework";

// Same decision as the pod: only when this build links Unity.
const EMBED_SCRIPT = [
  "set -e",
  'case "${OTHER_LDFLAGS}" in *UnityFramework*) ;; *) echo "CostQuest: this build has no Unity"; exit 0 ;; esac',
  'FW="${PODS_ROOT}/../../modules/costquest-game/ios/Frameworks/UnityFramework.framework"',
  'if [ ! -f "$FW/UnityFramework" ]; then echo "error: UnityFramework is linked but missing: run scripts/fetch-unity-framework.sh" >&2; exit 1; fi',
  'DEST="${TARGET_BUILD_DIR}/${FRAMEWORKS_FOLDER_PATH}"',
  'mkdir -p "$DEST"',
  'rsync -a --delete "$FW" "$DEST/"',
  'if [ -n "${EXPANDED_CODE_SIGN_IDENTITY}" ] && [ "${CODE_SIGNING_ALLOWED}" != "NO" ]; then',
  '  /usr/bin/codesign --force --sign "${EXPANDED_CODE_SIGN_IDENTITY}" --preserve-metadata=identifier,entitlements --timestamp=none "$DEST/UnityFramework.framework"',
  "fi",
].join("\n");

function withEmbedUnityPhase(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const target = project.getFirstTarget();
    const phases = project.hash.project.objects.PBXShellScriptBuildPhase || {};
    const exists = Object.values(phases).some(
      (phase) => phase && typeof phase === "object" && String(phase.name).replace(/"/g, "") === PHASE_NAME,
    );
    if (!exists) {
      project.addBuildPhase([], "PBXShellScriptBuildPhase", PHASE_NAME, target.uuid, {
        shellPath: "/bin/sh",
        shellScript: EMBED_SCRIPT,
        // Copies from outside the project: the script sandbox would refuse.
        alwaysOutOfDate: 1,
      });
    }
    // The phase reads modules/ and writes into the app bundle.
    const configs = project.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configs)) {
      const settings = configs[key] && configs[key].buildSettings;
      if (settings && settings.PRODUCT_NAME && settings.INFOPLIST_FILE) {
        settings.ENABLE_USER_SCRIPT_SANDBOXING = "NO";
      }
    }
    return cfg;
  });
}

function withCostQuestGame(config, props = {}) {
  const options = { nfc: false, serverUrl: "", ...props };
  config = withGameInfoPlist(config, options);
  config = withGameEntitlements(config, options);
  config = withEmbedUnityPhase(config);
  return config;
}

module.exports = createRunOncePlugin(withCostQuestGame, "costquest-game", "0.1.0");
module.exports.mergeUsage = mergeUsage;
module.exports.GAME_USAGE = GAME_USAGE;
