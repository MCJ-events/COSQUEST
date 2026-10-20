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
#                                         simulator build (JS bundled in)
#   scripts/verify-ios.sh --rn-game       the bundled JS uses the shared React
#                                         Native game (gameUi 'rn', the one
#                                         Android runs) against the STAGING
#                                         game server, instead of the SwiftUI
#                                         game. Use with --run to try it.
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
RN_GAME=0
for arg in "$@"; do
  case "$arg" in
    --no-unity) NO_UNITY=1 ;;
    --sim-only) SIM_ONLY=1 ;;
    --run) RUN=1 ;;
    --rn-game) RN_GAME=1 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
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
if [ "$RN_GAME" = 1 ]; then
  # The shared React Native game on iOS (docs/android-port.md §4), on staging.
  export EXPO_PUBLIC_GAME_UI=rn
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

step "lint (0 errors expected since merged-app-sync ecbfc0b)"
npm run lint 2>&1 | tee "$LOGS/lint.log" | tail -3
ran+=("lint")

# 3. Native project from app.json + the config plugins.
step "expo prebuild --clean (ios)"
CI=1 npx expo prebuild --platform ios --clean --no-install 2>&1 | tee "$LOGS/prebuild.log" | tail -5
ran+=("prebuild")

step "pod install"
(cd ios && pod install 2>&1 | tee "$LOGS/pod-install.log" | grep -E "CostQuestGame|SparksCallAudio|Pod installation|error" || true)
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
  xcrun simctl launch "$device" "$bundle_id"
  echo "    launched $bundle_id on $device. Try: swipe left from the right edge of the chat tabs;"
  echo "    xcrun simctl openurl $device 'cosquest://play?shrine=test-1&place=Somewhere'"
  # What the Android journeys (docs/journeys/) changed that only a Mac can see.
  echo "    By hand on iOS (docs/journeys/FINDINGS.md has the Android side):"
  echo "     - chat: the keyboard still sits just under the composer (padding on both platforms, b434ee5)"
  echo "     - edit a message: the edit card shows once under it and Done closes it (55b5ca5)"
  echo "     - chat search, Open the chat: back to the same chat at the message (b83f40f)"
  echo "     - profile: stat cards keep their soft shadow (only Android lost elevation, ca9ee20)"
  echo "     - sign-up picture step: Continue pinned above the home indicator (6f2590f)"
  echo "     - incoming call: tapping the Accept caption answers (3718d17)"
  echo "     - xcrun simctl openurl $device 'cosquest://nowhere' shows 'This link doesn't go anywhere' (39dda0c)"
  echo "     - a 1:1 call with Sparks on (sparks-call-audio module), then add a third person: no crash (9034081)"
  ran+=("simulator run")
fi

echo
[ "$RN_GAME" = 1 ] && ran+=("(JS built with gameUi=rn, game server $EXPO_PUBLIC_GAME_SERVER)")
echo "verify-ios: passed"
echo "  ran:     ${ran[*]}"
[ ${#skipped[@]} -gt 0 ] && echo "  skipped: ${skipped[*]}"
exit 0
