#!/usr/bin/env bash
# motion_measure.sh: the motion bar in one command (realism-20261111, BAR.md section C).
#
# Records seeded 45 s autoplay fights headless (no pictures: this is numbers only) with the per-frame
# motion probe, then prints the report: foot slide per step and state, attacks off target, bind and
# T-pose frames, foot speed against body speed, anticipation / contact / follow-through per blow,
# whether the hips move in a stagger, and the tear share per state and LOD.
#
#   tools/anim/motion_measure.sh --out /abs/dir [--name build21] [--game /abs/game3d]
#        [--trio armstrong,bobo,hoof] [--forge /abs/dir/with/<key>/lodN.glb] [--lod 1]
#        [--weapon /abs/sword.glb --wclass sword | --no-weapon] [--seed 239] [--loss-seed 7]
#        [--extra '"motion":"classic"'] [--runs win,loss] [--reports /abs/reports]
#
# --game   the game3d tree to measure (default: the one this script is in). Any build with the
#          "anim_probe" hook (build 18 on) works: this script copies its own probe (v2) over that
#          tree's tools/anim_probe.gd first (the old one is kept as anim_probe.gd.orig).
# --trio   hero,ally,enemy: cast keys (res://cast/<key>_lod<N>.glb), or with --forge the names of
#          folders holding lod0/1/2.glb (their clip libraries must be in that tree's anim_clips.json).
# --runs   win = the seeded fight the bot wins (idle, jog, combo, skills, Guardian KO, victory);
#          loss = the hero stands idle and is beaten (hits on the hero, the hero's KO).
# Writes <out>/<name>_{win,loss}.probe.jsonl, <name>.motion.json and <name>.motion.md.
# Needs: Godot 4.5 (GODOT, default ~/lookfight/bin/godot), python3. Runs on the farm; about 1 minute.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GAME="$(cd "$HERE/../.." && pwd)"
GODOT="${GODOT:-$HOME/lookfight/bin/godot}"
OUT=""; NAME="motion"; TRIO="armstrong,bobo,hoof"; FORGE=""; LOD=1; SEED=239; LSEED=7; EXTRA=""; RUNS="win,loss"
WEAPON="${WEAPON:-$HOME/fightanim/weapons/knight_sword.glb}"; WCLASS="sword"; REPORTS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --game) GAME="$2"; shift 2;; --out) OUT="$2"; shift 2;; --name) NAME="$2"; shift 2;;
    --trio) TRIO="$2"; shift 2;; --forge) FORGE="$2"; shift 2;; --lod) LOD="$2"; shift 2;;
    --seed) SEED="$2"; shift 2;; --loss-seed) LSEED="$2"; shift 2;; --extra) EXTRA="$2"; shift 2;;
    --runs) RUNS="$2"; shift 2;; --weapon) WEAPON="$2"; shift 2;; --wclass) WCLASS="$2"; shift 2;;
    --no-weapon) WEAPON=""; shift;; --reports) REPORTS="$2"; shift 2;;
    *) echo "unknown option $1" >&2; exit 2;;
  esac
done
[ -n "$OUT" ] || { echo "--out is required" >&2; exit 2; }
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
GAME="$(cd "$GAME" && pwd)"
[ -n "$REPORTS" ] || REPORTS="$GAME/tools/anim/reports"
if ! cmp -s "$HERE/../anim_probe.gd" "$GAME/tools/anim_probe.gd"; then
  [ -f "$GAME/tools/anim_probe.gd" ] && [ ! -f "$GAME/tools/anim_probe.gd.orig" ] && cp "$GAME/tools/anim_probe.gd" "$GAME/tools/anim_probe.gd.orig"
  cp "$HERE/../anim_probe.gd" "$GAME/tools/anim_probe.gd"
fi
IFS=, read -r H A E <<< "$TRIO"
glb() { if [ -n "$FORGE" ]; then echo "$FORGE/$1/lod$LOD.glb"; else echo "res://cast/$1_lod$LOD.glb"; fi; }
WJ=""; [ -n "$WEAPON" ] && WJ="\"hero_weapon\":{\"glb\":\"$WEAPON\",\"class\":\"$WCLASS\"},"
[ -n "$FORGE" ] && WJ="$WJ\"rig_fixes\":false,"
[ -n "$EXTRA" ] && EXTRA=",$EXTRA"
LOGS=()
run() { # run name, seed, extra json
  local cfg; cfg=$(mktemp --suffix=.json)
  cat > "$cfg" <<J
{"mode":"full","duration_s":45,"autoplay":true,"seed":$2,"load_thread":false,
 "hero_glb":"$(glb "$H")","ally_glb":"$(glb "$A")","enemy_glb":"$(glb "$E")",
 "hero_key":"$H","ally_key":"$A","enemy_key":"$E","hero_name":"Hero","ally_name":"Ally","enemy_name":"Guardian",
 $WJ "point_name":"Trafalgar Square","dyn_res":false,"anim_probe":"$OUT/$1.probe.jsonl" $3 $EXTRA}
J
  local capped=(); [ -x "$HOME/lookfight/bin/capped" ] && capped=("$HOME/lookfight/bin/capped" 4G)
  (cd "$GAME" && timeout 900 "${capped[@]}" "$GODOT" --headless --path . --fixed-fps 30 --quit-after 1900 -- --autotest --config="$cfg" > "$OUT/$1.log" 2>&1) || true
  rm -f "$cfg"
  if grep -q "SCRIPT ERROR" "$OUT/$1.log"; then echo "!! script errors in $OUT/$1.log:" >&2; grep -m5 -A2 "SCRIPT ERROR" "$OUT/$1.log" >&2; fi
  grep -o "CQRESULT .*" "$OUT/$1.log" | cut -c10- | python3 -c "import sys,json,hashlib;d=json.loads(sys.stdin.read());d.pop('load_ms',None);print('$1', d['outcome'], d['time_s'], 'hits', d['hits'], 'md5', hashlib.md5(json.dumps(d,sort_keys=True).encode()).hexdigest()[:12])" || echo "$1: no CQRESULT (see $OUT/$1.log)"
  LOGS+=("$OUT/$1.probe.jsonl")
}
case ",$RUNS," in *,win,*) run "${NAME}_win" "$SEED" "";; esac
case ",$RUNS," in *,loss,*) run "${NAME}_loss" "$LSEED" ",\"bot\":\"idle\"";; esac
# the faction heroes (mid and high tiers): the tree swaps the cast for heroes and says which in its log;
# name the fighters by what they really wore (the first run's: the hero is the same in both)
for r in hero ally enemy; do
  k=$(grep -ho "hero cast role=$r key=[a-z_0-9]*" "${LOGS[0]%.probe.jsonl}.log" 2>/dev/null | head -1 | sed 's/.*key=//') || true
  if [ -n "$k" ]; then case $r in hero) H=$k;; ally) A=$k;; enemy) E=$k;; esac; fi
done
python3 "$HERE/motion_report.py" "${LOGS[@]}" --keys "hero=$H,ally=$A,enemy=$E" --reports "$REPORTS" \
  --json "$OUT/$NAME.motion.json" --md "$OUT/$NAME.motion.md" --label "$NAME (lod$LOD)"
