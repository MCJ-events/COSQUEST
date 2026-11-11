#!/usr/bin/env bash
# build_motion.sh: rebuild the clip libraries with the motion-capture sources (realism-20261111).
#   tools/anim/build_motion.sh [cast|forge|all] : run from app/game3d on the farm.
# Sources (licences: docs/game3d/LICENSES.md, "Motion capture and authored fight clips"):
#   KayKit Knight.glb + Quaternius UAL (the classic clips, as before)
#   $MOTION/lib/cmu.glb  (cmu2glb.py over the CMU takes in cmu_clips.json)
#   $MOTION/lib/m2m.glb  (m2m_merge.py over the decoded Mesh2Motion clips)
set -euo pipefail
what=${1:-all}
MOTION=${MOTION:-$HOME/realism-20261111/motion}
S=${CLIPSRC:-$HOME/cq-work/243-characters-relift-pod-prep/clipsrc}
BPY=${BPY:-$HOME/cq-work/tools/blender-dl/blender-4.2.9-linux-x64/4.2/python/bin/python3.11}
C=${CAST:-$HOME/autorig/cast}
PY=${PY:-$MOTION/venv/bin/python}
$PY tools/anim/cmu2glb.py --cmu $MOTION/src/cmu --clips tools/anim/cmu_clips.json --out $MOTION/lib/cmu.glb | tail -1
[ -s $MOTION/lib/m2m.glb ] || $PY tools/anim/m2m_merge.py --src $MOTION/src/m2m_dec --out $MOTION/lib/m2m.glb | tail -1
B="nice -n 10 $BPY tools/anim/build_all.py --src $S/kaykit/Knight.glb --src_ual $S/ual/AnimationLibrary_Godot_Standard.gltf --libs cmu=$MOTION/lib/cmu.glb,m2m=$MOTION/lib/m2m.glb --cast $C"
if [ "$what" = cast ] || [ "$what" = all ]; then $B; fi
if [ "$what" = forge ] || [ "$what" = all ]; then
  # the three auto-rigged Forge proof characters (autorig, 9 Nov): Kade's MIA rig needs the looser attack gate
  $B --keys forge_kade --gate_attacks 0.011
  $B --keys forge_soldier
  $B --keys forge_samurai
fi
