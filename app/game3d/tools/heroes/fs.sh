#!/bin/bash
# farm: fs.sh OUT VARIANT(new|b28) faction tier arena time runs [extra shots.sh args]: one phone-path shot pair of the lane tree
L=~/realism-20261111/fid29/heromaps; G=$L/repo/app/game3d
out=$1; v=$2; h=$3; t=$4; a=$5; tm=$6; runs=$7; shift 7
a1=1; [ "$v" = b28 ] && a1=0
export LANE=heromaps
CQ_HEROMAPS_ASTC=$a1 bash $G/tools/fid29/shots.sh --game $G --out $L/$out --tag ${h}_${t}_${a}_$tm --faction $h --tier $t --arena $a --time $tm --phone --runs $runs "$@" 2>&1 | grep -v "^CQLOOK perf"
