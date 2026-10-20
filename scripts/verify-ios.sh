#!/usr/bin/env bash
#
# The merged app's iOS check, end to end, on a Mac. Everything the Linux
# side could not do: fetch the pinned UnityFramework, install, prebuild,
# pod install, and compile the app for the simulator (no Unity) and for a
# generic device (with Unity, unsigned).
#
#   scripts/verify-ios.sh                 the whole check
#   scripts/verify-ios.sh --no-unity      skip the framework: both builds are
#                                         the no-Unity one (NO_UNITY)
#   scripts/verify-ios.sh --sim-only      only the simulator build
#   scripts/verify-ios.sh --run           also install and launch a Release
#                                         simulator build (JS bundled in), open
#                                         the game page and take screenshots
#   scripts/verify-ios.sh --native-game   the bundled JS shows the SwiftUI game
#                                         (EXPO_PUBLIC_GAME_UI=native), the
#                                         fallback. Default: the shared React
#                                         Native game, as on Android
#                                         (docs/one-codebase.md)
#   scripts/verify-ios.sh --staging       the bundled JS talks to the STAGING
#                                         game server (default: production,
#                                         read-only use only)
#   (--rn-game is still accepted: it is the default now, and implies --staging
#   as it always did.)
#
# What the Mac must look at by hand after this passes is the checklist in
# docs/one-codebase.md, "What the Mac must verify".
#
# Needs: Xcode 26+ (iOS 18 SDK or later) with its command line tools, Node 22,
# CocoaPods, and for Unity the GitHub CLI signed in to an account that can
# read ubmids/costquest-ios releases. Logs go to app/build-logs/.
#
# Exit code: 0 when every step that ran passed. The last lines say which
# steps ran and which were skipped.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/app"
LOGS="$APP/build-logs"
mkdir -p "$LOGS"

NO_UNITY=0
SIM_ONLY=0
RUN=0
NATIVE_GAME=0
STAGING=0
for arg in "$@"; do
  case "$arg" in
    --no-unity) NO_UNITY=1 ;;
    --sim-only) SIM_ONLY=1 ;;
    --run) RUN=1 ;;
    --native-game) NATIVE_GAME=1 ;;
    --staging) STAGING=1 ;;
    --rn-game) STAGING=1 ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

ran=()
skipped=()
step() { echo; echo "==> $*"; }
need() { command -v "$1" >/dev/null || { echo "missing: $1 ($2)" >&2; exit 1; }; }

[ "$(uname -s)" = "Darwin" ] || { echo "this runs on a Mac (xcodebuild)" >&2; exit 1; }
need xcodebuild "install Xcode"
need node "Node 22"
need npm "Node 22"
need pod "gem install cocoapods (or brew install cocoapods)"

# Public config the JS reads at start-up (the same values as eas.json's
# preview profile; nothing secret). An app/.env with your own wins.
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-https://cosquest-1.onrender.com}"
export EXPO_PUBLIC_WEB_URL="${EXPO_PUBLIC_WEB_URL:-https://cosquest.vercel.app}"
if [ "$NATIVE_GAME" = 1 ]; then
  # The SwiftUI game, kept compiling as the fallback (features/game/config.ts).
  export EXPO_PUBLIC_GAME_UI=native
else
  # The shared React Native game, the iOS default since docs/one-codebase.md.
  export EXPO_PUBLIC_GAME_UI=rn
fi
if [ "$STAGING" = 1 ]; then
  export EXPO_PUBLIC_GAME_SERVER="${EXPO_PUBLIC_GAME_SERVER:-staging}"
  export EXPO_PUBLIC_WORLD_TIMING=1
fi

# 1. UnityFramework (device builds only).
if [ "$NO_UNITY" = 1 ]; then
  skipped+=("unity framework (--no-unity)")
  export COSTQUEST_NO_UNITY=1
else
  step "UnityFramework: pinned release, sha256 checked"
  need gh "brew install gh; gh auth login"
  "$APP/scripts/fetch-unity-framework.sh" 2>&1 | tee "$LOGS/fetch-unity.log"
  ran+=("unity framework")
fi

cd "$APP"

# 2. JS: install exactly the lockfile, then the shell's own checks.
step "npm ci"
npm ci 2>&1 | tail -5
ran+=("npm ci")

step "unit tests and typecheck"
npm test 2>&1 | tee "$LOGS/npm-test.log" | tail -8
npm run typecheck 2>&1 | tee "$LOGS/typecheck.log" | tail -5
ran+=("npm test" "typecheck")

step "config plugin tests"
node --test modules/costquest-game/plugin/__tests__/*.test.js 2>&1 | tee "$LOGS/plugin-test.log" | grep -E "^# (pass|fail)"
grep -q "^# fail 0" "$LOGS/plugin-test.log" || { echo "plugin tests failed: $LOGS/plugin-test.log" >&2; exit 1; }
ran+=("plugin tests")

# The Swift voice matcher and WardenCheck (patches 0005 and 0006) against the
# TypeScript test vectors, with this Mac's compiler. Linux runs the same
# script with swift.org's toolchain (it passed there on 2026-10-20).
step "Swift matcher and WardenCheck vs the TS vectors"
SWIFTC="$(xcrun --find swiftc)" scripts/swift-linux-check.sh 2>&1 | tee "$LOGS/swift-check.log" | tail -3
grep -q "ALL PASSED" "$LOGS/swift-check.log" || { echo "Swift check failed: $LOGS/swift-check.log" >&2; exit 1; }
ran+=("swift matcher check")

# 3. Native project from app.json + the config plugins.
step "expo prebuild --clean (ios)"
CI=1 npx expo prebuild --platform ios --clean --no-install 2>&1 | tee "$LOGS/prebuild.log" | tail -5
ran+=("prebuild")

# The flag the RN game's NFC helper reads (GameHelpers.swift NfcHelper.entitled).
plist="$(ls ios/*/Info.plist | grep -v Pods | head -1)"
if /usr/libexec/PlistBuddy -c 'Print :CQNfcEnabled' "$plist" >/dev/null 2>&1; then
  echo "    Info.plist CQNfcEnabled = $(/usr/libexec/PlistBuddy -c 'Print :CQNfcEnabled' "$plist")"
else
  echo "    WARNING: Info.plist has no CQNfcEnabled (config plugin not applied?)" >&2
fi

# What the RN game's native islands need from Info.plist: the camera (the
# AR shrine, venue Events), Bonjour and Local Network (hold phones together,
# the venue mesh), Nearby Interaction (friend distance, UWB), motion (walking),
# speech and microphone (voice answers), location.
plist_need() {
  if /usr/libexec/PlistBuddy -c "Print :$1" "$plist" >/dev/null 2>&1; then
    echo "    Info.plist $1: ok"
  else
    echo "    WARNING: Info.plist has no $1" >&2
  fi
}
for key in NSCameraUsageDescription NSLocalNetworkUsageDescription NSNearbyInteractionUsageDescription \
           NSMotionUsageDescription NSSpeechRecognitionUsageDescription NSMicrophoneUsageDescription \
           NSLocationWhenInUseUsageDescription NSBonjourServices; do
  plist_need "$key"
done
/usr/libexec/PlistBuddy -c 'Print :NSBonjourServices' "$plist" 2>/dev/null | grep -q "_costquest._tcp" \
  || echo "    WARNING: NSBonjourServices lacks _costquest._tcp (hold phones together cannot find the other phone)" >&2

step "pod install"
(cd ios && pod install 2>&1 | tee "$LOGS/pod-install.log" | grep -E "CostQuestGame|Pod installation|error" || true)
grep -q "Pod installation complete" "$LOGS/pod-install.log" || { echo "pod install failed: $LOGS/pod-install.log" >&2; exit 1; }
ran+=("pod install")

WORKSPACE="$(ls -d ios/*.xcworkspace | head -1)"
SCHEME="$(basename "$WORKSPACE" .xcworkspace)"

build() {
  local label="$1" log="$2"
  shift 2
  step "xcodebuild: $label (log: $log)"
  if xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" "$@" \
      CODE_SIGNING_ALLOWED=NO COMPILER_INDEX_STORE_ENABLE=NO > "$log" 2>&1; then
    echo "    ok"
    ran+=("$label")
  else
    echo "    FAILED. First errors:" >&2
    grep -E "error:|\*\* BUILD FAILED" "$log" | head -40 >&2
    exit 1
  fi
}

# 4. Simulator: Unity is device-only, so this is always the no-Unity game
#    (the costquest-ios CostQuestSim equivalent).
build "simulator (no Unity)" "$LOGS/xcodebuild-sim.log" \
  -configuration Debug -sdk iphonesimulator -destination "generic/platform=iOS Simulator" build

# 5. Generic device: links and embeds UnityFramework when it was fetched.
if [ "$SIM_ONLY" = 1 ]; then
  skipped+=("device build (--sim-only)")
else
  build "generic device$([ "$NO_UNITY" = 1 ] && echo ' (no Unity)')" "$LOGS/xcodebuild-device.log" \
    -configuration Release -sdk iphoneos -destination "generic/platform=iOS" build
  if [ "$NO_UNITY" = 0 ]; then
    app_path="$(grep -Eo '/[^ ]+/Release-iphoneos/[^ /]+\.app' "$LOGS/xcodebuild-device.log" | tail -1 || true)"
    if [ -n "$app_path" ] && [ -f "$app_path/Frameworks/UnityFramework.framework/UnityFramework" ]; then
      echo "    UnityFramework is embedded in $(basename "$app_path")"
    else
      echo "    WARNING: could not find UnityFramework inside the built app (check the '[CostQuest] Embed UnityFramework' phase)" >&2
    fi
  fi
fi

# 6. Optional: run it in a simulator (Release, so the JS is bundled in).
if [ "$RUN" = 1 ]; then
  step "install and launch in a simulator"
  build "simulator Release" "$LOGS/xcodebuild-sim-release.log" \
    -configuration Release -sdk iphonesimulator -destination "generic/platform=iOS Simulator" \
    -derivedDataPath "$APP/build-logs/DerivedData" build
  device="$(xcrun simctl list devices available | grep -E "iPhone 1[6-9]|iPhone 2[0-9]" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')"
  [ -n "$device" ] || { echo "no iPhone simulator found" >&2; exit 1; }
  xcrun simctl boot "$device" 2>/dev/null || true
  open -a Simulator || true
  app_path="$(ls -d "$APP"/build-logs/DerivedData/Build/Products/Release-iphonesimulator/*.app | head -1)"
  xcrun simctl install "$device" "$app_path"
  bundle_id="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app_path/Info.plist")"
  xcrun simctl privacy "$device" grant location "$bundle_id" 2>/dev/null || true
  xcrun simctl location "$device" set 51.5007,-0.1246 2>/dev/null || true
  xcrun simctl launch "$device" "$bundle_id"
  echo "    launched $bundle_id on $device"
  shots="$LOGS/screens"
  mkdir -p "$shots"
  sleep 20
  xcrun simctl io "$device" screenshot "$shots/01-launch.png" >/dev/null
  # The game page (the RN game unless --native-game), on a point near Big Ben.
  xcrun simctl openurl "$device" 'cosquest://play?place=Westminster' || true
  sleep 15
  xcrun simctl io "$device" screenshot "$shots/02-game.png" >/dev/null
  echo "    screenshots in $shots (compare with docs/one-codebase-shots/ from the Android emulator)"
  ran+=("simulator run" "screenshots")
fi

echo
ran+=("(JS built with gameUi=$EXPO_PUBLIC_GAME_UI, game server ${EXPO_PUBLIC_GAME_SERVER:-production})")
echo "verify-ios: passed"
echo "  ran:     ${ran[*]}"
[ ${#skipped[@]} -gt 0 ] && echo "  skipped: ${skipped[*]}"
exit 0
