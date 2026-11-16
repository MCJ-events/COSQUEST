#!/usr/bin/env bash
# fid29 farm gate (docs/game3d/fid29/COMMON.md), run before every heavy step of a lane:
#   1-min load <= 24, MemAvailable >= 6 GB, vmstat si+so < 100 pages/s over 5 s, and no other heavy Godot of this
#   lane running (one at a time). Waits in 55 s steps, gives up after 3 h (exit 1). Logs to $FID/gate.log.
#   gate.sh [lane]     (lane = the folder name under ~/realism-20261111/fid29, default: from $PWD)
#   On mm1 (CPU only): FID_HOST=mm1 gate.sh  -> load <= 16, MemAvailable >= 8 GB.
FID=${FID:-$HOME/realism-20261111/fid29}
LANE=${1:-$(pwd | sed -n -e 's#.*/fid29/\([^/]*\).*#\1#p' -e 's#.*/b29/\([^/]*\).*#\1#p' | head -1)}
MAXL=24; MINM=6
if [ "${FID_HOST:-}" = mm1 ]; then MAXL=16; MINM=8; FID=$HOME/cq-overflow/b29; fi
mkdir -p "$FID"
mine_busy() { for p in $(pgrep -u "$(id -u)" -f "godot.*--path" 2>/dev/null); do [ "$p" = "$$" ] && continue
  c=$(readlink /proc/$p/cwd 2>/dev/null); case "$c" in *fid29/$LANE/*|*b29/$LANE/*) return 0;; esac; done; return 1; }
for i in $(seq 1 200); do
  l=$(cut -d" " -f1 /proc/loadavg); ma=$(awk '/MemAvailable/ {print int($2/1048576)}' /proc/meminfo)
  sw=$(vmstat 5 2 | tail -1 | awk '{print $7+$8}')
  if awk -v l=$l -v m=$MAXL 'BEGIN{exit !(l<=m)}' && [ "$sw" -lt 100 ] && [ "$ma" -ge $MINM ] && ! mine_busy; then
    echo "$(date -u +%H:%M:%SZ) $LANE GATE ok load $l swap $sw avail ${ma}G" >> "$FID/gate.log"; exit 0; fi
  echo "$(date -u +%H:%M:%SZ) $LANE GATE wait load $l swap $sw avail ${ma}G" >> "$FID/gate.log"
  sleep 55
done
exit 1
