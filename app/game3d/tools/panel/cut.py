"""Cut Wale's five buttons out of his sheet (g_59328.jpg) as sprites with clean alpha.
Writes art/cut/<id>.png (button, straight alpha, defringed), <id>_seg.png (the four grey ring segments only,
lit), <id>_segmask.png and cut.json (centres, radii on the sheet). No resampling: sheet pixels as they are."""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

SHEET = sys.argv[1]; OUT = sys.argv[2]
# measured by probe.py: halo centre x, halo top y, halo radius
B = {"attack": (598.5, 429, 245.0), "shield": (598.5, 75, 140.0), "shoot": (288.0, 168, 115.5),
     "rain": (171.0, 417, 108.5), "dash": (237.0, 711, 95.5)}
im = np.asarray(Image.open(SHEET).convert("RGB")).astype(np.float32)
H, W, _ = im.shape
yy, xx = np.mgrid[0:H, 0:W]
meta = {}
for bid, (hx, top, HR) in B.items():
    hy = top + HR
    rr = np.hypot(xx - hx, yy - hy)
    halo = np.median(im[(rr > HR * 0.93) & (rr < HR * 0.97)], axis=0)
    dh = np.linalg.norm(im - halo, axis=2)
    m = (rr < HR - 3) & (dh > 26)
    lab, n = ndi.label(m)
    big = np.argmax(np.bincount(lab.ravel())[1:]) + 1
    m = ndi.binary_fill_holes(lab == big)
    m = ndi.binary_opening(m, iterations=1)
    ys, xs = np.where(m)
    # the disc itself (without a glyph poking out): fit by the left and bottom extents, which no glyph crosses
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    # robust circle: median radius of boundary pixels in the lower-left half
    edge = m & ~ndi.binary_erosion(m)
    ey, ex = np.where(edge)
    # least squares circle on boundary points in the lower-left 200 degrees
    cx0, cy0 = (x0 + x1) / 2, (y0 + y1) / 2
    ang = np.degrees(np.arctan2(ey - cy0, ex - cx0))
    sel = (ang > 20) & (ang < 250) | (ang < -110)
    A = np.c_[2 * ex[sel], 2 * ey[sel], np.ones(sel.sum())]
    sol, *_ = np.linalg.lstsq(A, ex[sel] ** 2 + ey[sel] ** 2, rcond=None)
    cx, cy = sol[0], sol[1]; R = float(np.sqrt(sol[2] + cx * cx + cy * cy))
    ext = float(np.hypot(xs - cx, ys - cy).max())          # how far the art reaches (the attack's bolt)
    half = int(np.ceil(ext)) + 3
    icx, icy = int(round(cx)), int(round(cy))
    sl = (slice(icy - half, icy + half), slice(icx - half, icx + half))
    rgb = im[sl].copy(); mk = m[sl]
    # soft alpha by unmixing against the halo colour; colour in the edge band from the nearest inside pixel
    inside = ndi.binary_erosion(mk, iterations=3)
    _, idx = ndi.distance_transform_edt(~inside, return_indices=True)
    fg = rgb[idx[0], idx[1]]
    d_in = ndi.distance_transform_edt(mk); d_out = ndi.distance_transform_edt(~mk)
    sd = d_in - d_out                                    # + inside
    v = fg - halo; p = rgb - halo
    a_mix = np.clip((p * v).sum(2) / np.maximum((v * v).sum(2), 1.0), 0, 1)
    a_geo = np.clip(sd / 2.0 + 0.5, 0, 1)                # geometric fallback
    alpha = np.where(sd > 2.5, 1.0, np.where(sd < -2.0, 0.0, np.minimum(a_mix, np.clip(sd / 3.0 + 1.0, 0, 1)) * 0.6 + a_geo * 0.4))
    band = (sd <= 2.5)
    out_rgb = np.where(band[..., None], fg, rgb)
    # a little JPEG ringing inside the edge: median the 2 px inside the band only
    Image.fromarray(np.dstack([np.clip(out_rgb, 0, 255), alpha * 255]).astype(np.uint8), "RGBA").save(f"{OUT}/{bid}.png")
    # the grey ring segments: low saturation, mid value, on the rim
    ly, lx = np.mgrid[0:2 * half, 0:2 * half]
    lr = np.hypot(lx - half - (cx - icx), ly - half - (cy - icy))
    sat = rgb.max(2) - rgb.min(2); val = rgb.mean(2)
    ST = 78 if bid == "attack" else 40
    g = (sat < ST) & (val > 55) & (val < 215) & (lr > R * 0.70) & (lr < R * 1.08) & mk
    if bid == "attack":                                   # its segments are blue-grey; the bolt is pink-white
        g &= (rgb[..., 2] >= rgb[..., 0] - 4) & (rgb[..., 1] > rgb[..., 0] - 30) & (val < 190)
    g = ndi.binary_opening(g, iterations=2)
    lab2, n2 = ndi.label(g)
    sizes = np.bincount(lab2.ravel()); sizes[0] = 0
    keep = [i for i in np.argsort(sizes)[::-1][:6] if sizes[i] > 0.004 * np.pi * R * R]
    g = ndi.binary_closing(np.isin(lab2, keep), iterations=4)
    g = ndi.binary_fill_holes(g)
    g = ndi.gaussian_filter(g.astype(np.float32), 2.0) > 0.5       # smooth the outline
    ga = np.clip(ndi.gaussian_filter(g.astype(np.float32), 0.9) * 1.1, 0, 1) * alpha
    lit = 255.0 - (255.0 - rgb) * 0.34                    # his shading, lifted to near white
    lit = lit * np.array([0.97, 0.96, 1.0])
    Image.fromarray(np.dstack([np.clip(lit, 0, 255), ga * 255]).astype(np.uint8), "RGBA").save(f"{OUT}/{bid}_seg.png")
    quads = []
    for qy in (0, 1):
        for qx in (0, 1):
            quads.append(int(g[qy * half:(qy + 1) * half, qx * half:(qx + 1) * half].sum()))
    meta[bid] = {"cx": round(float(cx), 2), "cy": round(float(cy), 2), "r": round(R, 2), "ext": round(ext, 2), "half": half,
                 "px": [icx, icy], "halo_c": [round(hx, 1), round(hy, 1)], "halo_r": HR,
                 "halo_rgb": [int(x) for x in halo], "seg_px_tl_tr_bl_br": quads, "seg_comps": len(keep)}
    print(bid, meta[bid])
json.dump(meta, open(f"{OUT}/cut.json", "w"), indent=1)
