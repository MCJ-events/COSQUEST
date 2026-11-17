#!/usr/bin/env bash
# fid29 shots (frozen after fid29-base): game-camera frames of one tree, the way every lane and the baseline take them.
#   shots.sh --game /abs/app/game3d --out /abs/dir --tag NAME --faction icons --tier high [--arena street|trafalgar|
#     westminster|times_square|shoreditch] [--time golden|day|dusk] [--seed 239] [--phone] [--scale 0.6] [--look '{json}']
#     [--runs A,B] [--extra '"key": value,'] [--plan-extra '"crops": true,']
#   Runs (as the fid29 audit, skinlook-28's method): A = mid-fight at 4.4 s (effects on, HUD on and off) with the first 4
#   contact frames and a 6-frame strip at 3.0 s; B = enemy_hp 150 -> intro beat (0.9 s) and victory (1.7 s after the win).
#   --phone draws in a 1170x2532 window (iPhone class): the tier's own render scale and MSAA, Godot's upscale, the HUD
#   composited; without it 720x1280 (the audit's frames). --scale overrides the render scale (0.6 = dynamic resolution
#   under load). Godot 4.5.1 GL Compatibility on llvmpipe, --fixed-fps 30, quality "device", dyn_res off.
#   Every run goes through flock $FID/render.lock and gate.sh (one heavy step on the farm at a time).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FID=${FID:-$HOME/realism-20261111/fid29}
GODOT=${GODOT:-$HOME/lookfight/bin/godot}
G=""; O=""; TAG=""; FAC=icons; TIER=high; ARENA=street; TIME=golden; SEED=239; PHONE=0; SCALE=""; LOOK=""; RUNS="A,B"; EXTRA=""; PEXTRA=""
while [ $# -gt 0 ]; do case "$1" in
  --game) G=$2; shift 2;; --out) O=$2; shift 2;; --tag) TAG=$2; shift 2;; --faction) FAC=$2; shift 2;; --tier) TIER=$2; shift 2;;
  --arena) ARENA=$2; shift 2;; --time) TIME=$2; shift 2;; --seed) SEED=$2; shift 2;; --phone) PHONE=1; shift;;
  --scale) SCALE=$2; shift 2;; --look) LOOK=$2; shift 2;; --runs) RUNS=$2; shift 2;; --extra) EXTRA=$2; shift 2;;
  --plan-extra) PEXTRA=$2; shift 2;; *) echo "unknown $1" >&2; exit 2;; esac; done
[ -n "$G" ] && [ -n "$O" ] && [ -n "$TAG" ] || { echo "need --game --out --tag" >&2; exit 2; }
mkdir -p "$O/plans" "$O/logs"
PLACE=""
case "$ARENA" in
  street) ;;
  trafalgar) PLACE="\"arena\": \"place\", \"ground_json\": \"$HERE/places/trafalgar_staging.json\", \"place_at\": [-14.4, 19.8], \"point_name\": \"Trafalgar Square\",";;
  *) [ -f "$HERE/places/$ARENA.json" ] || { echo "no place $ARENA" >&2; exit 2; }
     PLACE="\"arena\": \"place\", \"ground_json\": \"$HERE/places/$ARENA.json\", \"place_at\": [0.0, 0.0],";;
esac
LK="\"time\": \"$TIME\""; [ -n "$SCALE" ] && LK="$LK, \"scale\": $SCALE"; [ -n "$LOOK" ] && LK="$LK, ${LOOK#\{}" && LK="${LK%\}}"
RS=""; [ -n "$SCALE" ] && RS="\"render_scale\": $SCALE,"
W=720; H=1280; [ $PHONE = 1 ] && W=1170 && H=2532
mk() {
cat > "$O/plans/$1.json" <<J
{"config": {"mode": "full", "duration_s": 45, "autoplay": true, "seed": $SEED, "load_thread": false, "place_thread": false,
  "quality": "device", "dyn_res": false, "point_name": "Trafalgar Square", "music": false, "sound": false, $PLACE $RS $EXTRA
  "look": {$LK}, "tier": "$TIER", "hero_cast": true, "faction": "$FAC", $2 "intro": true},
 "out": "$O", "prefix": "$1", "masks": false, "crops": true, "phone": $([ $PHONE = 1 ] && echo true || echo false), $PEXTRA $3}
J
}
case ",$RUNS," in *,A,*) mk ${TAG}_A "" "\"shots\": [{\"t\": 4.4, \"name\": \"mid\", \"game_only\": true}], \"hit_frames\": {\"n\": 4, \"delay\": 1}, \"strips\": [{\"t\": 3.0, \"name\": \"strip\", \"n\": 6}], \"quit_s\": 4.5";; esac
case ",$RUNS," in *,B,*) mk ${TAG}_B "\"enemy_hp\": 150," "\"beat_shot\": 0.9, \"win_shot\": 1.7, \"shots\": [], \"quit_s\": 99";; esac
cd "$G" || exit 1
for r in ${RUNS//,/ }; do p=${TAG}_$r; [ -f "$O/plans/$p.json" ] || continue
  ( flock 9; bash "$HERE/gate.sh" "${LANE:-}" || { echo "gate gave up"; exit 1; }
    t0=$(date +%s)
    timeout 2400 nice -n 10 bash "$HERE/xrun.sh" ${W}x${H} "$GODOT" --path . \
      --rendering-driver opengl3 --resolution ${W}x${H} --fixed-fps 30 -s res://tools/look_shots.gd -- --plan="$O/plans/$p.json" > "$O/logs/$p.log" 2>&1
    echo "$p rc=$? $(( $(date +%s) - t0 )) s" ) 9>"$FID/render.lock"
  grep -hE "SCRIPT ERROR|Parse Error" "$O/logs/$p.log" | head -3
  grep -h "CQLOOK perf\|CQLOOK view" "$O/logs/$p.log"
done
