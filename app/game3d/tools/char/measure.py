#!/usr/bin/env python3
"""fid29 charshade: the lane's numbers from matched b28 / new frames (tools/fid29/shots.sh output folders).

  measure.py B28_DIR NEW_DIR [--orbit TAG ...]
Per shot present in both folders (<tag>_B_intro, <tag>_B_win, <tag>_A_mid; the hero's crops from the shot's json):
  skin   median CIELAB of the skin-coloured pixels in the hero's face crop, b28 against new: Delta E 76. The lane only
         touches skin through the cavity term and the eyes, so this bounds how far it moved the tone skinlook-28 set.
  hair   stair-steps on the hair: in the hero's hair crop, the share of strong luminance edges (Sobel above the 95th
         percentile of the b28 crop) that are single-pixel steps (|Laplacian| > 0.5 x the edge strength). new / b28.
  budget the CQLOOK perf line of each run (texture and video memory, draws, primitives).
--orbit TAG: the 30-frame slow orbit of the intro beat (<TAG>_B_intro_orbit_00..29): specular flicker = mean absolute
  frame-to-frame change of the high-passed luminance (L minus its 2 px blur) over the hero's torso and face boxes.
Prints one JSON line per measure.
"""
import json, re, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage


def lab(rgb):
    c = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def img(p):
    return np.asarray(Image.open(p).convert("RGB"), np.float32) / 255


def crop(a, box):
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    return a[max(y0, 0):max(y1, 0), max(x0, 0):max(x1, 0)]


def boxes(js, who="hero"):
    try:
        return json.loads(Path(js).read_text())["crops"]["game"][who]
    except Exception:
        return {}


def skin_lab(a):
    L = lab(a); h = np.degrees(np.arctan2(L[..., 2], L[..., 1])); ch = np.hypot(L[..., 1], L[..., 2])
    m = (h > 20) & (h < 80) & (ch > 8) & (ch < 50) & (L[..., 0] > 12) & (L[..., 0] < 88)
    return np.median(L[m], 0) if m.sum() > 50 else None


def lum(a):
    return a @ np.array([0.2126, 0.7152, 0.0722])


def stairs(a, thr):
    y = lum(a); gx = ndimage.sobel(y, 1); gy = ndimage.sobel(y, 0); g = np.hypot(gx, gy)
    lap = np.abs(ndimage.laplace(y))
    e = g > thr
    return float((e & (lap > 0.5 * g / 4.0)).sum() / max(e.sum(), 1)), int(e.sum())


def main():
    b28, new = Path(sys.argv[1]), Path(sys.argv[2])
    orbits = sys.argv[sys.argv.index("--orbit") + 1:] if "--orbit" in sys.argv else []
    for jb in sorted(b28.glob("*_B_intro.json")) + sorted(b28.glob("*_B_win.json")) + sorted(b28.glob("*_A_mid.json")):
        name = jb.stem
        if "_orb_" in name or not (new / jb.name).exists():
            continue
        pb, pn = b28 / f"{name}_game.png", new / f"{name}_game.png"
        if not (pb.exists() and pn.exists()):
            continue
        A, B = img(pb), img(pn); bx = boxes(jb)
        out = {"shot": name}
        if "face" in bx:
            sa, sb = skin_lab(crop(A, bx["face"])), skin_lab(crop(B, bx["face"]))
            if sa is not None and sb is not None:
                out["skin_dE76"] = round(float(np.linalg.norm(sa - sb)), 2)
                out["skin_lab_b28"] = [round(float(v), 1) for v in sa]; out["skin_lab_new"] = [round(float(v), 1) for v in sb]
        if "hair" in bx:
            ca, cb = crop(A, bx["hair"]), crop(B, bx["hair"])
            if ca.size > 300:
                y = lum(ca); thr = float(np.percentile(np.hypot(ndimage.sobel(y, 1), ndimage.sobel(y, 0)), 95))
                sa, na = stairs(ca, thr); sb, nb = stairs(cb, thr)
                out["hair_steps_b28"] = round(sa, 4); out["hair_steps_new"] = round(sb, 4)
                out["hair_steps_ratio"] = round(sb / max(sa, 1e-6), 3)
        print(json.dumps(out))
    for t in orbits:
        res = {"orbit": t}
        for nm, d in (("b28", b28), ("new", new)):
            fr = sorted(d.glob(f"{t}_B_intro_orbit_*_game.png")) or sorted(d.glob(f"{t}*orbit_*.png"))
            fr = [f for f in fr if "hud" not in f.name]
            jb = d / f"{t}_B_intro.json"; bx = boxes(jb)
            if len(fr) < 3:
                res[nm] = None; continue
            ys = []
            for f in fr:
                y = lum(img(f)); ys.append(y - ndimage.gaussian_filter(y, 2.0))
            ys = np.stack(ys)
            m = np.zeros(ys.shape[1:], bool)
            for k in ("torso", "face"):
                if k in bx:
                    x0, y0, x1, y1 = [int(round(v)) for v in bx[k]]
                    m[max(y0, 0):y1, max(x0, 0):x1] = True
            if not m.any():
                m[:] = True
            res[nm] = round(float(np.abs(np.diff(ys, axis=0))[:, m].mean()), 5)
            res[nm + "_frames"] = len(fr)
        if res.get("b28") and res.get("new"):
            res["flicker_ratio"] = round(res["new"] / res["b28"], 3)
        print(json.dumps(res))
    for nm, d in (("b28", b28), ("new", new)):
        for lg in sorted((d / "logs").glob("*.log")):
            for line in lg.read_text(errors="ignore").splitlines():
                if line.startswith("CQLOOK perf"):
                    m = dict(re.findall(r"(\w+)=([\d.]+)", line))
                    print(json.dumps({"budget": nm, "shot": line.split()[2], "tex_mb": float(m.get("tex_mb", 0)),
                                      "vmem_mb": float(m.get("vmem_mb", 0)), "draws": int(float(m.get("draws", 0))),
                                      "prims": int(float(m.get("prims", 0))), "objects": int(float(m.get("objects", 0)))}))


if __name__ == "__main__":
    main()
