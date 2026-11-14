# fid29 heromaps lane env on mm1 (CPU only)
O=$HOME/cq-overflow/b29/heromaps
export GODOT=$O/xbin/godot XVFB=$O/xbin/Xvfb WEAPON=$O/fixtures/knight_sword.glb FID_FORGE=$O/fixtures/forge_guardian_fk_83421efe_v1 FID_HOST=mm1 FID=$HOME/cq-overflow/b29 LANE=heromaps
TG=$O/tree/game3d; K=$TG/tools/fid29
install_r() { for k in ascendants_zuri icons_imani blockbusters_kofi controllers_tavo celestials_lyra everborn_oren; do for l in 0 1; do
  f=$O/work/heroes/$k/${k}_lod${l}r.glb; [ -f $f ] && cp -f $f $TG/cast/heroes/ && printf "[remap]\n\nimporter=\"keep\"\n" > $TG/cast/heroes/${k}_lod${l}r.glb.import; done; done; }
