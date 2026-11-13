#!/usr/bin/env bash
# build_readable.sh [cast|heroes|forge|all]: rebuild every clip library with the readable actions
# (anim-readable, 13 Nov 2026). Run from app/game3d on the farm. Same sources and gate as
# build_motion.sh and add_hero.sh; the readable clips are composed per character from them
# (tools/anim/compose.py, clips.json sets_readable and hero_poses), so nothing new is downloaded.
#   CAST       the cartoon cast and Forge proofs (pose/<key>/lod0..2.glb + rig.json), default ~/autorig/cast
#   HERO_SRC   folders (":" between them) with one folder per faction hero (lod0.glb lod1.glb lod2.glb); a
#              hero is taken from the first that has it. Default the build 25 sources ($MOTION/heroes/cast/pose);
#              build 27: ~/cq-work/godot-b26/herocast/pose:$MOTION/heroes/cast/pose (Oren is only in the second)
#   HERO_KEYS  the heroes to build, default every faction hero that has a folder in HERO_SRC
#   HERO_CAST  where add_hero.sh keeps its copies (default a folder of this lane, never ~/autorig)
# The cast run goes first: it recomputes the clip data every character shares (contact frames,
# ground speeds); the heroes and the Forge proofs are subset runs on top of it.
set -euo pipefail
what=${1:-all}
MOTION=${MOTION:-$HOME/realism-20261111/motion}
S=${CLIPSRC:-$HOME/cq-work/243-characters-relift-pod-prep/clipsrc}
BPY=${BPY:-$HOME/cq-work/tools/blender-dl/blender-4.2.9-linux-x64/4.2/python/bin/python3.11}
C=${CAST:-$HOME/autorig/cast}
HERO_SRC=${HERO_SRC:-$MOTION/heroes/cast/pose}
export HERO_CAST=${HERO_CAST:-$HOME/realism-20261111/anim-readable/herocast}
B="nice -n 10 $BPY tools/anim/build_all.py --src $S/kaykit/Knight.glb --src_ual $S/ual/AnimationLibrary_Godot_Standard.gltf --libs cmu=$MOTION/lib/cmu.glb,m2m=$MOTION/lib/m2m.glb --cast $C"
if [ "$what" = cast ] || [ "$what" = all ]; then
  echo "== cast $(date -u +%H:%M:%S)"; $B | grep -E "^(OK|TEARS|SKIP|WROTE)"
fi
if [ "$what" = forge ] || [ "$what" = all ]; then
  for k in forge_kade forge_soldier forge_samurai; do
    [ -f "$C/pose/$k/lod1.glb" ] || continue
    echo "== $k $(date -u +%H:%M:%S)"; $B --keys $k --soft_core | grep -E "^(OK|TEARS|SKIP)"
  done
fi
if [ "$what" = heroes ] || [ "$what" = all ]; then
  src_of() { local d; for d in ${HERO_SRC//:/ }; do [ -f "$d/$1/lod1.glb" ] && { echo "$d/$1"; return; }; done; }
  keys=${HERO_KEYS:-ascendants_zuri controllers_tavo icons_imani everborn_oren celestials_lyra blockbusters_kofi}
  for k in $keys; do
    src=$(src_of $k)
    [ -n "$src" ] || { echo "== $k: no lod1.glb in $HERO_SRC, skipped"; continue; }
    echo "== $k from $src $(date -u +%H:%M:%S)"
    bash tools/anim/add_hero.sh $k "$src" --no-pack
  done
fi
echo "== done $(date -u +%H:%M:%S)"
