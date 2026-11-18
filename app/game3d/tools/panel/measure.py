"""Where each button sits on a page: disc centre and radius by a circle fit, the same way for his sheet and our render."""
import sys, json, numpy as np
from PIL import Image
from scipy import ndimage as ndi
B = {"attack": (598.5, 429, 245.0), "shield": (598.5, 75, 140.0), "shoot": (288.0, 168, 115.5), "rain": (171.0, 417, 108.5), "dash": (237.0, 711, 95.5)}
def fit(path):
    im = np.asarray(Image.open(path).convert("RGB")).astype(np.float32); H, W, _ = im.shape
    yy, xx = np.mgrid[0:H, 0:W]; out = {}
    for bid, (hx, top, HR) in B.items():
        hy = top + HR; rr = np.hypot(xx - hx, yy - hy)
        halo = np.median(im[(rr > HR * 0.93) & (rr < HR * 0.97)], axis=0)
        m = (rr < HR - 3) & (np.linalg.norm(im - halo, axis=2) > 26)
        lab, n = ndi.label(m); big = np.argmax(np.bincount(lab.ravel())[1:]) + 1
        m = ndi.binary_opening(ndi.binary_fill_holes(lab == big), iterations=1)
        ys, xs = np.where(m); edge = m & ~ndi.binary_erosion(m); ey, ex = np.where(edge)
        cx0, cy0 = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
        ang = np.degrees(np.arctan2(ey - cy0, ex - cx0)); sel = (ang > 20) & (ang < 250) | (ang < -110)
        A = np.c_[2 * ex[sel], 2 * ey[sel], np.ones(sel.sum())]
        sol, *_ = np.linalg.lstsq(A, ex[sel] ** 2 + ey[sel] ** 2, rcond=None)
        # the halo: the pale disc, by its extent on the row and column through its centre
        hm = np.linalg.norm(im - np.array([245.0, 245, 245]), axis=2) > 8
        row = np.where(hm[int(round(hy)), int(hx - HR - 12):int(hx + HR + 12)])[0]; hr = (row.max() - row.min() + 1) / 2
        out[bid] = (float(sol[0]), float(sol[1]), float(np.sqrt(sol[2] + sol[0] ** 2 + sol[1] ** 2)), float(hr))
    return out
a, b = fit(sys.argv[1]), fit(sys.argv[2]); k = 70.0 / 203.94
print("| Button | His sheet: centre x, y, radius (sheet px) | Ours on his page (sheet px) | Offset dx, dy (sheet px) | Offset in game (HUD px, x0.343) | Radius his / ours (sheet px) | Halo radius his / ours |")
print("|---|---|---|---|---|---|---|")
for bid in B:
    ax, ay, ar, ah = a[bid]; bx, by, br, bh = b[bid]
    print(f"| {bid.upper()} | {ax:.1f}, {ay:.1f}, {ar:.1f} | {bx:.1f}, {by:.1f}, {br:.1f} | {bx-ax:+.1f}, {by-ay:+.1f} | {(bx-ax)*k:+.2f}, {(by-ay)*k:+.2f} | {ar:.1f} / {br:.1f} | {ah:.1f} / {bh:.1f} |")
print()
print("| Button | Offset from ATTACK on his sheet (sheet px) | In game (HUD px, attack radius 70) | Radius in game (HUD px) | Radius as a share of ATTACK, his / ours |")
print("|---|---|---|---|---|")
for bid in B:
    ax, ay, ar, _ = a[bid]; bx, by, br, _ = b[bid]
    print(f"| {bid.upper()} | {ax-a["attack"][0]:+.1f}, {ay-a["attack"][1]:+.1f} | {(ax-a["attack"][0])*k:+.1f}, {(ay-a["attack"][1])*k:+.1f} | {ar*k:.1f} | {ar/a["attack"][2]:.3f} / {br/b["attack"][2]:.3f} |")
