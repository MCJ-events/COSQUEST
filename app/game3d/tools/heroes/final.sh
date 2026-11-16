#!/bin/bash
# fid29 heromaps acceptance run on mm1 (CPU only): install the r files into the lane tree, tests, records, load trace,
# budgets (measure.gd per file, fid29 dumps per fight), game frames. Each part can be run alone: final.sh PART...
#   parts: install tests records trace measure dumps shots heldout
. $HOME/cq-overflow/b29/heromaps/lane.sh
. $O/env.sh; export GAME=$TG TRACE_GAME=$TG
P=${*:-install tests records trace measure dumps shots}
HEROES="ascendants_zuri icons_imani blockbusters_kofi controllers_tavo celestials_lyra everborn_oren"
R=$O/acc; mkdir -p $R
for part in $P; do case $part in
  install)
    for k in $HEROES; do for l in 0 1; do f=$O/work/h3/$k/${k}_lod${l}r.glb
      if [ -f $f ]; then cp -f $f $TG/cast/heroes/; printf '[remap]\n\nimporter="keep"\n' > $TG/cast/heroes/${k}_lod${l}r.glb.import
      else rm -f $TG/cast/heroes/${k}_lod${l}r.glb $TG/cast/heroes/${k}_lod${l}r.glb.import; fi; done; done
    cd $TG; bash $K/gate.sh heromaps; $GODOT --headless --path . --import > $R/import.log 2>&1
    ls -la $TG/cast/heroes | grep "r.glb$" ;;
  tests)
    cd $TG; for t in fid29_heromaps_test hero_cast_test look_tier_test; do
      timeout 900 $GODOT --headless --path . -s res://tests/$t.gd > $R/$t.log 2>&1; echo "$t rc=$? $(grep -c 'CQTEST PASS' $R/$t.log) pass $(grep -c 'CQTEST FAIL' $R/$t.log) fail"; grep "CQTEST FAIL" $R/$t.log | head; done
    GATE="$K/gate.sh" bash $K/gdtests.sh $TG $R/testlogs | tail -3 ;;
  records)
    bash $K/records.sh --game $TG --out $R/rec_on --check | tail -14
    bash $K/records.sh --game $TG --out $R/rec_off --look '{"fid_heromaps": false}' --check | tail -14 ;;
  trace)
    bash $O/stage_tools/trace.sh $R/trace | tail -30 ;;
  measure)
    cp -f $TG/char_loader.gd $O/gd/char_loader.gd
    L=""; for k in $HEROES; do L="$L $TG/cast/heroes/${k}_lod0.glb $TG/cast/heroes/${k}_lod1.glb $TG/cast/heroes/${k}_lod0r.glb $TG/cast/heroes/${k}_lod1r.glb"; done
    xv; cd $O/gd; env $GLENV timeout 1500 $GODOT --path . --rendering-driver opengl3 --resolution 720x1280 -s measure.gd -- $R/measure.json $L > $R/measure.log 2>&1
    echo "measure rc=$?" ;;
  dumps)
    mkdir -p $R/dumps
    for v in b28 new; do a=1; [ $v = b28 ] && a=0
      for h in icons blockbusters; do for t in high mid; do for ar in trafalgar; do
        CQ_HEROMAPS_ASTC=$a bash $K/dump.sh --game $TG --phone --out $R/dumps/${v}_${h}_${t}_${ar}_mid.json --tier $t --arena $ar --faction $h
        CQ_HEROMAPS_ASTC=$a bash $K/dump.sh --game $TG --phone --out $R/dumps/${v}_${h}_${t}_${ar}_intro.json --tier $t --arena $ar --faction $h --intro 0.9
      done; done; done
      CQ_HEROMAPS_ASTC=$a bash $K/dump.sh --game $TG --phone --out $R/dumps/${v}_icons_low_trafalgar_mid.json --tier low --arena trafalgar --faction icons
    done ;;
  shots)
    for h in icons blockbusters ascendants controllers celestials everborns; do for t in high mid; do
      CQ_HEROMAPS_ASTC=1 bash $K/shots.sh --game $TG --out $R/new --tag ${h}_${t}_trafalgar_golden --faction $h --tier $t --arena trafalgar --time golden --phone 2>&1 | grep " rc="
    done; done
    for h in celestials everborns; do for t in high mid; do
      CQ_HEROMAPS_ASTC=0 bash $K/shots.sh --game $TG --out $R/b28 --tag ${h}_${t}_trafalgar_golden --faction $h --tier $t --arena trafalgar --time golden --phone 2>&1 | grep " rc="
    done; done
    for h in icons blockbusters; do for t in high mid; do for tm in day dusk; do
      CQ_HEROMAPS_ASTC=1 bash $K/shots.sh --game $TG --out $R/new --tag ${h}_${t}_street_$tm --faction $h --tier $t --arena street --time $tm --phone --runs B 2>&1 | grep " rc="
    done; done; done ;;
  heldout)
    for v in new b28; do a=1; [ $v = b28 ] && a=0
      for h in icons blockbusters ascendants controllers celestials everborns; do for t in high mid; do
        CQ_HEROMAPS_ASTC=$a bash $K/shots.sh --game $TG --out $R/held_$v --tag ${h}_${t}_shoreditch_day --faction $h --tier $t --arena shoreditch --time day --seed 811 --phone --runs B 2>&1 | grep " rc="
      done; done; done ;;
  *) echo "unknown part $part";;
esac; done
echo FINAL_DONE $P
