#!/usr/bin/env bash
# Build the merged app for an x86_64 Android emulator, with the JS bundled in
# (no Metro needed), pointed at a local chat backend and the STAGING game
# server. Never points at production.
#
#   scripts/android-emulator-build.sh            # prebuild --clean + assembleRelease
#   SKIP_PREBUILD=1 scripts/android-emulator-build.sh
#
# Then:
#   (cd ../cosquest-backend && node scripts/devLocal.js)   # chat backend on :4120
#   adb reverse tcp:4120 tcp:4120
#   adb install -r android/app/build/outputs/apk/release/app-release.apk
#
# Env (defaults in brackets):
#   CHAT_API_URL   [http://localhost:4120]  the chat backend (devLocal.js)
#   GAME_SERVER    [staging]                "staging" or an https URL
#   GAME_UI        [rn]                     the React Native game
#   ABI            [x86_64]                 arm64-v8a for a phone
#   UNLOCK_ALL     [0]                      1: every feature open whatever the
#                                           player's level (screens on a new
#                                           player; refused on production)
#   JAVA_HOME / ANDROID_HOME                 JDK 17 and the Android SDK
#
# The release build is signed with the debug key (the Expo template's
# default) and is for testing only. When the chat URL is plain http, this
# script turns on cleartext traffic in the generated manifest; that edit
# lives in android/ (generated, git-ignored), never in app.json.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${CHAT_API_URL:=http://localhost:4120}"
: "${GAME_SERVER:=staging}"
: "${GAME_UI:=rn}"
: "${ABI:=x86_64}"
export ANDROID_SDK_ROOT="${ANDROID_HOME:?set ANDROID_HOME}"
export PATH="${JAVA_HOME:?set JAVA_HOME}/bin:$PATH"

case "$GAME_SERVER" in
  staging | https://*) ;;
  *) echo "GAME_SERVER must be 'staging' or an https URL" >&2; exit 2 ;;
esac

export EXPO_PUBLIC_API_URL="$CHAT_API_URL"
export EXPO_PUBLIC_GAME_SERVER="$GAME_SERVER"
export EXPO_PUBLIC_GAME_UI="$GAME_UI"
export EXPO_PUBLIC_WORLD_TIMING=1
export EXPO_PUBLIC_GAME_UNLOCK_ALL="${UNLOCK_ALL:-0}"
export NODE_ENV=production
# Metro caches in $TMPDIR/metro-cache; on a shared machine another user may
# own /tmp/metro-cache, so use a private temp dir then.
if [ -e /tmp/metro-cache ] && [ ! -w /tmp/metro-cache ]; then
  export TMPDIR="$PWD/node_modules/.cache/tmp"
  mkdir -p "$TMPDIR"
fi

if [ "${SKIP_PREBUILD:-0}" != 1 ]; then
  echo "== prebuild $(date -u +%FT%TZ)"
  CI=1 npx expo prebuild --platform android --clean --no-install
fi

if [[ "$CHAT_API_URL" == http://* ]]; then
  manifest=android/app/src/main/AndroidManifest.xml
  grep -q 'usesCleartextTraffic="true"' "$manifest" ||
    sed -i 's/<application /<application android:usesCleartextTraffic="true" /' "$manifest"
  echo "== cleartext on (test build only): $CHAT_API_URL"
fi

# ninja runs cores+2 native compile jobs by default, which on a big shared
# machine can push it into swap. CMAKE_DIR may point at a copy of the SDK's
# cmake whose bin/ninja is a wrapper adding -j4.
if [ -n "${CMAKE_DIR:-}" ]; then
  grep -v '^cmake.dir=' android/local.properties 2>/dev/null > android/local.properties.tmp || true
  echo "cmake.dir=$CMAKE_DIR" >> android/local.properties.tmp
  mv android/local.properties.tmp android/local.properties
fi

echo "== gradle assembleRelease ($ABI) $(date -u +%FT%TZ)"
cd android
# Lint-vital is skipped: this is a test build, and it is the slowest step.
./gradlew :app:assembleRelease -x lintVitalRelease --no-daemon -PreactNativeArchitectures="$ABI" \
  -Dorg.gradle.workers.max=4 -Dorg.gradle.jvmargs="-Xmx3g -XX:MaxMetaspaceSize=768m" \
  -Dkotlin.daemon.jvm.options=-Xmx1536m --console=plain
echo "== done $(date -u +%FT%TZ): $(ls -la app/build/outputs/apk/release/*.apk)"
