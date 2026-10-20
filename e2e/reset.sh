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

# The node process listening on a port, if it is one of ours (e2e/seed).
ours_on() {
  local pid
  pid=$(ss -ltnp 2>/dev/null | grep "127.0.0.1:$1 " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
  [ -n "$pid" ] && tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q "e2e/seed/" && echo "$pid"
}

restart() { # name script log port
  local pidf="$OUT/$1.pid" pid
  for pid in $( [ -f "$pidf" ] && cat "$pidf") $(ours_on "$4"); do
    kill "$pid" 2>/dev/null
  done
  # wait for the old one to let go of its port before the new one binds it
  for _ in $(seq 1 40); do ss -ltn | grep -q "127.0.0.1:$4 " || break; sleep 0.5; done
  (cd "$here/.." || exit 1; nohup node "$2" > "$3" 2>&1 &)
  for _ in $(seq 1 60); do pid=$(ours_on "$4") && break; sleep 0.5; done
  echo "${pid:-}" > "$pidf"
}

rm -f "$here/seed/.peer-state.json"
# Twice if need be: right after a call journey the old backend can take a
# while to let go (live sockets), and the first start then fails.
for attempt in 1 2; do
  restart chat-local e2e/seed/chat-local.js "$OUT/chat-local.log" 4120
  for _ in $(seq 1 60); do grep -q "\[chat-local\] ready\|failed" "$OUT/chat-local.log" 2>/dev/null && break; sleep 1; done
  grep -q "\[chat-local\] ready" "$OUT/chat-local.log" && break
  cp "$OUT/chat-local.log" "$OUT/chat-local.failed-$attempt.log"
  sleep 5
done
grep -q "\[chat-local\] ready" "$OUT/chat-local.log" || { echo "chat backend did not start, see $OUT/chat-local.log" >&2; exit 1; }

if ! curl -s -m 2 -o /dev/null -X POST http://127.0.0.1:4130/run; then
  restart peer-server e2e/seed/peer-server.js "$OUT/peer-server.log" 4130
  sleep 1
fi

if docker ps --format '{{.Names}}' | grep -qx "$GAME_PG"; then
  tables=$(docker exec "$GAME_PG" psql -U costquest -At -c \
    "select string_agg(distinct table_name, ', ') from information_schema.columns where column_name='device_key' and table_schema='public'")
  [ -n "$tables" ] && docker exec "$GAME_PG" psql -U costquest -q -c "TRUNCATE $tables CASCADE" 2>/dev/null
fi
echo "reset: chat seeded, game players cleared"
