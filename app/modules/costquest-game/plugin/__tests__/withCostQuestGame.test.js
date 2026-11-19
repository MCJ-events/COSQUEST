// The config plugin's Info.plist merge: the chat app's permission sentences
// keep their wording and gain the game's purpose, exactly once.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { mergeUsage, GAME_USAGE, CHAT_USAGE, NFC_USAGE } = require("../withCostQuestGame");

describe("mergeUsage", () => {
  it("uses the game's sentence when the chat has none", () => {
    assert.equal(mergeUsage(undefined, "In the game, x."), "In the game, x.");
    assert.equal(mergeUsage("   ", "In the game, x."), "In the game, x.");
  });

  it("appends the game's purpose to the chat's sentence", () => {
    assert.equal(
      mergeUsage("CosQuest needs your camera for video calls.", GAME_USAGE.NSCameraUsageDescription),
      `CosQuest needs your camera for video calls. ${GAME_USAGE.NSCameraUsageDescription}`,
    );
  });

  it("closes a chat sentence that has no full stop", () => {
    assert.equal(mergeUsage("Used for calls", "In the game, y."), "Used for calls. In the game, y.");
  });

  it("never adds the game's purpose twice (prebuild runs again)", () => {
    const once = mergeUsage("Used for calls.", "In the game, y.");
    assert.equal(mergeUsage(once, "In the game, y."), once);
  });

  it("covers every permission the game uses", () => {
    for (const key of [
      "NSCameraUsageDescription",
      "NSLocationWhenInUseUsageDescription",
      "NSMotionUsageDescription",
      "NSMicrophoneUsageDescription",
      "NSSpeechRecognitionUsageDescription",
      "NSNearbyInteractionUsageDescription",
      "NSLocalNetworkUsageDescription",
    ]) {
      assert.ok(GAME_USAGE[key], key);
    }
  });
});

describe("chat fallbacks", () => {
  it("the microphone always says what calls use it for", () => {
    assert.match(CHAT_USAGE.NSMicrophoneUsageDescription, /calls/);
  });

  it("the microphone says voice messages are uploaded, and no text claims a voice never leaves the phone", () => {
    assert.match(CHAT_USAGE.NSMicrophoneUsageDescription, /uploaded/);
    for (const text of [...Object.values(GAME_USAGE), ...Object.values(CHAT_USAGE)]) {
      assert.doesNotMatch(text, /never leaves/);
    }
  });

  it("motion names only what CMPedometer gives (no floors)", () => {
    assert.match(GAME_USAGE.NSMotionUsageDescription, /steps/);
    assert.doesNotMatch(GAME_USAGE.NSMotionUsageDescription, /floor/);
  });
});

describe("NFC", () => {
  it("is not one of the always-written sentences", () => {
    assert.equal(GAME_USAGE.NFCReaderUsageDescription, undefined);
    assert.ok(NFC_USAGE.NFCReaderUsageDescription);
  });
});
