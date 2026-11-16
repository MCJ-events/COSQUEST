# leaf_overdraw.py MESH.json LEAVES.png [threshold] : leaf overdraw of the London plane's crown (fid29 dressing).
# Rasterises the leaf cards orthographically from 8 side views (every 45 degrees, 10 degrees up, as the fight camera sees
# a street tree) on a 1 cm grid scaled to 512 px across the crown and counts, per pixel of the tree mask (pixels where
# at least one fragment survives the alpha test at `threshold`): rasterised fragments (what the GPU shades, alpha-tested
# ones included) and surviving fragments. Prints the mean and p95 over the mask for each view and overall.
import json, math, sys
import numpy as np
from PIL import Image
mesh = json.load(open(sys.argv[1])); alpha = np.asarray(Image.open(sys.argv[2]).convert("RGBA"))[:, :, 3].astype(np.float32) / 255.0
thr = float(sys.argv[3]) if len(sys.argv) > 3 else 0.45
H, W = alpha.shape
tris = []
for s in mesh:
    v = np.array(s["v"], np.float64); uv = np.array(s["uv"], np.float64) if s["uv"] else None
    idx = np.array(s["i"], np.int64).reshape(-1, 3) if s["i"] else np.arange(len(v)).reshape(-1, 3)
    tris.append((v, uv, idx))
N = 512
def view(yaw, pitch):
    cy, sy, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)
    right = np.array([cy, 0, -sy]); fwd = np.array([sy * cp, sp, cy * cp]); up = np.cross(right, fwd) * -1.0
    pts = [(v @ right, v @ up) for v, _, _ in tris]
    allx = np.concatenate([p[0] for p in pts]); ally = np.concatenate([p[1] for p in pts])
    x0, x1, y0, y1 = allx.min(), allx.max(), ally.min(), ally.max(); sc = (N - 1) / max(x1 - x0, y1 - y0)
    raster = np.zeros((N, N), np.int32); passed = np.zeros((N, N), np.int32)
    for (v, uv, idx), (px, py) in zip(tris, pts):
        X = (px - x0) * sc; Y = (py - y0) * sc
        for t in idx:
            a, b, c = t
            xs = np.array([X[a], X[b], X[c]]); ys = np.array([Y[a], Y[b], Y[c]])
            bx0, bx1 = int(max(0, math.floor(xs.min()))), int(min(N - 1, math.ceil(xs.max())))
            by0, by1 = int(max(0, math.floor(ys.min()))), int(min(N - 1, math.ceil(ys.max())))
            if bx1 < bx0 or by1 < by0: continue
            gx, gy = np.meshgrid(np.arange(bx0, bx1 + 1) + 0.5, np.arange(by0, by1 + 1) + 0.5)
            d = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
            if abs(d) < 1e-9: continue
            l0 = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / d
            l1 = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / d
            l2 = 1 - l0 - l1
            inside = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
            if not inside.any(): continue
            raster[by0:by1 + 1, bx0:bx1 + 1] += inside
            if uv is not None:
                u = l0 * uv[a, 0] + l1 * uv[b, 0] + l2 * uv[c, 0]; w = l0 * uv[a, 1] + l1 * uv[b, 1] + l2 * uv[c, 1]
                al = alpha[np.clip((w * H).astype(int) % H, 0, H - 1), np.clip((u * W).astype(int) % W, 0, W - 1)]
                passed[by0:by1 + 1, bx0:bx1 + 1] += inside & (al >= thr)
            else:
                passed[by0:by1 + 1, bx0:bx1 + 1] += inside
    m = passed > 0
    return raster[m], passed[m], m.sum()
R, P = [], []
for k in range(8):
    r, p, n = view(k * math.pi / 4, math.radians(10))
    R.append(r); P.append(p)
    print("view %3d deg: mask %6d px  rasterised mean %.2f p95 %.0f  surviving mean %.2f p95 %.0f" % (k * 45, n, r.mean(), np.percentile(r, 95), p.mean(), np.percentile(p, 95)))
r = np.concatenate(R); p = np.concatenate(P)
print("ALL: rasterised fragments per mask pixel mean %.2f p50 %.0f p95 %.0f; surviving mean %.2f p95 %.0f" % (r.mean(), np.percentile(r, 50), np.percentile(r, 95), p.mean(), np.percentile(p, 95)))
