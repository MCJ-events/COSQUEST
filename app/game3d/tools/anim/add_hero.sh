#!/usr/bin/env bash
# add_hero.sh: one command gives one rigged character its clip library (realism, 12 Nov 2026).
#
#   tools/anim/add_hero.sh <key> <folder with lod0.glb lod1.glb lod2.glb [rig.json]> [--no-pack]
#
# Run from app/game3d on the farm. The model must carry the 25-bone humanoid skeleton (Hips Spine
# Spine1 Spine2 Neck Head HeadTop_End, L/R Shoulder Arm ForeArm Hand, L/R UpLeg Leg Foot ToeBase
# Toe_End), one skeleton for all LODs, any rest pose (T, A or the wide A-pose of the base rig: the
# retarget lines each bone's rest direction up with the source's, so the arms come down where the
# clip has them whatever the rest pose is).
# It:
#  1. copies the LODs to $HERO_CAST/pose/<key>/ (never into ~/autorig),
#  2. retargets every clip (classic KayKit and Quaternius, captured CMU, Mesh2Motion), measures the
#     tear on LOD0, LOD1 and LOD2, and picks per state the first clip under the strict 0.5 % gate
#     (run and sprint 1 %); a state with none falls back for that character only (build_all.py
#     --soft_core: attacks fall back to the procedural swing, the library is kept),
#  3. writes into the game: anim/<key>.glb, data/anim_clips.json characters.<key>, data/attach.json
#     clip_grips, tools/anim/reports/<key>.json,
#  4. unless --no-pack: writes a run-time sidecar to $HERO_OUT/<key>/ (anim.glb + anim.json), which
#     anim_library.gd registers when it sits beside a downloaded model (register_sidecar), so a
#     Forge catalogue character needs nothing inside the pck.
# The character is marked "arm_droop" 0.9 (ARM_DROOP=0 for a stylised body): the classic clips carry
# the upper arms 55 to 65 degrees out, which the game takes back on a realistic body.
# Prints the picks, what was lost to the gate, and the worst tear.
set -euo pipefail
key=$1; src=$2; pack=1; [ "${3:-}" = "--no-pack" ] && pack=0
MOTION=${MOTION:-$HOME/realism-20261111/motion}
HERO_CAST=${HERO_CAST:-$MOTION/heroes/cast}
HERO_OUT=${HERO_OUT:-$MOTION/heroes/sidecar}
S=${CLIPSRC:-$HOME/cq-work/243-characters-relift-pod-prep/clipsrc}
BPY=${BPY:-$HOME/cq-work/tools/blender-dl/blender-4.2.9-linux-x64/4.2/python/bin/python3.11}
mkdir -p "$HERO_CAST/pose/$key"
for l in 0 1 2; do [ -f "$src/lod$l.glb" ] && cp "$src/lod$l.glb" "$HERO_CAST/pose/$key/lod$l.glb"; done
[ -f "$HERO_CAST/pose/$key/lod1.glb" ] || { echo "no lod1.glb in $src" >&2; exit 2; }
echo "{\"rigged\": true, \"skeleton\": \"humanoid-mixamo\", \"source\": \"$src\"}" > "$HERO_CAST/pose/$key/rig.json"
[ -s "$MOTION/lib/cmu.glb" ] && [ -s "$MOTION/lib/m2m.glb" ] || { echo "source libraries missing: run tools/anim/build_motion.sh once (it builds $MOTION/lib/cmu.glb and m2m.glb)" >&2; exit 2; }
nice -n 10 "$BPY" tools/anim/build_all.py --src "$S/kaykit/Knight.glb" --src_ual "$S/ual/AnimationLibrary_Godot_Standard.gltf" \
  --libs "cmu=$MOTION/lib/cmu.glb,m2m=$MOTION/lib/m2m.glb" --cast "$HERO_CAST" --keys "$key" --soft_core | tail -3
python3 tools/anim/hero_sidecar.py "$key" --droop "${ARM_DROOP:-0.9}" $([ $pack = 1 ] && echo "--out $HERO_OUT/$key")
