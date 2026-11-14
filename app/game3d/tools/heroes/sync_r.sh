#!/bin/bash
# run on the Mac: stream the finished r files from mm1 (work/h3) into the farm lane repo, with their .import files
HEROES="ascendants_zuri icons_imani blockbusters_kofi controllers_tavo celestials_lyra everborn_oren"
L=""
for k in $HEROES; do for l in 0 1; do L="$L $k/${k}_lod${l}r.glb"; done; done
ssh mm1 "cd ~/cq-overflow/b29/heromaps/work/h3 && tar c --ignore-failed-read $L 2>/dev/null" | ssh mmfarm 'D=~/realism-20261111/fid29/heromaps/repo/app/game3d/cast/heroes; T=$(mktemp -d); cd $T && tar x; for f in */*_lod?r.glb; do b=$(basename $f); cp -f $f $D/$b; printf "[remap]\n\nimporter=\"keep\"\n" > $D/$b.import; done; rm -rf $T; ls -la $D | grep "r.glb$"'
