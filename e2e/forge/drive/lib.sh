# Helpers for the Forge proof's adb drivers (cq 056). Sourced by the drivers
# journey.sh runs for *.sh "flows". Coordinates are for the journeys' AVD
# (1080x2400, 420 dpi); every step leaves a screenshot in $SHOTS.
set -uo pipefail
APP=com.dammy0227.cosquest
DRIVE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$SHOTS"
say() { echo "$(date -u +%T) $*"; }
tap() { say "tap $1 $2${3:+ ($3)}"; adb shell input tap "$1" "$2"; }
shot() { adb exec-out screencap -p > "$SHOTS/$1.png"; say "shot $1"; }
wait_s() { sleep "$1"; }
link() { say "link $1"; adb shell am start -a android.intent.action.VIEW -d "$1" "$APP" >/dev/null; }
# The map, ready: the app up, the game page, the Warden's cards put away
# (plain UI, so Maestro does it).
prep() {
  "$MAESTRO" test ${ANDROID_SERIAL:+--device "$ANDROID_SERIAL"} "$DRIVE/prep.yaml" > "$SHOTS/prep.log" 2>&1 || { say "prep failed"; tail -5 "$SHOTS/prep.log"; return 1; }
}
# Did the app die (low memory, a native abort)?
alive() { adb shell pidof "$APP" >/dev/null || { say "APP NOT RUNNING"; adb logcat -d | grep -E "lowmemorykiller: Kill '$APP|F libc|E Filament" | tail -5; return 1; }; }

# Screen spots (1080x2400)
HUD_CHIP="180 366"
BAG_ITEMS="154 485"; BAG_AVATAR="382 485"; BAG_CLOSE="976 362"
BAG_IDLE="192 1336"; BAG_WALK="371 1336"; BAG_CELEBRATE="599 1336"; BAG_WEAR="852 1336"; BAG_EQUIP="540 1336"
BAG_TILE2="467 1594"
MAP_ME="540 1310"
CLAIM_MAIN="540 1758"; CLAIM_OPEN_BAG="540 1923"; CLAIM_CLOSE_WON="540 2046"
SHEET_PLAY="771 2139"
