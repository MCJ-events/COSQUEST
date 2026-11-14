#!/usr/bin/env python3
"""fid29 charshade: the heroes' hair strand atlases (build 29, "character materials", ours, procedural).

Every hero with hair cards (the hybrid head stage's hair_cards.py / hair_styles.py) carries one 512 x 1024 RGBA atlas
with a hard 0/1 alpha: the 0.35 alpha scissor cut it into the jagged "shards" the audit flagged (C6). This tool remakes
that atlas, keeping its layout (the cards' UVs are unchanged), for alpha to coverage on the tier's MSAA:
  - alpha becomes a soft weight: the cut's edge is resolved into a 1.5-texel ramp, and along strand cards the ends are
    thinned strand by strand (fine streak noise along V), so coverage falls off the way hair does instead of a cut line;
  - colour: the old atlas, resampled, with fine strand-to-strand lightness (streaks along V, about 2 texels wide at
    1K) so the anisotropic highlight breaks into strands;
  - colour bled under the transparent parts (no dark fringe in the mips);
  - the style is measured per card column (the atlas holds four variants side by side): strand columns (straight and
    wavy hair) run their strands along V, the root at the end where the alpha thins (the under-layer's teeth); coil
    columns (Kofi's and Zuri's coil tiles, Zuri's braids) have no strand direction, and the shader gives them a broad,
    dim sheen instead (fighter.gd passes strand_columns and root_v as cs_hair_strand and cs_hair_root_v).
Writes KEY_hi.png (1024 x 2048, high tier) and KEY_mid.png (512 x 1024, mid tier) and KEY_hair.json.

usage (python with numpy, scipy, Pillow):
  hair_atlas.py --cast app/game3d/cast/heroes --out-dir app/game3d/art/char/hair [KEY ...]
"""
import argparse, io, json, struct
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

HEROES = ["icons_imani", "blockbusters_kofi", "ascendants_zuri", "celestials_lyra", "controllers_tavo"]


def read_glb(p):
    raw = Path(p).read_bytes(); n = struct.unpack_from("<I", raw, 12)[0]
    return json.loads(raw[20:20 + n]), raw[20 + n + 8:]


def hair_atlas(glb):
    j, b = read_glb(glb)
    for m in j["materials"]:
        if str((m.get("extras") or {}).get("cq_surface", "")) == "hair":
            t = m["pbrMetallicRoughness"]["baseColorTexture"]["index"]
            bv = j["bufferViews"][j["images"][j["textures"][t]["source"]]["bufferView"]]
            o = bv.get("byteOffset", 0)
            return np.asarray(Image.open(io.BytesIO(b[o:o + bv["byteLength"]])).convert("RGBA"), np.float32) / 255
    return None


def streaks(rng, h, w, su, sv):
    n = ndimage.gaussian_filter(rng.standard_normal((h, w)), (sv, su), mode="wrap")
    return (n - n.mean()) / max(n.std(), 1e-6)


def styles_of(a):
    """Per card column (the atlas holds four variants side by side): 1 = strands along V (alpha varies across U far more
    than along V), 0 = coil tiles or braids (no strand direction)."""
    W = a.shape[1] // 4; out = []
    for c in range(4):
        x = a[:, c * W:(c + 1) * W]
        gy = np.abs(np.diff(x, axis=0)).mean(); gx = np.abs(np.diff(x, axis=1)).mean()
        out.append(1 if gx > 2.0 * gy else 0)
    return out


def root_v(a, st):
    """UV.y of the root end, from the strand columns: the end with less alpha (the under-layer's teeth, the strands'
    thinning at the hairline). 1 = the bottom rows."""
    H = a.shape[0]; W = a.shape[1] // 4
    cols = [a[:, c * W:(c + 1) * W] for c in range(4) if st[c]] or [a]
    top = np.mean([c[: int(H * 0.3)].mean() for c in cols]); bot = np.mean([c[int(H * 0.7):].mean() for c in cols])
    return 1.0 if bot <= top else 0.0


def remake(src, W, H, st, seed):
    rng = np.random.default_rng(seed)
    h0, w0 = src.shape[:2]; k = W / w0
    # colour and alpha resampled (bicubic), then the alpha's edge resolved into a ramp about 1.5 texels wide
    up = np.stack([np.asarray(Image.fromarray((src[..., c] * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), np.float32) / 255
                   for c in range(4)], -1)
    a = ndimage.gaussian_filter(up[..., 3], 0.45 * k + 0.35)
    sm = np.repeat(np.array(st, np.float32), W // 4)[None, :]       # 1 on strand columns
    fine = streaks(rng, H, W, 0.55 * k, 60 * k)        # one strand: about one old texel across, long along V
    mid = streaks(rng, H, W, 1.6 * k, 120 * k)
    grain = ndimage.gaussian_filter(rng.standard_normal((H, W)), 0.6 * k, mode="wrap"); grain /= max(grain.std(), 1e-6)
    # strand columns: strand-by-strand thinning where the cut was (ends and frayed sides), never inside a full card
    edge = 4.0 * a * (1.0 - a)
    a = np.clip(a + sm * edge * (0.35 * fine + 0.15 * mid), 0, 1)
    lum = sm * (1.0 + 0.16 * fine + 0.08 * mid) + (1 - sm) * (1.0 + 0.10 * grain)
    # a ramp, not a band: 0.5 at the old cut, full a texel inside
    a = np.clip((a - 0.5) * 1.6 + 0.5, 0, 1)
    rgb = np.clip(up[..., :3] * lum[..., None], 0, 1)
    # colour bled under the transparent texels from the nearest covered one
    cov = a > 0.25
    if cov.any() and not cov.all():
        idx = ndimage.distance_transform_edt(~cov, return_distances=False, return_indices=True)
        rgb = np.where(cov[..., None], rgb, rgb[idx[0], idx[1]])
    return np.concatenate([rgb, a[..., None]], -1)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("keys", nargs="*")
    ap.add_argument("--cast", required=True); ap.add_argument("--out-dir", required=True)
    a = ap.parse_args()
    out = Path(a.out_dir); out.mkdir(parents=True, exist_ok=True)
    for i, key in enumerate(a.keys or HEROES):
        src = hair_atlas(Path(a.cast) / f"{key}_lod0.glb")
        if src is None:
            print("HAIR_ATLAS", key, "no hair cards"); continue
        st = styles_of(src[..., 3]); rv = root_v(src[..., 3], st)
        for tag, (W, H) in (("hi", (1024, 2048)), ("mid", (512, 1024))):
            img = remake(src, W, H, st, 1000 + i)
            Image.fromarray((img * 255 + 0.5).astype(np.uint8), "RGBA").save(out / f"{key}_{tag}.png", optimize=True)
        info = {"key": key, "strand_columns": st, "root_v": rv, "source": f"{key}_lod0.glb hair_cards", "sizes": {"hi": [1024, 2048], "mid": [512, 1024]}}
        (out / f"{key}_hair.json").write_text(json.dumps(info) + "\n")
        print("HAIR_ATLAS", json.dumps(info))


if __name__ == "__main__":
    main()
