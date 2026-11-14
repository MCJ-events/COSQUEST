"""flagview.py IN.glb MASK.npz OUT.jpg [--key bad] [--mesh geometry_0]: orthographic front, back and side views of the
rest-pose body, flat-shaded, flagged triangles red (painter's algorithm, PIL). For checking a clean-up by eye."""
import argparse, os, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hglb import Glb

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('mask'); ap.add_argument('out')
ap.add_argument('--key', default='bad'); ap.add_argument('--mesh', default='geometry_0'); ap.add_argument('--size', type=int, default=900)
ap.add_argument('--zoom', default=None, help='y0,y1 fraction of height to show')
a = ap.parse_args()
g = Glb(a.src)
mi, prim = g.find_prim(a.mesh)
A = g.prim_arrays(prim)
P = A['POSITION'].astype(float); I = A['indices'].reshape(-1, 3)
bad = np.load(a.mask)[a.key].astype(bool)
y0, y1 = P[:, 1].min(), P[:, 1].max()
if a.zoom:
    f0, f1 = [float(v) for v in a.zoom.split(',')]
    lo, hi = y0 + f0 * (y1 - y0), y0 + f1 * (y1 - y0)
else:
    lo, hi = y0, y1
S = a.size
views = []
for name, R in (('front', np.eye(3)), ('back', np.diag([-1, 1, -1.0])),
                ('side', np.array([[0, 0, 1.0], [0, 1, 0], [-1, 0, 0]]))):
    Q = P @ R.T
    sc = S / (hi - lo) * 0.95
    cx = Q[:, 0].mean()
    im = Image.new('RGB', (int(S * 0.75), S), (30, 30, 34))
    d = ImageDraw.Draw(im)
    T = Q[I]
    n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    shade = np.clip(0.25 + 0.75 * np.abs(n @ np.array([0.3, 0.5, 0.8]) / np.linalg.norm([0.3, 0.5, 0.8])), 0, 1)
    z = T[:, :, 2].mean(1)
    for t in np.argsort(z):
        pts = [((x - cx) * sc + im.width / 2, (hi - y) * sc + S * 0.025) for x, y, _ in T[t]]
        c = (int(230 * shade[t]), int(40 * shade[t]), int(40 * shade[t])) if bad[t] else tuple([int(200 * shade[t])] * 3)
        d.polygon(pts, fill=c)
    views.append(im)
out = Image.new('RGB', (sum(v.width for v in views), S))
x = 0
for v in views:
    out.paste(v, (x, 0)); x += v.width
out.save(a.out, quality=85)
print('wrote', a.out, 'flagged', int(bad.sum()))
