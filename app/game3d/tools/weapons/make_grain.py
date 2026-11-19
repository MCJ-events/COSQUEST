#!/usr/bin/env python3
"""fight-look-31: art/weapons/weapon_grain.png, the weapons' surface detail (weapon_look.gd), made here from seeded noise
(our own asset, no source images). 256 x 256, tiles both ways. Channels:
  R  brushed metal: fine streaks along U
  G  wood grain: soft rings and long fibres along U
  B  leather: small rounded cells (pores and creases)
  A  fine break-up noise (scratches, wear)
Run: python3 tools/weapons/make_grain.py  (numpy + Pillow)."""
import numpy as np
from PIL import Image

N = 256
rng = np.random.default_rng(31)


def tile_noise(cells_x, cells_y, octaves=4):
    """Tiling value noise in 0..1: bicubic-smoothed lattices summed over octaves."""
    out = np.zeros((N, N))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        cx, cy = cells_x * 2 ** o, cells_y * 2 ** o
        lat = rng.random((cy, cx))
        y = np.linspace(0, cy, N, endpoint=False)
        x = np.linspace(0, cx, N, endpoint=False)
        y0 = np.floor(y).astype(int); x0 = np.floor(x).astype(int)
        fy = y - y0; fx = x - x0
        fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
        a = lat[np.ix_(y0 % cy, x0 % cx)]; b = lat[np.ix_(y0 % cy, (x0 + 1) % cx)]
        c = lat[np.ix_((y0 + 1) % cy, x0 % cx)]; d = lat[np.ix_((y0 + 1) % cy, (x0 + 1) % cx)]
        fxx = fx[None, :]; fyy = fy[:, None]
        out += amp * ((a * (1 - fxx) + b * fxx) * (1 - fyy) + (c * (1 - fxx) + d * fxx) * fyy)
        tot += amp; amp *= 0.5
    return out / tot


def norm(a):
    return (a - a.min()) / max(a.max() - a.min(), 1e-6)


# R: brushed streaks: noise stretched along U (few cells across U, many across V), plus a little grit
brushed = norm(0.8 * tile_noise(2, 96, 2) + 0.2 * tile_noise(16, 16, 3))
# G: wood: rings from a distorted V coordinate, fibres along U
v = np.linspace(0, 1, N, endpoint=False)[:, None] * np.ones((1, N))
warp = tile_noise(3, 4, 3)
rings = 0.5 + 0.5 * np.sin(2 * np.pi * (v * 6 + warp * 1.6))
fibres = tile_noise(3, 64, 2)
wood = norm(0.55 * rings ** 1.5 + 0.45 * fibres)
# B: leather: cellular look from thresholded, smoothed noise (rounded cells, dark creases between)
cells = tile_noise(24, 24, 2)
crease = 1.0 - np.abs(tile_noise(12, 12, 3) - 0.5) * 2.0
leather = norm(0.7 * cells + 0.3 * (1.0 - crease ** 6))
# A: fine wear
wear = norm(tile_noise(32, 32, 3))

img = np.stack([brushed, wood, leather, wear], axis=-1)
Image.fromarray((img * 255).round().astype(np.uint8), "RGBA").save("art/weapons/weapon_grain.png", optimize=True)
print("art/weapons/weapon_grain.png", img.shape)
