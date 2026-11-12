"""Interim SPLIT / WHIRL / RALLY buttons: Wale's own shield button (ring, rim, grey segments, as cut from his sheet)
recoloured, with a new centre from the klein draft. Writes art/cut/<id>.png and <id>_seg.png like cut.py does."""
import colorsys, json, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
CUT, GEN = sys.argv[1], sys.argv[2]
PICK = {"split": "splitb_11", "whirl": "whirl_11", "rally": "rally_27"}
meta = json.load(open(f"{CUT}/cut.json"))
sh = meta["shield"]; half = sh["half"]; R = sh["r"]
base = np.asarray(Image.open(f"{CUT}/shield.png")).astype(np.float32)
seg = Image.open(f"{CUT}/shield_seg.png")
yy, xx = np.mgrid[0:2 * half, 0:2 * half]
ox, oy = sh["cx"] - sh["px"][0], sh["cy"] - sh["px"][1]
rr = np.hypot(xx - half - ox, yy - half - oy)
rgb = base[..., :3] / 255.0
mx, mn = rgb.max(2), rgb.min(2); sat = (mx - mn) / np.maximum(mx, 1e-5)
segmask = np.asarray(seg)[..., 3] > 40

def hsv(a):
    import cv2
    o = cv2.cvtColor(a.astype(np.float32), cv2.COLOR_RGB2HSV); o[..., 0] /= 360.0
    return o
def rgbf(a):
    import cv2
    b = a.astype(np.float32).copy(); b[..., 0] *= 360.0
    return cv2.cvtColor(b, cv2.COLOR_HSV2RGB)

def find_disc(g):
    """centre and radius of the klein draft's button: the saturated / dark blob in the middle"""
    a = g.astype(np.float32); bg = np.median(a[:30, :30].reshape(-1, 3), 0)
    H, W, _ = a.shape; Y, X = np.mgrid[0:H, 0:W]
    s = (a.max(2) - a.min(2)); dark = a.mean(2) < 150
    m = ((s > 70) | dark) & (np.hypot(X - W / 2, Y - H / 2) < W * 0.46)
    m = ndi.binary_opening(m, iterations=3); lab, n = ndi.label(m)
    big = np.argmax(np.bincount(lab.ravel())[1:]) + 1; m = ndi.binary_fill_holes(lab == big)
    ys, xs = np.where(m)
    return (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2, ((xs.max() - xs.min()) + (ys.max() - ys.min())) / 4

for bid, name in PICK.items():
    g = np.asarray(Image.open(f"{GEN}/{name}.png").convert("RGB"))
    gx, gy, gr = find_disc(g)
    # the draft's rim colour: saturated pixels on its rim, away from the grey segments
    H, W, _ = g.shape; Y, X = np.mgrid[0:H, 0:W]; gd = np.hypot(X - gx, Y - gy)
    gh = hsv(g / 255.0)
    rim = (gd > gr * 0.80) & (gd < gr * 0.93) & (gh[..., 1] > 0.5)
    th = float(np.angle(np.exp(1j * gh[..., 0][rim] * 2 * np.pi).mean()) / (2 * np.pi)) % 1.0
    ts, tv = float(np.median(gh[..., 1][rim])), float(np.median(gh[..., 2][rim]))
    # his shield, hue moved to the draft's: only the coloured parts (the grey segments stay his)
    h = hsv(rgb)
    col = (sat > 0.22) & ~segmask
    src = col & (rr > R * 0.78) & (rr < R * 0.95)
    sh_, ss_, sv_ = np.median(h[..., 0][src]), np.median(h[..., 1][src]), np.median(h[..., 2][src])
    h2 = h.copy()
    h2[..., 0] = np.where(col, (h[..., 0] - sh_ + th) % 1.0, h[..., 0])
    h2[..., 1] = np.where(col, np.clip(h[..., 1] * ts / ss_, 0, 1), h[..., 1])
    h2[..., 2] = np.where(col, np.clip(h[..., 2] * min(1.25, tv / sv_), 0, 1), h[..., 2])
    ring = rgbf(h2) * 255.0
    # the draft's centre, scaled so its disc is his disc, pasted inside the rim's inner edge
    k = R / gr
    gs = Image.fromarray(g).resize((int(round(W * k)), int(round(H * k))), Image.LANCZOS)
    cen = np.zeros_like(ring); px, py = half + ox - gx * k, half + oy - gy * k
    canvas = Image.new("RGB", (2 * half, 2 * half)); canvas.paste(gs, (int(round(px)), int(round(py))))
    cen = np.asarray(canvas).astype(np.float32)
    w = np.clip((R * 0.735 - rr) / (R * 0.03), 0, 1)[..., None]          # 1 inside the face, 0 on the rim
    out = ring * (1 - w) + cen * w
    Image.fromarray(np.dstack([np.clip(out, 0, 255), base[..., 3]]).astype(np.uint8), "RGBA").save(f"{CUT}/{bid}.png")
    seg.save(f"{CUT}/{bid}_seg.png")
    m = dict(sh); m["from"] = "shield (Wale) ring, recoloured; centre " + name + " (klein, interim)"
    hr, hg, hb = colorsys.hsv_to_rgb(th, 0.24, 0.97); m["halo_rgb"] = [int(hr * 255), int(hg * 255), int(hb * 255)]
    m["rim_hsv"] = [round(th, 3), round(ts, 3), round(tv, 3)]; m["draft_disc"] = [round(gx, 1), round(gy, 1), round(gr, 1)]
    meta[bid] = m; print(bid, m["rim_hsv"], m["draft_disc"], m["halo_rgb"])
json.dump(meta, open(f"{CUT}/cut.json", "w"), indent=1)
