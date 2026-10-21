// Metro = the tool that bundles the app's code.
//
// WEB STUBS: some packages only work on phones (they crash a browser).
// When bundling for the WEBSITE, Metro swaps them for a simple stand-in
// from the web-stubs/ folder. Phones (Android / iOS) are NOT affected -
// they keep using the real packages.
//
// To stub another phone-only package later, add one line to WEB_STUBS.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

const WEB_STUBS = {
  "react-native-maps": path.resolve(__dirname, "web-stubs/react-native-maps.tsx"),
  "react-native-filament": path.resolve(__dirname, "web-stubs/forge-3d.tsx"),
  "react-native-worklets-core": path.resolve(__dirname, "web-stubs/forge-3d.tsx"),
};

const defaultResolveRequest = config.resolver.resolveRequest;

// TEXT SIZE CAP (phones only): React Native's Text and TextInput resolve to
// utils/textScale/, which give every one of them the app's default
// maxFontSizeMultiplier (see utils/textScale/cap.ts). Those two files still
// get the real ones.
const TEXT_CAP_DIR = path.resolve(__dirname, "utils/textScale");
const TEXT_CAP = [
  [path.join("react-native", "Libraries", "Text", "Text.js"), path.join(TEXT_CAP_DIR, "Text.tsx")],
  [path.join("react-native", "Libraries", "Components", "TextInput", "TextInput.js"), path.join(TEXT_CAP_DIR, "TextInput.tsx")],
];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && WEB_STUBS[moduleName]) {
    return { type: "sourceFile", filePath: WEB_STUBS[moduleName] };
  }

  const resolved = defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);

  if (platform !== "web" && resolved?.type === "sourceFile" && !context.originModulePath.startsWith(TEXT_CAP_DIR)) {
    const swap = TEXT_CAP.find(([original]) => resolved.filePath.endsWith(original));
    if (swap) return { type: "sourceFile", filePath: swap[1] };
  }

  return resolved;
};

module.exports = config;
