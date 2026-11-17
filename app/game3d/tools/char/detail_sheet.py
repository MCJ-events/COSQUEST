#!/usr/bin/env python3
"""fid29 charshade: the high tier's shared detail maps, from ambientCG (CC0 1.0, docs/game3d/fid29/ASSETS-LICENCES-charshade.md).

  detail_sheet.py SRC_DIR OUT_DIR
SRC_DIR holds the unpacked ambientCG 1K-JPG downloads (one folder per asset). Writes:
  cloth_sheet.png    1024 x 1024 tangent-space normals (OpenGL, +Y up, as Godot reads them), four 512 tiles:
                     top-left Fabric030 (woven cotton), top-right Fabric061 (knit), bottom-left Leather037 (grained),
                     bottom-right Leather026 (smooth). Each tile is its whole (tileable) texture at 504 px with a 4 px
                     border wrapped round from the opposite side, so char_real samples one period from texel 4 to 508
                     and the tiling has no seam; the normals' slopes are scaled to a common strength and renormalised.
  metal_breakup.png  256 x 256, R = Scratches005 (scratch mask), G = SurfaceImperfections003 (smudges), B = 0.
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

TILE, BORDER = 512, 4
SHEET = [("Fabric030", 0, 0, 1.0), ("Fabric061", 1, 0, 1.0), ("Leather037", 0, 1, 1.0), ("Leather026", 1, 1, 1.4)]


def load(p, mode="RGB"):
    return np.asarray(Image.open(p).convert(mode), np.float32) / 255


def tile(src, name, k):
    n = load(next(Path(src, name).glob("*_NormalGL.jpg"))) * 2 - 1
    inner = TILE - 2 * BORDER
    img = Image.fromarray(((n + 1) * 127.5).clip(0, 255).astype(np.uint8)).resize((inner, inner), Image.LANCZOS)
    n = np.asarray(img, np.float32) / 127.5 - 1
    n[..., :2] *= k
    n[..., 2] = np.clip(n[..., 2], 0.05, 1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    n = np.pad(n, ((BORDER, BORDER), (BORDER, BORDER), (0, 0)), mode="wrap")   # one period, wrapped border
    return n


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
    sheet = np.zeros((2 * TILE, 2 * TILE, 3), np.float32)
    for name, x, y, k in SHEET:
        sheet[y * TILE:(y + 1) * TILE, x * TILE:(x + 1) * TILE] = tile(src, name, k)
    Image.fromarray(((sheet + 1) * 127.5 + 0.5).clip(0, 255).astype(np.uint8)).save(out / "cloth_sheet.png", optimize=True)
    sc = load(next(Path(src, "Scratches005").glob("*_Opacity.jpg")), "L")
    im = load(next(Path(src, "SurfaceImperfections003").glob("*_Opacity.jpg")), "L")
    r = np.asarray(Image.fromarray((sc * 255).astype(np.uint8)).resize((256, 256), Image.LANCZOS), np.float32) / 255
    g = np.asarray(Image.fromarray((im * 255).astype(np.uint8)).resize((256, 256), Image.LANCZOS), np.float32) / 255
    g = (g - g.mean()) / max(g.std(), 1e-3) * 0.18 + 0.5                       # centred on 0.5: the shader adds (g - 0.5)
    rgb = np.stack([r, np.clip(g, 0, 1), np.zeros_like(r)], -1)
    Image.fromarray((rgb * 255 + 0.5).astype(np.uint8)).save(out / "metal_breakup.png", optimize=True)
    print("DETAIL_OK", out)


if __name__ == "__main__":
    main()
