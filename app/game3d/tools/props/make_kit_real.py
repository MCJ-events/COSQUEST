# fid29-dressing: the kit's unstylised detail maps for the real look (world_kit.gdshader real_detail), from ambientCG
# (CC0) 1K colour maps: greyscale, 512 px, tileable as downloaded, mean and contrast set to what the shader expects
# (real_mean: 0.8 for stone, 0.5 for the rest; place_dress.gd KIT_REAL).
#   python make_kit_real.py <acg_dir> <out_dir>
import os, sys
from PIL import Image, ImageStat, ImageOps

ACG, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
# out name: (ambientCG asset, map, target mean, target std)
MAPS = {
    "props_noise": ("Concrete034", "Color", 0.5, 0.10),
    "stone": ("Rock030", "Color", 0.8, 0.083),
    "foliage": ("LeafSet027", "Color", 0.5, 0.16),
    "metal_rough": ("Metal046B", "Roughness", 0.5, 0.12),
}
for name, (asset, m, mean, std) in MAPS.items():
    im = Image.open(os.path.join(ACG, asset, "%s_1K-JPG_%s.jpg" % (asset, m))).convert("L")
    im = ImageOps.autocontrast(im, cutoff=0.5).resize((512, 512), Image.LANCZOS)
    st = ImageStat.Stat(im)
    mu, sd = st.mean[0] / 255.0, max(1e-3, st.stddev[0] / 255.0)
    lut = [max(0, min(255, int(round(((v / 255.0 - mu) * (std / sd) + mean) * 255.0)))) for v in range(256)]
    im = im.point(lut)
    im.save(os.path.join(OUT, name + ".png"), optimize=True)
    s2 = ImageStat.Stat(im)
    print("KITREAL %s from %s/%s mean %.3f std %.3f" % (name, asset, m, s2.mean[0] / 255.0, s2.stddev[0] / 255.0))
