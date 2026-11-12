#!/usr/bin/env python3
"""measure.py <dir> <prefix_shot>... [--csv out.csv]

BAR.md section D on tools/look_shots.gd's frames (run with "masks": true):
  ratio      each fighter's mean luminance over the median luminance of the ground it stands on (2 m round
             it), linear light, on the frame without effects. The bar: 0.7 to 1.4 in every time of day.
  feet       under each planted foot, how much darker the ground is than the ground round the fighter
             (1 - foot / ground). A contact shadow you can see is 0.1 or more.
  clipped    share of the frame (with effects, no HUD) with a channel at 255, and with luma at 245 or more.
Masks are differences of two renders (white minus black), so the tonemap cannot blur them."""
import json, os, sys
import numpy as np
from PIL import Image


def load(p):
    return np.asarray(Image.open(p).convert("RGB")).astype(np.float64) / 255.0


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lum(c):
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def mask(d, tag, kind):
    a, b = load(os.path.join(d, "%s_m_%s1.png" % (tag, kind))), load(os.path.join(d, "%s_m_%s0.png" % (tag, kind)))
    return np.abs(a - b).mean(-1) > 0.2


def measure(d, ps):
    meta = json.load(open(os.path.join(d, ps + ".json")))
    out = {"shot": ps, "views": {}}
    for view, boxes in meta["views"].items():
        tag = "%s_%s" % (ps, view)
        if not os.path.exists(os.path.join(d, tag + "_m_c1.png")):
            continue
        frame = load(os.path.join(d, tag + ".png"))
        calm = lum(lin(load(os.path.join(d, tag + "_m_nofx.png"))))
        ch, gr, ft = mask(d, tag, "c"), mask(d, tag, "g"), mask(d, tag, "f")
        gr &= ~ch
        ft &= ~ch
        h, w = calm.shape
        v = {"clipped_255_pct": round(float((frame.max(-1) >= 0.999).mean() * 100), 3),
             "luma245_pct": round(float((lum(frame) >= 245 / 255.0).mean() * 100), 3), "fighters": {}}
        for who, bx in boxes.items():
            x0, y0, x1, y1 = [int(round(t)) for t in bx]
            pad = int(0.35 * max(x1 - x0, 1))
            X0, X1, Y0, Y1 = max(x0 - pad, 0), min(x1 + pad, w), max(y0 - pad, 0), min(y1 + pad, h)
            if X1 - X0 < 4 or Y1 - Y0 < 4:
                continue
            box = np.zeros_like(ch)
            box[max(y0, 0):min(y1, h), max(x0, 0):min(x1, w)] = True
            wide = np.zeros_like(ch)
            wide[Y0:Y1, X0:X1] = True
            c, g, f = ch & box, gr & wide & ~ft, ft & wide
            if c.sum() < 50 or g.sum() < 50:
                continue
            gl = float(np.median(calm[g]))
            e = {"char_px": int(c.sum()), "char_lum": round(float(calm[c].mean()), 4), "ground_lum": round(gl, 4),
                 "ratio": round(float(calm[c].mean()) / max(gl, 1e-6), 3)}
            if f.sum() >= 12:
                e["feet_darker"] = round(1.0 - float(calm[f].mean()) / max(gl, 1e-6), 3)
                e["feet_px"] = int(f.sum())
            v["fighters"][who] = e
        out["views"][view] = v
    return out


def main():
    d = sys.argv[1]
    args = [a for a in sys.argv[2:] if not a.startswith("--")]
    csv = sys.argv[sys.argv.index("--csv") + 1] if "--csv" in sys.argv else None
    if csv:
        args.remove(csv)
    rows = ["shot,view,clipped_255_pct,luma245_pct,fighter,char_lum,ground_lum,ratio,feet_darker"]
    for ps in args:
        r = measure(d, ps)
        for view, v in r["views"].items():
            for who, e in v["fighters"].items():
                rows.append("%s,%s,%.3f,%.3f,%s,%.4f,%.4f,%.3f,%s" % (ps, view, v["clipped_255_pct"], v["luma245_pct"], who,
                            e["char_lum"], e["ground_lum"], e["ratio"], e.get("feet_darker", "")))
    text = "\n".join(rows)
    if csv:
        open(csv, "w").write(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
