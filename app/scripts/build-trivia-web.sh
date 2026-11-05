#!/bin/bash
# The public trivia web page: an Expo web build of the trivia screen, served by
# the game server's own Caddy site at https://<game server>/play (same origin as
# the API, so no CORS anywhere).
#
#   scripts/build-trivia-web.sh staging    <out dir>
#   scripts/build-trivia-web.sh production <out dir>
#
# A clean environment on purpose: every EXPO_PUBLIC_* value is inlined into a
# page anyone can download, so only the three below go in.
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET=${1:?staging or production}
OUT=${2:?output directory}
case "$TARGET" in staging|production) ;; *) echo "staging or production"; exit 2 ;; esac
env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" NODE_ENV=production \
  EXPO_PUBLIC_GAME_SERVER="$TARGET" EXPO_PUBLIC_TRIVIA_WEB=1 EXPO_WEB_BASE_URL=/play \
  npx expo export --platform web --output-dir "$OUT" --clear
echo "$TARGET $(git rev-parse --short HEAD) $(date -u +%FT%TZ)" > "$OUT/BUILD.txt"
du -sh "$OUT"
