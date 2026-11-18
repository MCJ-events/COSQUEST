#!/usr/bin/env bash
# classes.sh : the handsmetal lane's texel classes (metal_mat.py apply --maps) on the exact build-28 lod0 of each hero,
# into charshade/work/cls/<key>/maps_lod0.npz (the GLB it writes is thrown away). Labels: handsmetal metal/work/<key>/labels.json.
C=$HOME/realism-20261111/fid29/charshade; HM=$HOME/realism-20261111/handsmetal
PYS=$HOME/realism-20261111/tonejoin/sc/venv/bin/python; CAP="$HOME/lookfight/bin/capped 5G"
export LD_LIBRARY_PATH=$HOME/realism-20261111/base/dl/mp/lib SC_MODELS=$HOME/realism-20261111/tonejoin/sc/models
for k in ${@:-blockbusters_kofi ascendants_zuri icons_imani celestials_lyra controllers_tavo everborn_oren}; do
  case $k in icons_imani) tj=imani_c;; blockbusters_kofi) tj=kofi_c;; ascendants_zuri) tj=zuri_c;; celestials_lyra) tj=lyra_c;; controllers_tavo) tj=tavo;; everborn_oren) tj=oren;; esac
  SK=$HOME/realism-20261111/tonejoin/out/$tj/before_lod0_skinw.png; [ -f $SK ] || SK=""
  W=$C/work/cls/$k; mkdir -p $W
  bash $C/bin/gate.sh || exit 1
  t0=$(date +%s)
  timeout 2400 nice -n 10 $CAP $PYS $HM/bin/metal_mat.py apply $HOME/realism-20261111/build28/herosrc/$k/lod0.glb $W/discard.glb \
    --concept $HOME/realism-20261111/asset/out/heroes/$k/concept.png --labels $HM/metal/work/$k/labels.json --maps $W/maps_lod0.npz \
    ${SK:+--skin-png $SK} > $W/apply.log 2>&1
  echo "$k rc=$? $(( $(date +%s) - t0 )) s $(grep -o "METAL_OK.\{0,300\}" $W/apply.log)"; rm -f $W/discard.glb
done
echo CLASSES_DONE
