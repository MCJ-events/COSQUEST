#!/usr/bin/env bash
# fid29 charshade: the arena wide shot of one tree, the same moment and camera for b28 and new.
#   wide.sh GAME_DIR OUT_DIR TAG [TIER] [FACTION]   (Trafalgar, golden, seed 239: the shots.sh plan with one extra view,
#   a wide side camera 16 m out at 2.4 s, beside the game camera)
set -uo pipefail
G=$1; O=$2; TAG=$3; TIER=${4:-high}; FAC=${5:-blockbusters}
FID=${FID:-$HOME/realism-20261111/fid29}; GODOT=${GODOT:-$HOME/lookfight/bin/godot}
HERE=$G/tools/fid29
mkdir -p "$O/plans" "$O/logs"
cat > "$O/plans/${TAG}_W.json" <<J
{"config": {"mode": "full", "duration_s": 45, "autoplay": true, "seed": 239, "load_thread": false, "place_thread": false,
  "quality": "device", "dyn_res": false, "point_name": "Trafalgar Square", "music": false, "sound": false,
  "arena": "place", "ground_json": "$HERE/places/trafalgar_staging.json", "place_at": [-14.4, 19.8],
  "look": {"time": "golden"}, "tier": "$TIER", "hero_cast": true, "faction": "$FAC", "intro": true},
 "out": "$O", "prefix": "${TAG}_W", "masks": false, "crops": false, "phone": false,
 "side": {"dist": 16, "pitch": 12, "yaw": 60}, "shots": [{"t": 2.4, "name": "wide"}], "quit_s": 2.6}
J
cd "$G" || exit 1
( flock 9; bash "$HERE/gate.sh" "${LANE:-}" || exit 1
  t0=$(date +%s)
  timeout 1500 nice -n 10 bash "$HERE/xrun.sh" 720x1280 "$GODOT" --path . --rendering-driver opengl3 --resolution 720x1280 \
    --fixed-fps 30 -s res://tools/look_shots.gd -- --plan="$O/plans/${TAG}_W.json" > "$O/logs/${TAG}_W.log" 2>&1
  echo "${TAG}_W rc=$? $(( $(date +%s) - t0 )) s" ) 9>"$FID/render.lock"
grep -h "CQLOOK perf" "$O/logs/${TAG}_W.log"
