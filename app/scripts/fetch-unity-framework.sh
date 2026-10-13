#!/usr/bin/env bash
#
# Puts the PINNED UnityFramework.framework into
# modules/costquest-game/ios/Frameworks/ (gitignored, ~100+ MB). Runs on the
# Mac that builds the iOS app.
#
# The pin is modules/costquest-game/FRAMEWORK_PIN.md, copied from
# costquest-ios by scripts/sync-game-from-ios.sh, so the framework always
# matches the game sources it is built with. This downloads the release it
# names with the GitHub CLI (ubmids/costquest-ios is private, so `gh` must be
# signed in to an account that can read it) and refuses a binary whose sha256
# differs from the pin.
#
#   scripts/fetch-unity-framework.sh            download + verify (no-op if already there)
#   scripts/fetch-unity-framework.sh --check    verify what is there, download nothing
#
# After fetching, run `npx pod-install` (or scripts/verify-ios.sh): the pod
# decides at `pod install` time whether Unity is in (see CostQuestGame.podspec).
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOD="$APP_DIR/modules/costquest-game"
PIN="$MOD/FRAMEWORK_PIN.md"
DEST="$MOD/ios/Frameworks"
FW="$DEST/UnityFramework.framework"

pin() { grep -E "^$1=" "$PIN" | head -1 | cut -d= -f2-; }
WANT_SHA="$(pin FRAMEWORK_SHA256)"
RELEASE_REPO="$(pin RELEASE_REPO)"
RELEASE_TAG="$(pin RELEASE_TAG)"
if [ -z "$WANT_SHA" ] || [ -z "$RELEASE_REPO" ] || [ -z "$RELEASE_TAG" ]; then
  echo "FRAMEWORK_PIN.md is missing FRAMEWORK_SHA256 / RELEASE_REPO / RELEASE_TAG" >&2
  exit 1
fi

sha_of() { shasum -a 256 "$1" | cut -d' ' -f1; }
have_sha() { [ -f "$FW/UnityFramework" ] && sha_of "$FW/UnityFramework"; }

if [ "$(have_sha || true)" = "$WANT_SHA" ]; then
  echo "UnityFramework already matches the pin ($WANT_SHA)"
  exit 0
fi
if [ "${1:-}" = "--check" ]; then
  echo "UnityFramework missing or not the pinned one (want $WANT_SHA, have $(have_sha || echo none))" >&2
  exit 1
fi

command -v gh >/dev/null || { echo "needs the GitHub CLI (brew install gh), signed in" >&2; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "==> downloading $RELEASE_TAG from $RELEASE_REPO"
gh release download "$RELEASE_TAG" -R "$RELEASE_REPO" -p 'UnityFramework.framework.zip' -D "$tmp"
(cd "$tmp" && ditto -x -k UnityFramework.framework.zip .)
got="$(sha_of "$tmp/UnityFramework.framework/UnityFramework")"
if [ "$got" != "$WANT_SHA" ]; then
  echo "downloaded sha256 $got != pin $WANT_SHA: refusing it" >&2
  exit 1
fi
[ -d "$tmp/UnityFramework.framework/Data" ] || { echo "downloaded framework has no Data/" >&2; exit 1; }
mkdir -p "$DEST"
rm -rf "$FW"
cp -R "$tmp/UnityFramework.framework" "$DEST/"
echo "==> modules/costquest-game/ios/Frameworks/UnityFramework.framework = pin ($WANT_SHA)"
