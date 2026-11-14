#!/usr/bin/env bash
# fightkit_build.sh <key> <dir with the published lod0.glb lod1.glb lod2.glb> <out dir> [--rigged]
#
# Build 28 (13 Nov 2026): one Forge character's FIGHT KIT, the files a phone downloads with the
# character so it fights with real moves without a new app build (the app's
# features/game3d/fightKit.ts, Godot's anim_library.gd register_kit, the backend's
# app/forge_fightkit.py; driven for every published character by the backend's
# tools/fightkit_sync.py). Run on the farm from app/game3d of a checkout kept for this (it writes
# the character into that checkout's data/anim_clips.json, like add_hero.sh). CPU only.
#
#   --rigged   the published files already carry the game's 25-bone skeleton: the library is
#              built on them and the kit is anim.glb + anim.json.
#   otherwise  the published version is static: each rig method of Forge's rig stage rigs the
#              files (landmarks; Make-It-Animatable v1; the CC0 human base body, which splits
#              bridging triangles and is relaxed against the fight's own clips, for capes and coats),
#              the library is built on each, and the best that passes is kept (most readable picks,
#              then the lowest worst tear); the kit also carries those rigged lod0..2.glb.
#
# The gates are the game's, per clip: every clip a state plays tears under 0.5 % of triangles on
# LOD0 to LOD2 (run and sprint 1 %), the core states (idle, hit, ...) must all have one, and every
# readable button pick must face the target at contact (cuts within 45 deg, the rest 90) with no
# T-pose frame; a readable pick that does not is dropped (that button keeps its classic clip).
# Forge's own clip gates (its idle, walk and celebrate, which no fight plays) are relaxed for this;
# its skeleton checks (arms found, neck height, left and right limbs alike) still apply.
#
# Writes <out>/anim.glb, anim.json, [lod0..2.glb], verdict.json {ok, key, method, why, gates}.
# Exit 0 with ok true, 3 when no method passes (verdict says why), 2 on a usage or setup error.
#
# Needs: RENDERER (a copy of the Forge renderer at a commit with the base method, envgen/rig.py and
# deploy/base_*; never the live service's folder), RENDERER_PY (its venv's python, read only), BLENDER_BIN, FORGE_MIA_PY, FORGE_MIA_WEIGHTS; add_hero.sh's sources.
set -uo pipefail
key=${1:?key}; src=${2:?published lods}; out=${3:?out dir}; rigged=0; [ "${4:-}" = "--rigged" ] && rigged=1
[[ "$key" =~ ^[a-z0-9_]{1,48}$ ]] || { echo "key must be lowercase letters, digits and _" >&2; exit 2; }
G=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
RENDERER=${RENDERER:-$HOME/realism-20261111/forge-autorig-27/renderer-head}
RENDERER_PY=${RENDERER_PY:-$HOME/forge/costquest-renderer/.venv/bin/python}
export BLENDER_BIN=${BLENDER_BIN:-$HOME/forge/blender/blender}
export FORGE_MIA_PY=${FORGE_MIA_PY:-$HOME/forge/mia-venv/bin/python} FORGE_MIA_WEIGHTS=${FORGE_MIA_WEIGHTS:-$HOME/forge/mia-weights-v1}
WORK=${WORK:-$out/work}
mkdir -p "$out" "$WORK"
rm -f "$out"/anim.glb "$out"/anim.json "$out"/lod?.glb "$out"/verdict.json
[ -f "$src/lod1.glb" ] || { echo "no lod1.glb in $src" >&2; exit 2; }
cd "$G"

# Mark's farm comes first (AIMM, the live Forge; the farm gate of 14 Nov): before each heavy step wait
# unless the 1-minute load is at most 24, nothing is being swapped (vmstat si+so under 100 pages/s over
# 5 s) and at least 6 GB are available (8 GB before a Make-It-Animatable step). FIGHTKIT_NO_WAIT=1 skips it.
wait_load() {
  [ "${FIGHTKIT_NO_WAIT:-0}" = 1 ] && return 0
  local need=${1:-6}
  while :; do
    local l a sw; l=$(cut -d" " -f1 /proc/loadavg)
    a=$(awk '/MemAvailable/{print int($2/1048576)}' /proc/meminfo)
    sw=$(vmstat 5 2 | tail -1 | awk '{print $7+$8}')
    if awk -v l="$l" 'BEGIN{exit !(l<=24)}' && [ "$sw" -lt 100 ] && [ "$a" -ge "$need" ]; then return 0; fi
    echo "FIGHTKIT waiting: load $l, swapping $sw pages/s, $a GB available (need $need) ($(date -u +%H:%M:%S))" >&2
    sleep 60
  done
}

rig_with() {   # <method> <dir>: Forge's rig stage on a copy of the published files; prints rigged or why
  local m=$1 d=$2
  wait_load $([ "$m" = landmarks ] && echo 6 || echo 8)
  rm -rf "$d"; mkdir -p "$d"; cp "$src"/lod?.glb "$d/"
  python3 -c "import json,sys,glob,os;l=sorted(int(os.path.basename(p)[3]) for p in glob.glob(sys.argv[1]+'/lod?.glb'));json.dump({'lods':[{'lod':i,'file':'lod%d.glb'%i} for i in l]},open(sys.argv[1]+'/optimize.json','w'))" "$d"
  (cd "$RENDERER" && env PYTHONDONTWRITEBYTECODE=1 FORGE_RIG_METHOD=$m FORGE_MIA_DEVICE=cpu CUDA_VISIBLE_DEVICES= \
     FORGE_RIG_MAX_IDLE_TEAR=1 FORGE_RIG_MAX_TEAR=1 FORGE_RIG_MAX_STRETCH=100000 \
     nice -n 10 "$RENDERER_PY" -c "
import json, sys
from pathlib import Path
from envgen import rig
r = rig.run({'cls': 'character'}, Path(sys.argv[1]))
print('RIG', json.dumps({'rigged': r.get('rigged'), 'method': r.get('method'), 'reason': r.get('reason')}))
" "$d") 2>/dev/null | grep '^RIG ' | tail -1
}

lib_on() {     # <key> <dir with rigged lods>: the library and its gate verdict (fightkit_gate.py)
  local k=$1 d=$2
  wait_load
  HERO_CAST=$WORK/cast HERO_OUT=$WORK/sidecar ARM_DROOP=${ARM_DROOP:-0.9} bash tools/anim/add_hero.sh "$k" "$d" > "$WORK/$k.add_hero.log" 2>&1
  python3 tools/anim/fightkit_gate.py "$k" --sidecar "$WORK/sidecar/$k" --report "$WORK/$k.gate.json" > "$WORK/$k.gate.log" 2>&1
  tail -1 "$WORK/$k.gate.log"
}

if [ $rigged = 1 ]; then
  echo "FIGHTKIT $key: library on the published (rigged) files"
  lib_on "$key" "$src"
  python3 tools/anim/fightkit_gate.py --pick "$out" "$key" "published" "$WORK/$key.gate.json" "$WORK/sidecar/$key" ""
  exit $?
fi
cands=()
for m in ${METHODS:-landmarks mia base}; do
  case $m in mia) s=mia;; base) s=base;; *) s=lm;; esac
  r=$(rig_with $m "$WORK/rig_$s")
  echo "FIGHTKIT $key $m: ${r#RIG }"
  echo "$r" | grep -q '"rigged": true' || { echo "{\"ok\": false, \"why\": $(python3 -c 'import json,sys;print(json.dumps(json.loads(sys.argv[1][4:]).get("reason") or "not rigged"))' "$r")}" > "$WORK/${key}_$s.gate.json"; cands+=("${key}_$s:$m:$WORK/rig_$s"); continue; }
  echo "FIGHTKIT $key $m: $(lib_on "${key}_$s" "$WORK/rig_$s")"
  cands+=("${key}_$s:$m:$WORK/rig_$s")
done
args=()
for c in "${cands[@]}"; do IFS=: read -r k m d <<< "$c"; args+=("$k" "$m" "$WORK/$k.gate.json" "$WORK/sidecar/$k" "$d"); done
python3 tools/anim/fightkit_gate.py --pick "$out" "${args[@]}"
