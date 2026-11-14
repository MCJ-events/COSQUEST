#!/usr/bin/env bash
# fid29 heromaps: build one hero's r files from its build 28 files (mm1 CPU; the farm under its gate works too).
#   heromaps.sh HERO_KEY [stage ...]
#   stages (default all, in order): src tears0 tears1 body0 clean0 delight0 folds0 hands0 body1 clean1 hands1 ktx verify
# src     the build 28 lod0 and lod1, or for Kofi and Tavo build 28 with the curled MakeHuman hands grafted on
#         (graft.py, forge-q2's kept g10 files; head, hair, body maps and rig stay build 28's)
# tears   webbing and flaps that tear in the hero's own clips (tears.py), legs only
# body0   lod0's body repacked (visibility-weighted xatlas) and re-baked onto the new UVs from the clean colour source
#         (colsrc.py: build 28's tone on the lift's lossless colour, or on the 4096 klein projection for Imani and Zuri)
#         and build 28's normal and ORM: colour 4K, normal and ORM 2K (a kept repack.npz newer than t0.glb is reused)
# clean   fins and shards (clean.py); delight: painted light out, neck feathered (delight.py); folds: the crotch web
#         that turns over in the clips darkened like a real fold (folds.py); hands: own UV island,
#         colour baked across, normal from the hands subdivided twice plus skin grain (hands.py)
# body1   lod1's body repacked at 2K and baked from the finished lod0r body (colour 2K, normal and ORM 1K)
# ktx     KTX2 inside the GLB (ktx_glb.py); the head colour steps to 1536 only if a file is over its disk cap
# Work in $W/<hero>/; finished files: $W/<hero>/<hero>_lod1r.glb and _lod0r.glb. Never writes into the game tree.
set -euo pipefail
. ${HM_ENV:-$HOME/cq-overflow/b29/heromaps/env.sh}
T=$O/stage_tools; W=${W:-$O/work/h3}; H=${H28:-$O/tree/game3d/cast/heroes}; LIB=${LIB:-$O/tree/game3d/anim}
k=$1; shift; S=${*:-src tears0 tears1 body0 clean0 delight0 folds0 hands0 body1 clean1 hands1 ktx verify}
D=$W/$k; mkdir -p $D; cd $D
CAP0=$((14 * 1048576)); CAP1=$((6 * 1048576))
run() { ogate "$k $1"; echo "== $k $1 $(date -u +%T)"; }
for st in $S; do case $st in
  src) run src
    for l in 0 1; do
      if [ -f $O/hands_src/${k}_g10/lod$l.glb ]; then
        $BPY $T/graft.py $H/${k}_lod$l.glb $O/hands_src/${k}_g10/lod$l.glb $D/src$l.glb --report $D/graft_l$l.json | cut -c1-200
      else cp -f $H/${k}_lod$l.glb $D/src$l.glb; fi
    done
    C=$O/work/colsrc/$k
    # colour only: the lift's lossless normal carries texel noise that the sun turns into dark specks (build 28's JPEG
    # normal, smoothed by its compression, does not), so the body normal is baked from build 28's
    printf '{"base": "%s"}\n' $C/src_base.png > $D/sources.json ;;
  tears0) run tears0
    $BPY $T/tears.py $D/src0.glb $LIB/$k.glb $D/t0.glb --hip 0.55 --report $D/tears_l0.json --mask $D/tears_l0.npz | cut -c1-200 ;;
  body0) run body0
    nice -n 10 $BPY $T/build_body.py --target $D/t0.glb --source $D/src0.glb --source-maps $D/sources.json --out $D/l0_body.glb \
      --work $D/b0 --colour 4096 --normal 2048 --orm 2048 --cage 0.003 --maxdist 0.008 \
      $( [ -f $D/b0/repack.npz ] && [ $D/b0/repack.npz -nt $D/t0.glb ] && echo --repack $D/b0/repack.npz ) | tail -1 | cut -c1-400 ;;
  clean0) run clean0
    nice -n 10 $BPY $T/clean.py $D/l0_body.glb $D/l0_clean.glb --report $D/clean_l0.json --mask $D/clean_l0.npz | tail -1 | cut -c1-300 ;;
  delight0) run delight0
    nice -n 10 $BPY $T/delight.py $D/l0_clean.glb $D/l0_dl.glb --work $D/dl0 | tail -1 | cut -c1-300 ;;
  folds0) run folds0
    nice -n 10 $BPY $T/folds.py $D/l0_dl.glb $LIB/$k.glb $D/l0_fold.glb --report $D/folds_l0.json | cut -c1-200 ;;
  hands0) run hands0
    nice -n 10 $BPY $T/hands.py $D/l0_fold.glb $D/${k}_lod0r_png.glb --size 1024 --work $D/h0 | tail -1 ;;
  tears1) run tears1
    $BPY $T/tears.py $D/src1.glb $LIB/$k.glb $D/t1.glb --hip 0.55 --report $D/tears_l1.json --mask $D/tears_l1.npz | cut -c1-200 ;;
  body1) run body1
    nice -n 10 $BPY $T/build_body.py --target $D/t1.glb --source $D/${k}_lod0r_png.glb --out $D/l1_body.glb --work $D/b1 \
      --colour 2048 --normal 1024 --orm 1024 $( [ -f $D/b1/repack.npz ] && [ $D/b1/repack.npz -nt $D/t1.glb ] && echo --repack $D/b1/repack.npz ) \
      | tail -1 | cut -c1-400 ;;
  clean1) run clean1
    nice -n 10 $BPY $T/clean.py $D/l1_body.glb $D/l1_clean.glb --report $D/clean_l1.json --mask $D/clean_l1.npz | tail -1 | cut -c1-300 ;;
  hands1) run hands1
    nice -n 10 $BPY $T/hands.py $D/l1_clean.glb $D/${k}_lod1r_png.glb --size 512 --work $D/h1 | tail -1 ;;
  ktx) run ktx
    for l in 1 0; do cap=$CAP1; [ $l = 0 ] && cap=$CAP0
      nice -n 10 $BPY $T/ktx_glb.py $D/${k}_lod${l}r_png.glb $D/${k}_lod${l}r.glb --body ${BODY_FMT:-etc1s} --report $D/ktx_l$l.json | cut -c1-200
      # over the disk cap: step the head colour to 1536, then the body normal to 1792, then 1536 (each logged in ktx_l*.json)
      for step in "HEAD_COLOUR_MAX=1536" "HEAD_COLOUR_MAX=1536 BODY_NORMAL_MAX=1792" "HEAD_COLOUR_MAX=1536 BODY_NORMAL_MAX=1536"; do
        [ $(stat -c %s $D/${k}_lod${l}r.glb) -gt $cap ] || break; echo "over the cap: $step"
        env $step nice -n 10 $BPY $T/ktx_glb.py $D/${k}_lod${l}r_png.glb $D/${k}_lod${l}r.glb --body ${BODY_FMT:-etc1s} --report $D/ktx_l$l.json | cut -c1-200
      done
      echo "lod${l}r $(stat -c %s $D/${k}_lod${l}r.glb) bytes (cap $cap)"
    done ;;
  verify)
    # against the source the lane started from: build 28's file, or build 28 with the grafted hands (graft.py reports that step)
    for l in 1 0; do $BPY $T/verify.py $D/src$l.glb $D/${k}_lod${l}r.glb --edited geometry_0,hands --allow-delete > $D/verify_l$l.json || true
      cut -c1-300 $D/verify_l$l.json; echo; done ;;
  *) echo "unknown stage $st"; exit 2;;
esac; done
