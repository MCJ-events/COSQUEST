#!/usr/bin/env bash
# A clean world before a journey: restart the local chat backend (a fresh
# seed, new user ids), forget every player in the local game DB, and make sure
# the peer server is up.
#
# Env: OUT [e2e/out] (pid files, logs), GAME_PG [cx054-game-pg]
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
: "${OUT:=$here/out}"
: "${GAME_PG:=cx054-game-pg}"
mkdir -p "$OUT"

restart() { # name script log
  local pidf="$OUT/$1.pid"
  if [ -f "$pidf" ] && kill -0 "$(cat "$pidf")" 2>/dev/null; then
    kill "$(cat "$pidf")"
    for _ in $(seq 1 20); do kill -0 "$(cat "$pidf")" 2>/dev/null || break; sleep 0.5; done
  fi
  (cd "$here/.." && nohup node "$2" > "$3" 2>&1 & echo $! > "$pidf")
}

rm -f "$here/seed/.peer-state.json"
restart chat-local e2e/seed/chat-local.js "$OUT/chat-local.log"
for _ in $(seq 1 60); do grep -q "\[chat-local\] ready\|failed" "$OUT/chat-local.log" 2>/dev/null && break; sleep 1; done
grep -q "\[chat-local\] ready" "$OUT/chat-local.log" || { echo "chat backend did not start, see $OUT/chat-local.log" >&2; exit 1; }

if ! curl -s -m 2 -o /dev/null -X POST http://127.0.0.1:4130/run; then
  restart peer-server e2e/seed/peer-server.js "$OUT/peer-server.log"
  sleep 1
fi

if docker ps --format '{{.Names}}' | grep -qx "$GAME_PG"; then
  tables=$(docker exec "$GAME_PG" psql -U costquest -At -c \
    "select string_agg(distinct table_name, ', ') from information_schema.columns where column_name='device_key' and table_schema='public'")
  [ -n "$tables" ] && docker exec "$GAME_PG" psql -U costquest -q -c "TRUNCATE $tables CASCADE" 2>/dev/null
fi
echo "reset: chat seeded, game players cleared"
