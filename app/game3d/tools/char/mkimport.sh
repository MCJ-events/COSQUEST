#!/usr/bin/env bash
# mkimport.sh GAME_DIR : the .import settings for fid29 charshade's textures (VRAM compressed, mipmaps); Godot fills the rest on import.
G=$1
imp() { # file normal_map fix_alpha
cat > "$G/$1.import" <<J
[remap]

importer="texture"
type="CompressedTexture2D"

[deps]

source_file="res://$1"

[params]

compress/mode=2
compress/high_quality=false
compress/lossy_quality=0.7
compress/uastc_level=0
compress/rdo_quality_loss=0.0
compress/hdr_compression=1
compress/normal_map=$2
compress/channel_pack=0
mipmaps/generate=true
mipmaps/limit=-1
roughness/mode=0
roughness/src_normal=""
process/channel_remap/red=0
process/channel_remap/green=1
process/channel_remap/blue=2
process/channel_remap/alpha=3
process/fix_alpha_border=$3
process/premult_alpha=false
process/normal_map_invert_y=false
process/hdr_as_srgb=false
process/hdr_clamp_exposure=false
process/size_limit=0
detect_3d/compress_to=0
J
}
cd $G
for f in art/char/masks/*.png; do [ -f "$f" ] && imp "$f" 0 false; done
for f in art/char/hair/*.png; do [ -f "$f" ] && imp "$f" 0 true; done
[ -f art/char/detail/cloth_sheet.png ] && imp art/char/detail/cloth_sheet.png 1 false
[ -f art/char/detail/metal_breakup.png ] && imp art/char/detail/metal_breakup.png 0 false
ls art/char/*/*.import | wc -l
