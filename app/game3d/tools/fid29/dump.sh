#!/usr/bin/env bash
# fid29 frame cost dump (frozen after fid29-base): fid29_audit.gd at mid-fight (or --t) for one tree, tier, arena, hero.
#   dump.sh --game /abs/app/game3d --out /abs/x.json --tier high [--arena street|trafalgar|<place>] [--faction icons]
#     [--time golden] [--t 4.4] [--phone] [--look '{json}'] [--intro 0.9] [--win 1.7]
#   --intro S / --win S dump at the hero's intro beat / after the win instead (enemy_hp 150 for --win).
#   Writes draws, primitives, objects, texture and video memory, textures by owner, triangles by owner (sumdump.py reads it).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FID=${FID:-$HOME/realism-20261111/fid29}
GODOT=${GODOT:-$HOME/lookfight/bin/godot}
G=""; OUT=""; TIER=high; ARENA=street; FAC=icons; TIME=golden; T=4.4; PHONE=0; LOOK=""; AT=""
while [ $# -gt 0 ]; do case "$1" in
  --game) G=$2; shift 2;; --out) OUT=$2; shift 2;; --tier) TIER=$2; shift 2;; --arena) ARENA=$2; shift 2;;
  --faction) FAC=$2; shift 2;; --time) TIME=$2; shift 2;; --t) T=$2; shift 2;; --phone) PHONE=1; shift;;
  --look) LOOK=$2; shift 2;; --intro) AT="--intro=$2"; shift 2;; --win) AT="--win=$2"; shift 2;; *) echo "unknown $1" >&2; exit 2;; esac; done
PLACE=""
case "$ARENA" in
  street) ;;
  trafalgar) PLACE="\"arena\": \"place\", \"ground_json\": \"$HERE/places/trafalgar_staging.json\", \"place_at\": [-14.4, 19.8],";;
  *) PLACE="\"arena\": \"place\", \"ground_json\": \"$HERE/places/$ARENA.json\", \"place_at\": [0.0, 0.0],";;
esac
LK="\"time\": \"$TIME\""; [ -n "$LOOK" ] && LK="$LK, ${LOOK#\{}" && LK="${LK%\}}"
EHP=""; case "$AT" in --win*) EHP="\"enemy_hp\": 150,";; esac
W=720; H=1280; [ $PHONE = 1 ] && W=1170 && H=2532
CFG=$(mktemp --suffix=.json)
cat > "$CFG" <<J
{"mode": "full", "duration_s": 45, "autoplay": true, "seed": 239, "load_thread": false, "place_thread": false,
 "quality": "device", "dyn_res": false, "point_name": "Trafalgar Square", "music": false, "sound": false, $PLACE $EHP
 "look": {$LK}, "tier": "$TIER", "hero_cast": true, "faction": "$FAC", "intro": true}
J
cd "$G" || exit 1
( flock 9; bash "$HERE/gate.sh" "${LANE:-}" || exit 1
  timeout 1500 nice -n 10 bash "$HERE/xrun.sh" ${W}x${H} "$GODOT" --path . \
    --rendering-driver opengl3 --resolution ${W}x${H} --fixed-fps 30 -s res://tools/fid29/fid29_audit.gd -- \
    --cfg="$CFG" --out="$OUT" --t=$T $AT > "${OUT%.json}.log" 2>&1 ) 9>"$FID/render.lock"
rm -f "$CFG"
grep -h "FID29\|SCRIPT ERROR" "${OUT%.json}.log" | head -3
