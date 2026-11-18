#!/usr/bin/env bash
# One mote engine per app (build 21). The Sparks SDK's engine
# (node_modules/@cosquest/sparks-sdk/cpp/mote) is the only copy compiled; the
# game module carries only its public C declarations (Embed/Engine), which must
# be byte-identical to the SDK's so the structs Swift fills match the code.
#   scripts/check-one-mote-engine.sh            source check
#   scripts/check-one-mote-engine.sh <binary>   also: the linked binary has one
#                                               mote_create_from_files and the v5 loader
set -euo pipefail
APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK="$APP/node_modules/@cosquest/sparks-sdk/cpp/mote"
GAME="$APP/modules/costquest-game/ios"
fail() { echo "FAIL: $*" >&2; exit 1; }
[ -f "$SDK/mote_lib.c" ] || fail "no SDK engine at $SDK (npm install first)"
grep -q '#define MQ_VERSION 5' "$SDK/model.h" || fail "SDK engine is not .mq v5"
n=$(find "$APP/modules" -name '*.c' \( -name 'model.c' -o -name 'mote_lib.c' -o -name 'forward.c' \) -not -path '*/build/*' | wc -l | tr -d ' ')
[ "$n" = 0 ] || fail "$n mote engine source file(s) under modules/ (only the SDK's may exist)"
for h in mote_lib.h error.h; do
  cmp -s "$SDK/$h" "$GAME/Embed/Engine/$h" || fail "Embed/Engine/$h differs from the SDK's (copy it from $SDK)"
done
echo "ok: one engine source (sparks-sdk, MQ_VERSION 5); game headers match"
if [ $# -ge 1 ]; then
  bin=$1
  syms=$(nm -m "$bin" 2>/dev/null | grep -c ' external _mote_create_from_files$' || true)
  [ "$syms" = 1 ] || fail "$bin defines _mote_create_from_files $syms times"
  loader=$(strings -a "$bin" | grep -c 'unsupported .mq version %d' || true)
  [ "$loader" -ge 1 ] || fail "$bin has no mote loader"
  echo "ok: $bin links one mote engine"
fi
