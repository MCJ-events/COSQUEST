#!/bin/bash
# farm: the build 28 side of the heromaps acceptance frames that the shared b28p baseline does not hold yet
cd ~/realism-20261111/fid29/heromaps
F=./fs.sh
for h in celestials everborns; do for t in high mid; do $F acc/b28 b28 $h $t trafalgar golden A,B; done; done
for h in icons blockbusters ascendants controllers celestials everborns; do for t in high mid; do
  $F acc/held_b28 b28 $h $t shoreditch day B --seed 811; done; done
echo FB_DONE
