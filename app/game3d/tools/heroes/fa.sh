#!/bin/bash
# farm: the new side of the heromaps acceptance frames (run after the final r files are synced into the lane repo)
cd ~/realism-20261111/fid29/heromaps
F=./fs.sh
for h in icons blockbusters ascendants; do for t in high mid; do $F acc/new new $h $t trafalgar golden A,B; done; done
for h in icons blockbusters ascendants; do for t in high mid; do $F acc/held_new new $h $t shoreditch day B --seed 811; done; done
echo FA_DONE
