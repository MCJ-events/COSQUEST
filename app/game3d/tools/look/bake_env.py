#!/usr/bin/env python3
"""bake_env.py <capture dir> <data/look_real.json> [--size 32] [--raw]

Turns tools/look/env_capture.gd's six views per time of day into what vfx/char_real.gdshader reads
(look_real.gd): a prefiltered cube (mip = roughness, GGX-like lobes, stored as sqrt(radiance / scale) in 8
bits, six faces across and the mips stacked downwards, PNG as base64) and six ambient colours (the cube's
cosine-weighted light towards +x -x +y -y +z -z, divided by pi, scaled so the light from above matches the
street's own flat ambient, and half way to that ambient's colour: the fighters get the street's amount and
colour of fill, with the cube's direction and half of its colour). --raw (what ships) keeps the cube's own
amount instead: the sunlit paving's bounce is real fill, and the flat ambient has none of it.
Needs numpy and Pillow. Keeps the json's other entries (the grade tables)."""
import base64, io, json, os, sys
import numpy as np
from PIL import Image

SCALE = 4.0
FACES = {"px": ((1, 0, 0), (0, 1, 0)), "nx": ((-1, 0, 0), (0, 1, 0)), "py": ((0, 1, 0), (0, 0, -1)),
         "ny": ((0, -1, 0), (0, 0, 1)), "pz": ((0, 0, 1), (0, 1, 0)), "nz": ((0, 0, -1), (0, 1, 0))}
ORDER = ["px", "nx", "py", "ny", "pz", "nz"]


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def gl_dirs(n):
    """Unit directions of an n x n GL cube face, [6, n, n, 3] (+x -x +y -y +z -z, rows = t downwards)."""
    t, s = np.meshgrid((np.arange(n) + 0.5) / n * 2 - 1, (np.arange(n) + 0.5) / n * 2 - 1, indexing="ij")
    one = np.ones_like(s)
    d = np.stack([np.stack(v, -1) for v in [(one, -t, -s), (-one, -t, s), (s, one, t), (s, -one, -t), (s, -t, one), (-s, -t, -one)]])
    return d / np.linalg.norm(d, axis=-1, keepdims=True)


def load_capture(cdir, time, exposure):
    """The capture as radiance samples: directions [M, 3], radiance [M, 3], solid angles [M]."""
    ds, ls, ws = [], [], []
    for name, (fwd, up) in FACES.items():
        img = np.asarray(Image.open(os.path.join(cdir, "env_%s_%s.png" % (time, name))).convert("RGB")).astype(np.float64) / 255.0
        n = img.shape[0]
        fwd, up = np.array(fwd, float), np.array(up, float)
        right = np.cross(fwd, up)
        y, x = np.meshgrid(1 - (np.arange(n) + 0.5) / n * 2, (np.arange(n) + 0.5) / n * 2 - 1, indexing="ij")
        d = fwd[None, None] + x[..., None] * right[None, None] + y[..., None] * up[None, None]
        r2 = (d ** 2).sum(-1)
        ds.append((d / np.sqrt(r2)[..., None]).reshape(-1, 3))
        ws.append((1.0 / r2 ** 1.5).reshape(-1) * (2.0 / n) ** 2)
        ls.append((srgb_to_lin(img) / exposure).reshape(-1, 3))
    return np.concatenate(ds), np.concatenate(ls), np.concatenate(ws)


def prefilter(d_in, l_in, w_in, n, rough):
    out_d = gl_dirs(n).reshape(-1, 3)
    if rough <= 0.0:
        power = 4000.0
    else:
        a = max(rough * rough, 0.02)
        power = min(2.0 / (a * a) - 2.0, 4000.0)
    # never sharper than the output texel: no aliasing in the small mips
    power = min(power, 1.2 * n * n)
    out = np.zeros((out_d.shape[0], 3))
    for i in range(0, out_d.shape[0], 512):
        c = np.clip(out_d[i:i + 512] @ d_in.T, 0.0, 1.0)
        k = c ** max(power, 1.0) * w_in[None]
        out[i:i + 512] = (k @ l_in) / np.maximum(k.sum(1, keepdims=True), 1e-9)
    return out.reshape(6, n, n, 3)


def main():
    cdir, out_json = sys.argv[1], sys.argv[2]
    size = int(sys.argv[sys.argv.index("--size") + 1]) if "--size" in sys.argv else 32
    doc = json.load(open(out_json)) if os.path.exists(out_json) else {}
    doc.setdefault("env", {})
    doc.setdefault("lut", {})
    for meta_file in sorted(f for f in os.listdir(cdir) if f.startswith("env_") and f.endswith(".json")):
        meta = json.load(open(os.path.join(cdir, meta_file)))
        time = meta["time"]
        d_in, l_in, w_in = load_capture(cdir, time, meta["exposure"])
        mips, s, levels = [], size, 0
        while (size >> levels) >= 1:
            levels += 1
        for lv in range(levels):
            mips.append(prefilter(d_in, l_in, w_in, size >> lv, lv / float(levels - 1)))
        atlas = np.zeros((sum(size >> lv for lv in range(levels)), size * 6, 3), np.uint8)
        y = 0
        for lv, m in enumerate(mips):
            s = size >> lv
            enc = np.clip(np.sqrt(np.clip(m / SCALE, 0, 1)) * 255.0 + 0.5, 0, 255).astype(np.uint8)
            for f in range(6):
                atlas[y:y + s, f * size:f * size + s] = enc[f]
            y += s
        buf = io.BytesIO()
        Image.fromarray(atlas).save(buf, "PNG", optimize=True)
        # six ambient colours: irradiance / pi towards each axis
        axes = np.array([(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)], float)
        cosw = np.clip(axes @ d_in.T, 0, 1) * w_in[None]
        amb = (cosw @ l_in) / np.pi
        lum = lambda c: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
        street = np.array(meta["ambient"]) * meta["ambient_energy"]
        k = 1.0 if "--raw" in sys.argv else lum(street) / max(lum(amb[2]), 1e-6)
        # half the cube's own colour (the sunlit walls' and the paving's bounce), half the street's ambient
        # colour with the cube's brightness by direction: the fighters' shade stays the street's shade
        amb_out = np.array([0.5 * c * k + 0.5 * street * (k * lum(c) / max(lum(street), 1e-6)) for c in amb])
        doc["env"][time] = {"png": base64.b64encode(buf.getvalue()).decode(), "size": size, "scale": SCALE,
                            "amb": [[round(float(v), 4) for v in c] for c in amb_out], "amb_raw_up": [round(float(v), 4) for v in amb[2]],
                            "amb_k": round(float(k), 4)}
        Image.fromarray(atlas).resize((atlas.shape[1] * 4, atlas.shape[0] * 4), Image.NEAREST).save(os.path.join(cdir, "atlas_%s.png" % time))
        print("%s: png %d bytes, raw up %s, street ambient %s, k %.3f, amb +x-x+y-y+z-z %s, max radiance %.2f" % (
            time, len(buf.getvalue()), np.round(amb[2], 3), np.round(street, 3), k, np.round(amb_out, 3).tolist(), l_in.max()))
    json.dump(doc, open(out_json, "w"), separators=(",", ":"))
    print("wrote", out_json, os.path.getsize(out_json), "bytes")


if __name__ == "__main__":
    main()
