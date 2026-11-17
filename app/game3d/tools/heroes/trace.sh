#!/usr/bin/env bash
# trace.sh OUTDIR : which model files a LOW-tier fight opens (strace openat on the Godot process), over every fight
# shape the app can send on a low phone: modes full/arena/chars, each faction, several seeds, no models (cast stand-ins),
# a Forge model for the hero, a raid boss, an ally, plus a config with no tier at all. Software GL (llvmpipe reports
# ASTC, so the only thing keeping low off the r files is the look). Writes OUTDIR/opened.txt (unique res files).
. $HOME/cq-overflow/b29/heromaps/env.sh; xv
OUT=$1; mkdir -p $OUT; GAME=${TRACE_GAME:-$GAME}; cd $GAME
FORGE=$O/work/trace_forge; mkdir -p $FORGE; cp -f $GAME/cast/armstrong_lod1.glb $FORGE/lod1.glb
n=0
run() { n=$((n+1)); cfg=$OUT/cfg_$n.json; echo "$1" > $cfg
  ogate trace $n
  env $GLENV timeout 300 strace -f -qq -e trace=openat -o $OUT/strace_$n.txt $G --path . --rendering-driver opengl3 --resolution 360x640 --fixed-fps 30 \
    -s res://tools/look_shots.gd -- --plan=$cfg > $OUT/log_$n.txt 2>&1
  echo "run $n rc=$? $(grep -c "\.glb" $OUT/strace_$n.txt) glb opens"; }
plan() { echo "{\"config\": {\"mode\": \"$1\", \"duration_s\": 8, \"autoplay\": true, \"seed\": $2, \"load_thread\": false, \"place_thread\": false, \"dyn_res\": false, \"music\": false, \"sound\": false $3}, \"out\": \"$OUT\", \"prefix\": \"t$2\", \"shots\": [], \"quit_s\": 3.0, \"masks\": false}"; }
for mode in full arena chars; do
  for fac in ascendants controllers icons everborns celestials blockbusters; do run "$(plan $mode 239 ",\"tier\":\"low\",\"faction\":\"$fac\"")"; done
done
for s in 1 7 52012 99991; do run "$(plan full $s ",\"tier\":\"low\"")"; done
run "$(plan full 239 "")"
run "$(plan full 239 ",\"tier\":\"low\",\"hero_glb\":\"$FORGE/lod1.glb\",\"hero_key\":\"armstrong\"")"
run "$(plan full 239 ",\"tier\":\"low\",\"enemy_role\":\"boss\",\"raid\":true")"
grep -h -oE "res://[^\"]*|/cq-overflow/b29/heromaps/(repo/app|tree)/game3d/[^\"]*\.(glb|png|json)" $OUT/strace_*.txt | sed -E "s#.*/(repo/app|tree)/game3d/#res://#" | grep -E "\.glb" | sort | uniq -c | sort -k2 > $OUT/opened.txt
echo "== opened model files:"; cat $OUT/opened.txt
echo "== r files opened: $(grep -c "r\.glb" $OUT/opened.txt)"
