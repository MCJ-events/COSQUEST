#!/bin/bash
# mm1: the new side of the heromaps acceptance frames for Tavo, Lyra and Oren (the farm takes Imani, Kofi, Zuri)
. $HOME/cq-overflow/b29/heromaps/lane.sh
R=$O/acc
s() { CQ_HEROMAPS_ASTC=1 bash $K/shots.sh --game $TG --phone "$@" 2>&1 | grep " rc="; }
for h in controllers celestials everborns; do for t in high mid; do s --out $R/new --tag ${h}_${t}_trafalgar_golden --faction $h --tier $t --arena trafalgar --time golden; done; done
for h in controllers celestials everborns; do for t in high mid; do s --out $R/held_new --tag ${h}_${t}_shoreditch_day --faction $h --tier $t --arena shoreditch --time day --seed 811 --runs B; done; done
echo MA_DONE
