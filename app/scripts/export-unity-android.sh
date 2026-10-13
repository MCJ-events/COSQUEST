#!/usr/bin/env bash
# Export the CostQuest Unity project as an Android library (a Gradle project)
# into modules/costquest-game/unity-android/export, for the app's Unity embed
# (config plugin option "unityAndroid": true; see unity-android/README.md).
#
#   scripts/export-unity-android.sh [--unity-project DIR] [--out DIR] [--probe-licence]
#
#   --unity-project DIR  an existing costquest-unity checkout (its sibling
#                        ../costquest-duel must exist: Packages/manifest.json
#                        references it by relative path). Default: clones
#                        git@github.com:ubmids/costquest-unity.git and
#                        costquest-duel into $CQ_UNITY_SRC (default
#                        ~/cq-work/unity-src) at the commits pinned in
#                        modules/costquest-game/FRAMEWORK_PIN.md.
#   --out DIR            default modules/costquest-game/unity-android/export
#   --probe-licence      with no licence file found, start the editor once in
#                        batch mode anyway and show what Unity itself says
#                        (it fails the same way; nothing is activated).
#
#   UNITY_EDITOR         the editor binary. Default: the pinned version (FRAMEWORK_PIN.md)
#                        under ~/Unity/Hub/Editor/<v>/Editor/Unity (Hub, Linux),
#                        ~/cq-work/tools/unity/<v>/Editor/Unity or /opt/unity/<v>/Editor/Unity
#                        (tarball install), or /Applications/Unity/Hub/Editor/<v>/Unity.app (macOS).
#
# Unity needs an ACTIVATED LICENCE to run at all, batch mode included. This
# script checks for one first and stops with instructions if there is none.
# It never activates, borrows or works around a licence.
#
# Writes unity-android/EXPORT_PIN: the Unity and duel commits, the editor
# version and the sha256 of the export, like FRAMEWORK_PIN.md does for iOS.
#
# Exit codes: 2 usage or editor missing, 3 no licence, 4 project checkout,
# 5 the Unity export failed.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOD="$APP_DIR/modules/costquest-game"
UA="$MOD/unity-android"
PIN_SRC="$MOD/FRAMEWORK_PIN.md"

pin() { grep -m1 "^$1=" "$PIN_SRC" | cut -d= -f2-; }
UNITY_COMMIT="${UNITY_COMMIT:-$(pin UNITY_COMMIT)}"
DUEL_COMMIT="${DUEL_COMMIT:-$(pin DUEL_COMMIT)}"
UNITY_VERSION="${UNITY_VERSION:-$(pin UNITY_EDITOR)}"
UNITY_REPO="${UNITY_REPO:-git@github.com:ubmids/costquest-unity.git}"
DUEL_REPO="${DUEL_REPO:-git@github.com:ubmids/costquest-duel.git}"

PROJECT=""
OUT="$UA/export"
PROBE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --unity-project) PROJECT="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --probe-licence|--probe-license) PROBE=1; shift ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

LOG_DIR="$UA/logs"
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/export-$STAMP.log"

say() { echo "[export-unity-android] $*"; }
die() { local code="$1"; shift; echo "[export-unity-android] ERROR: $*" >&2; exit "$code"; }

LICENCE_HELP="Unity needs an activated licence: run Unity Hub once and sign in, or \`Unity -batchmode -serial ...\` for Pro; see unity-android/README.md"

# --- 1. The editor ------------------------------------------------------------
find_editor() {
  if [ -n "${UNITY_EDITOR:-}" ]; then echo "$UNITY_EDITOR"; return; fi
  local c
  for c in \
    "$HOME/Unity/Hub/Editor/$UNITY_VERSION/Editor/Unity" \
    "$HOME/cq-work/tools/unity/$UNITY_VERSION/Editor/Unity" \
    "/opt/unity/$UNITY_VERSION/Editor/Unity" \
    "/Applications/Unity/Hub/Editor/$UNITY_VERSION/Unity.app/Contents/MacOS/Unity"; do
    if [ -x "$c" ]; then echo "$c"; return; fi
  done
}
EDITOR_BIN="$(find_editor)"
[ -n "$EDITOR_BIN" ] && [ -x "$EDITOR_BIN" ] || die 2 "Unity $UNITY_VERSION not found. Install it with Unity Hub (plus Android Build Support), or set UNITY_EDITOR=/path/to/Editor/Unity."
case "$EDITOR_BIN" in
  *"$UNITY_VERSION"*) ;;
  *) say "warning: $EDITOR_BIN does not look like Unity $UNITY_VERSION (the pinned editor)";;
esac
EDITOR_DIR="$(dirname "$EDITOR_BIN")"
ANDROID_PLAYER=""
for c in "$EDITOR_DIR/Data/PlaybackEngines/AndroidPlayer" "$EDITOR_DIR/../../../PlaybackEngines/AndroidPlayer" "$EDITOR_DIR/../../PlaybackEngines/AndroidPlayer"; do
  if [ -d "$c" ]; then ANDROID_PLAYER="$(cd "$c" && pwd)"; break; fi
done
[ -n "$ANDROID_PLAYER" ] || die 2 "Unity at $EDITOR_BIN has no Android Build Support (PlaybackEngines/AndroidPlayer). Add the module in Unity Hub."
say "editor: $EDITOR_BIN"
say "android support: $ANDROID_PLAYER"

# --- 2. The licence (before anything slow) ----------------------------------------
# Where Unity keeps an activation: the Licensing Client's entitlement file
# (Hub sign-in, Personal or Pro), a serial/manual activation (.ulf), or a
# floating/build-server licence configuration.
LICENCE_FILES=(
  "$HOME/.config/unity3d/Unity/licenses/UnityEntitlementLicense.xml"
  "$HOME/.local/share/unity3d/Unity/Unity_lic.ulf"
  "$HOME/.config/unity3d/Unity/licensing/services-config.json"
  "/usr/share/unity3d/config/services-config.json"
  "$HOME/Library/Unity/licenses/UnityEntitlementLicense.xml"
  "/Library/Application Support/Unity/Unity_lic.ulf"
  "/Library/Application Support/Unity/config/services-config.json"
)
LICENCE_FOUND=""
for f in "${LICENCE_FILES[@]}"; do
  if [ -s "$f" ]; then LICENCE_FOUND="$f"; break; fi
done

licence_failed_in() {
  grep -Eiq "no valid unity editor license|license is not active|licen[cs]e.*(not found|invalid|expired|failed)|no ulf license found|entitlement.*(denied|not found)|Unity has not been activated" "$1"
}

if [ -z "$LICENCE_FOUND" ]; then
  say "no Unity licence found in:"
  printf '  %s\n' "${LICENCE_FILES[@]}"
  if [ "$PROBE" = 1 ]; then
    say "probing: starting Unity once in batch mode to show its own licence check (log: $LOG)"
    # An empty project (Unity refuses a path that does not exist before it
    # gets to licensing). Unity starts its Licensing Client and Package
    # Manager as separate processes that can outlive the editor; stop the
    # ones this run started.
    PROBE_DIR="$(mktemp -d /tmp/cq-unity-probe.XXXXXX)"
    mkdir -p "$PROBE_DIR/probe/Assets" "$PROBE_DIR/probe/ProjectSettings"
    helpers='Unity.Licensing.Client|UnityPackageManager'
    before="$(pgrep -u "$(id -u)" -f "$helpers" | tr '\n' ' ' || true)"
    set +e
    timeout 300 "$EDITOR_BIN" -batchmode -nographics -quit -projectPath "$PROBE_DIR/probe" -logFile "$LOG"
    status=$?
    set -e
    sleep 1
    for pid in $(pgrep -u "$(id -u)" -f "$helpers" || true); do
      case " $before " in *" $pid "*) ;; *) kill "$pid" 2>/dev/null || true ;; esac
    done
    rm -rf "$PROBE_DIR"
    say "Unity exited with $status; its licence lines:"
    grep -Ei "licen[cs]|entitlement|activation|serial" "$LOG" | head -40 || true
  fi
  die 3 "$LICENCE_HELP"
fi
say "licence: $LICENCE_FOUND"

# --- 3. The Unity project ---------------------------------------------------------
checkout() { # repo dir commit
  local repo="$1" dir="$2" commit="$3"
  if [ ! -d "$dir/.git" ]; then
    say "cloning $repo into $dir"
    git clone --quiet "$repo" "$dir" || die 4 "could not clone $repo (needs GitHub access)"
  fi
  if ! git -C "$dir" cat-file -e "$commit^{commit}" 2>/dev/null; then
    git -C "$dir" fetch --quiet origin || die 4 "could not fetch $repo"
  fi
  if [ -n "$(git -C "$dir" status --porcelain)" ]; then
    die 4 "$dir has local changes; refusing to check out over them"
  fi
  git -C "$dir" checkout --quiet --detach "$commit" || die 4 "commit $commit not in $repo"
}

if [ -z "$PROJECT" ]; then
  SRC="${CQ_UNITY_SRC:-$HOME/cq-work/unity-src}"
  mkdir -p "$SRC"
  checkout "$UNITY_REPO" "$SRC/costquest-unity" "$UNITY_COMMIT"
  checkout "$DUEL_REPO" "$SRC/costquest-duel" "$DUEL_COMMIT"
  PROJECT="$SRC/costquest-unity"
fi
PROJECT="$(cd "$PROJECT" && pwd)"
[ -d "$PROJECT/Assets" ] && [ -f "$PROJECT/Packages/manifest.json" ] || die 4 "$PROJECT is not a Unity project"
if grep -q 'costquest-duel' "$PROJECT/Packages/manifest.json"; then
  [ -d "$PROJECT/../costquest-duel" ] || die 4 "Packages/manifest.json needs ../costquest-duel next to $PROJECT"
fi
ACTUAL_UNITY_COMMIT="$(git -C "$PROJECT" rev-parse HEAD 2>/dev/null || echo unknown)"
ACTUAL_DUEL_COMMIT="$(git -C "$PROJECT/../costquest-duel" rev-parse HEAD 2>/dev/null || echo unknown)"
[ "$ACTUAL_UNITY_COMMIT" = "$UNITY_COMMIT" ] || say "warning: costquest-unity is at $ACTUAL_UNITY_COMMIT, the pin says $UNITY_COMMIT"
[ "$ACTUAL_DUEL_COMMIT" = "$DUEL_COMMIT" ] || say "warning: costquest-duel is at $ACTUAL_DUEL_COMMIT, the pin says $DUEL_COMMIT"

if ! grep -rqs "expo.modules.costquestgame.unity.CQUnityEvents" "$PROJECT/Assets"; then
  say "warning: costquest-unity does not call the app on Android yet (no CQUnityEvents in Assets/):"
  say "         fights will run but the app will not hear ready/finished/quit. See unity-android/CQAndroidBridge.cs.template."
fi

# The build script: the project's own copy if it has one, else ours for this run only.
ADDED_SCRIPT_DIR=""
if ! grep -rqs "class CostQuestAndroidExport" "$PROJECT/Assets"; then
  ADDED_SCRIPT_DIR="$PROJECT/Assets/CostQuestExport"
  mkdir -p "$ADDED_SCRIPT_DIR/Editor"
  cp "$UA/Editor/CostQuestAndroidExport.cs" "$ADDED_SCRIPT_DIR/Editor/"
fi
cleanup() {
  if [ -n "$ADDED_SCRIPT_DIR" ]; then
    rm -rf "$ADDED_SCRIPT_DIR" "$ADDED_SCRIPT_DIR.meta"
  fi
  [ -n "${TMP_OUT:-}" ] && rm -rf "$TMP_OUT"
}
trap cleanup EXIT

# --- 4. Export ----------------------------------------------------------------------
TMP_OUT="$(mktemp -d /tmp/cq-unity-export.XXXXXX)/export"
say "exporting $PROJECT @ $ACTUAL_UNITY_COMMIT (log: $LOG)"
set +e
"$EDITOR_BIN" -batchmode -nographics -quit \
  -projectPath "$PROJECT" \
  -buildTarget Android \
  -executeMethod CostQuestAndroidExport.Export \
  -cqExportPath "$TMP_OUT" \
  -logFile "$LOG"
status=$?
set -e
if licence_failed_in "$LOG"; then
  grep -Ei "licen[cs]|entitlement" "$LOG" | head -20 || true
  die 3 "$LICENCE_HELP"
fi
[ "$status" = 0 ] && [ -f "$TMP_OUT/unityLibrary/build.gradle" ] || die 5 "Unity export failed ($status); see $LOG"

# Known side effect of every export (FRAMEWORK_PIN.md): URP rewrites this asset.
if git -C "$PROJECT" diff --quiet -- Assets/Settings/CQ_URP.asset 2>/dev/null; then :; else
  git -C "$PROJECT" checkout -- Assets/Settings/CQ_URP.asset 2>/dev/null && say "reverted Assets/Settings/CQ_URP.asset (export side effect)"
fi

rm -rf "$OUT"
mkdir -p "$(dirname "$OUT")"
mv "$TMP_OUT" "$OUT"

# --- 5. Pin -------------------------------------------------------------------------
SHA="$(cd "$OUT" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)"
FILES="$(find "$OUT" -type f | wc -l | tr -d ' ')"
cat > "$UA/EXPORT_PIN" <<EOF
# The Unity Android export in unity-android/export (gitignored), written by
# scripts/export-unity-android.sh. EXPORT_SHA256 is the sha256 of the sorted
# "sha256  ./path" list of every file in the export. A re-export is not
# byte-identical, so a new export means a new hash.
UNITY_COMMIT=$ACTUAL_UNITY_COMMIT
DUEL_COMMIT=$ACTUAL_DUEL_COMMIT
UNITY_EDITOR=$UNITY_VERSION
EXPORT_SHA256=$SHA
EXPORT_FILES=$FILES
EXPORTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
say "done: $OUT ($FILES files, sha256 $SHA)"
say "next: set \"unityAndroid\": true in app.json, then: npx expo prebuild --platform android --clean"
say "      and build arm64-v8a (Unity has no x86_64 libraries)."
