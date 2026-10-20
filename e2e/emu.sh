#!/usr/bin/env bash
# The Android emulator for the journeys (one at a time on the farm).
#
#   e2e/emu.sh up [apk]     boot the AVD headless, install the APK, tunnel the
#                           local backends, park the phone at Trafalgar Square
#   e2e/emu.sh install apk  reinstall the app
#   e2e/emu.sh down         stop the emulator this script started
#   e2e/emu.sh adb ...      adb against the journeys' emulator
#
# Env: ANDROID_HOME (SDK), AVD [cx054], EMU_MEM [3072], OUT (logs) [e2e/out]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
: "${ANDROID_HOME:=$HOME/cq-work/tools/android-sdk}"
export ANDROID_HOME ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
: "${AVD:=cx054}"
: "${EMU_MEM:=3072}"
: "${OUT:=$here/out}"
mkdir -p "$OUT"
pidfile="$OUT/emulator.pid"
apk_default="$here/../app/android/app/build/outputs/apk/release/app-release.apk"

# Ports on this machine the app reaches as localhost on the phone.
#   4120 chat backend, 8399 game backend, 7880/7881 LiveKit signalling/TCP.
tunnels() {
  for p in 4120 8399 7880 7881; do adb reverse "tcp:$p" "tcp:$p" >/dev/null; done
}

case "${1:-}" in
  up)
    apk="${2:-$apk_default}"
    if ! adb get-state >/dev/null 2>&1; then
      nohup sg kvm -c "$ANDROID_HOME/emulator/emulator -avd $AVD -no-window -no-audio -no-boot-anim \
        -gpu swiftshader_indirect -no-snapshot -memory $EMU_MEM -cores 4" > "$OUT/emulator.log" 2>&1 &
      echo $! > "$pidfile"
      echo "emulator launcher pid $(cat "$pidfile")"
    fi
    adb wait-for-device
    for _ in $(seq 1 120); do
      [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break
      sleep 3
    done
    adb shell settings put system screen_off_timeout 1800000
    adb shell settings put global window_animation_scale 0
    adb shell settings put global transition_animation_scale 0
    adb shell settings put global animator_duration_scale 0
    adb emu geo fix -0.1278 51.5074 >/dev/null
    adb install -r -g "$apk" | tail -1
    tunnels
    ;;
  install)
    adb install -r -g "${2:-$apk_default}" | tail -1
    tunnels
    ;;
  tunnels) tunnels ;;
  down)
    adb emu kill >/dev/null 2>&1 || true
    sleep 5
    if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then kill "$(cat "$pidfile")"; fi
    rm -f "$pidfile"
    ;;
  adb) shift; adb "$@" ;;
  *) sed -n 2,12p "$0"; exit 2 ;;
esac
