#!/usr/bin/env python3
"""bake_lut.py <data/look_real.json> [--faction id=/path/look.cube[:strength]]... [--preview in.png out_prefix]

The colour grade's 3D tables for the real look (arena.gd, look "grade": "base", look "faction": "<id>"):
  base            one grade for every fight: a deeper toe, cool shade and warm mid-tones, a little more colour;
  faction_<id>    a faction's .cube (the 6 Nov signature-look LUTs, colour half only) applied over the base at
                  `strength` (default 0.6: Mark's "filter" dial).
Above mid-grey a table never returns more than it was given (it may tint or darken a highlight, never lift
it), and it is the identity at white, so an additive effect is never pushed to white by the grade: with the
grade on, the only clipped pixels are ones that were clipped without it.
33 points a side, written as 33 slices side by side (x = red, y = green, slice = blue), PNG as base64 in
data/look_real.json (look_real.gd). Needs numpy and Pillow."""
import base64, io, json, os, sys
import numpy as np
from PIL import Image

N = 33


def grid():
    v = np.linspace(0.0, 1.0, N)
    b, g, r = np.meshgrid(v, v, v, indexing="ij")
    return np.stack([r, g, b], -1)            # [b, g, r, 3]


def luma(c):
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def protect(src, graded):
    """Never brighter than the source above mid-grey (a grade may tint and darken a highlight, not lift it),
    and no change at all in the last few percent under white."""
    over = smooth(0.45, 0.65, luma(src))[..., None]
    out = graded * (1.0 - over) + np.minimum(graded, src + 0.01) * over
    k = smooth(0.9, 1.0, src.max(-1))[..., None]
    return np.clip(out * (1.0 - k) + src * k, 0.0, 1.0)


def base_grade(c):
    y = luma(c)[..., None]
    # a deeper toe (display values under 0.25 sink a little; nothing above moves)
    toe = 1.0 - 0.22 * (1.0 - smooth(0.0, 0.3, y))
    out = c * toe
    # split tone: cool shade, warm mid-tones
    shade = (1.0 - smooth(0.05, 0.4, y))
    mid = smooth(0.25, 0.5, y) * (1.0 - smooth(0.6, 0.85, y))
    out = out * (1.0 + shade * np.array([-0.05, 0.0, 0.07]) + mid * np.array([0.035, 0.008, -0.04]))
    # a little more colour in the mid-tones (not in the shade: no neon shadows)
    yy = luma(out)[..., None]
    out = yy + (out - yy) * (1.0 + 0.08 * mid)
    # a soft shoulder: the sunlit paving comes down a little, so the fighters are not standing on glare
    y2 = luma(out)[..., None]
    out = out * (1.0 - 0.08 * smooth(0.55, 0.85, y2))
    return np.clip(out, 0.0, 1.0)


def load_cube(path):
    vals, n = [], 0
    for line in open(path):
        p = line.split()
        if not p:
            continue
        if p[0] == "LUT_3D_SIZE":
            n = int(p[1])
        elif p[0][0].isdigit() or p[0][0] in "-.":
            vals.append([float(x) for x in p[:3]])
    a = np.array(vals).reshape(n, n, n, 3)        # [b, g, r, 3]: red runs fastest in a .cube
    return a, n


def apply_table(tab, n, c):
    """Trilinear lookup of colours c [..., 3] in a [b, g, r, 3] table."""
    x = np.clip(c, 0.0, 1.0) * (n - 1)
    i0 = np.clip(np.floor(x).astype(int), 0, n - 2)
    f = x - i0
    out = np.zeros_like(c)
    for db in (0, 1):
        for dg in (0, 1):
            for dr in (0, 1):
                w = (f[..., 0] if dr else 1 - f[..., 0]) * (f[..., 1] if dg else 1 - f[..., 1]) * (f[..., 2] if db else 1 - f[..., 2])
                out += w[..., None] * tab[i0[..., 2] + db, i0[..., 1] + dg, i0[..., 0] + dr]
    return out


def encode(tab):
    strip = np.zeros((N, N * N, 3), np.uint8)
    q = np.clip(tab * 255.0 + 0.5, 0, 255).astype(np.uint8)
    for b in range(N):
        strip[:, b * N:(b + 1) * N] = q[b]        # rows = green, columns = red
    buf = io.BytesIO()
    Image.fromarray(strip).save(buf, "PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def main():
    out_json = sys.argv[1]
    doc = json.load(open(out_json)) if os.path.exists(out_json) else {}
    doc.setdefault("env", {})
    doc["lut"] = {}
    src = grid()
    tables = {"base": protect(src, base_grade(src))}
    args = sys.argv[2:]
    for i, a in enumerate(args):
        if a == "--faction":
            fid, rest = args[i + 1].split("=", 1)
            path, _, st = rest.partition(":")
            k = float(st) if st else 0.6
            cube, n = load_cube(path)
            b = base_grade(src)
            f = apply_table(cube, n, b)
            tables["faction_" + fid] = protect(src, b * (1.0 - k) + f * k)
            doc["lut"]["faction_" + fid] = {"source": os.path.basename(path), "strength": k}
    for name, tab in tables.items():
        e = doc["lut"].setdefault(name, {})
        e.update({"png": encode(tab), "size": N})
        worst = float((tab - src).max())
        print("%-22s png %d b64 bytes, largest lift over the source %.3f, at white %s" % (name, len(e["png"]), worst, np.round(tab[-1, -1, -1], 3)))
    json.dump(doc, open(out_json, "w"), separators=(",", ":"))
    print("wrote", out_json, os.path.getsize(out_json), "bytes")
    if "--preview" in args:
        pin, pout = args[args.index("--preview") + 1], args[args.index("--preview") + 2]
        img = np.asarray(Image.open(pin).convert("RGB")).astype(np.float64) / 255.0
        for name, tab in tables.items():
            Image.fromarray(np.clip(apply_table(tab, N, img) * 255 + 0.5, 0, 255).astype(np.uint8)).save("%s_%s.jpg" % (pout, name), quality=88)


if __name__ == "__main__":
    main()
