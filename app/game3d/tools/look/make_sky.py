#!/usr/bin/env python3
"""fid29-lightcam: the real cloud skies (art/sky/*.png, arena.gd SKY_REAL_SHADER) from Poly Haven pure-sky HDRIs (CC0).

  make_sky.py --hdr DIR --noise LDR_RGB1_0.png --out app/game3d/art/sky [--preview DIR]
  needs numpy and opencv-python-headless (reads .hdr); runs on mm1's CPU in a venv.

Per time of day (SKIES below):
  1. the HDRI's sun is found (the brightest blurred pixel): its u is written to sky.json ("u_sun"); the shader turns
     the map so that u sits on the key light's heading (no resampling here);
  2. the sun disc is painted out: within 10 deg of the sun, luminance above the 90th percentile of the 10 to 16 deg
     ring is pulled down to it, feathered (the gradient shader keeps drawing its own sun glow);
  3. tone-mapped to the preset: the upper sky's median luminance is set to the gradient's (arena.gd TIMES) at the same
     elevations, the colour pulled half way to the gradient's balance, highlights rolled off under 1 (8-bit storage);
  4. below the horizon the horizon row is repeated (the haze band covers it; no black in the filtering);
  5. 64 x 64 blue noise (Christoph Peters, CC0), triangular (two channels summed), dithers the 8-bit quantisation
     (no flat runs, no banding after VRAM compression; tools/look/sky_runs.gd measures it after compression); written as <time>_hi.png (2048 x 1024) and <time>_mid.png (1024 x 512).
"""
import argparse, json, math, os
import numpy as np
import cv2

SKIES = {"golden": "kloppenheim_06_puresky", "day": "kloppenheim_05_puresky", "dusk": "qwantani_dusk_2_puresky"}
# arena.gd TIMES (sRGB): zenith, upper, horizon
TIMES = {"golden": [(0.227, 0.435, 0.769), (0.525, 0.682, 0.878), (0.949, 0.867, 0.761)],
         "day": [(0.243, 0.498, 0.839), (0.498, 0.698, 0.918), (0.863, 0.91, 0.949)],
         "dusk": [(0.122, 0.169, 0.369), (0.337, 0.376, 0.62), (0.941, 0.643, 0.494)]}
LUM = np.array([0.2126, 0.7152, 0.0722])


def s2l(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def l2s(c):
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 0, None), 1 / 2.4) - 0.055)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def gradient(time, h):
    """The gradient shader's colour (linear) at elevation sine y, for an image of height h (upper half)."""
    z, u, hz = [s2l(c) for c in TIMES[time]]
    v = (np.arange(h) + 0.5) / h               # 0 top .. 1 bottom (whole sphere)
    y = np.cos(v * math.pi)[:, None]
    c = hz[None] * (1 - smooth(0.02, 0.38, y)) + u[None] * smooth(0.02, 0.38, y)
    c = c * (1 - smooth(0.3, 1.0, y)) + z[None] * smooth(0.3, 1.0, y)
    return c, y[:, 0]


def make(time, src, noise, out, preview):
    im = cv2.imread(src, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float64)
    H, W = im.shape[:2]
    L = im @ LUM
    Lb = cv2.GaussianBlur(L, (0, 0), 3)
    sy, sx = np.unravel_index(Lb[: H // 2].argmax(), (H // 2, W))
    u_sun, v_sun = (sx + 0.5) / W, (sy + 0.5) / H
    # angular distance of every pixel to the sun
    vv, uu = np.meshgrid((np.arange(H) + 0.5) / H, (np.arange(W) + 0.5) / W, indexing="ij")
    th, ph = vv * math.pi, uu * 2 * math.pi
    d = np.stack([np.sin(th) * np.cos(ph), np.cos(th), np.sin(th) * np.sin(ph)], -1)
    ts, ps = v_sun * math.pi, u_sun * 2 * math.pi
    sd = np.array([math.sin(ts) * math.cos(ps), math.cos(ts), math.sin(ts) * math.sin(ps)])
    ang = np.degrees(np.arccos(np.clip(d @ sd, -1, 1)))
    ring = L[(ang > 10) & (ang < 16)]
    cap = np.percentile(ring, 90) if ring.size else np.percentile(L, 99)
    k = np.where(L > cap, cap / np.maximum(L, 1e-9), 1.0)
    feather = smooth(10.0, 7.0, ang)           # 1 inside 7 deg, 0 past 10 deg
    k = 1 - feather * (1 - k)
    im = im * k[..., None]
    disc = cv2.GaussianBlur(im, (0, 0), 6)
    im = im * (1 - feather[..., None] * 0.7) + disc * (feather[..., None] * 0.7)
    # the upper half against the gradient
    up = im[: H // 2]
    g, y = gradient(time, H)
    gu = g[: H // 2]
    rows = (y[: H // 2] > 0.05) & (y[: H // 2] < 0.7)
    gl = np.median(gu[rows] @ LUM)
    hl = np.median((up[rows] @ LUM).reshape(-1))
    im = im * (gl / max(hl, 1e-9))
    # colour: half way to the gradient's balance (ratio of channel means over the same rows)
    gm = gu[rows].mean(0)
    hm = im[: H // 2][rows].reshape(-1, 3).mean(0)
    bal = (gm / (gm @ LUM)) / (hm / (hm @ LUM))
    im = im * np.sqrt(bal)[None, None]
    # roll off under 1
    l = im @ LUM
    kn = 0.75
    l2 = np.where(l > kn, kn + (1 - kn) * np.tanh((l - kn) / (1 - kn)), l)
    im = im * (l2 / np.maximum(l, 1e-9))[..., None]
    im = np.clip(im, 0, 1)
    # below the horizon: the horizon row
    hrow = H // 2 - 2
    im[hrow:] = im[hrow - 1][None]
    srgb = l2s(im)
    meta = {"src": os.path.basename(src), "u_sun": round(float(u_sun), 4), "v_sun": round(float(v_sun), 4),
            "sun_elev_deg": round(90 - v_sun * 180, 1), "exposure": round(float(gl / max(hl, 1e-9)), 5),
            "balance": [round(float(b), 4) for b in np.sqrt(bal)], "cap": round(float(cap), 4), "gain": 1.0}
    for tag, (w, h) in {"hi": (2048, 1024), "mid": (1024, 512)}.items():
        s = cv2.resize(srgb, (w, h), interpolation=cv2.INTER_AREA) if (w, h) != (W, H) else srgb.copy()
        n = np.tile(noise, (h // noise.shape[0] + 1, w // noise.shape[1] + 1, 1))[:h, :w]
        # triangular dither from two of the noise's channels (-0.5..1.5 of a step): a level that sits exactly on an
        # 8-bit step still toggles, so no run stays flat (a single channel's 0..1 offset left 31 px runs in the day sky)
        n = n + np.roll(n, 1, axis=2) - 0.5
        q = np.clip(np.floor(s * 255.0 + n), 0, 255).astype(np.uint8)
        cv2.imwrite(os.path.join(out, "%s_%s.png" % (time, tag)), q[:, :, ::-1])
        # flat runs (the gate: none longer than 24 px in the upper sky)
        row = q[: h // 2 - 4].astype(np.int16)
        same = np.all(row[:, 1:] == row[:, :-1], -1)
        longest = 0
        for r in same:
            run = best = 0
            for v in r:
                run = run + 1 if v else 0
                best = max(best, run)
            longest = max(longest, best + 1)
        meta["longest_flat_run_" + tag] = int(longest)
        if preview and tag == "mid":
            cv2.imwrite(os.path.join(preview, "sky_%s.jpg" % time), q[: h // 2, :, ::-1], [cv2.IMWRITE_JPEG_QUALITY, 85])
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hdr", required=True); ap.add_argument("--noise", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--preview", default=""); ap.add_argument("--only", default="")
    ap.add_argument("--golden", default=SKIES["golden"])
    a = ap.parse_args()
    SKIES["golden"] = a.golden
    os.makedirs(a.out, exist_ok=True)
    noise = cv2.imread(a.noise, cv2.IMREAD_UNCHANGED)[:, :, :3].astype(np.float64) / 255.0   # 0..1, the floor offset
    path = os.path.join(a.out, "sky.json")
    doc = json.load(open(path)) if os.path.exists(path) else {}
    for t, name in SKIES.items():
        if a.only and t not in a.only.split(","):
            continue
        doc[t] = make(t, os.path.join(a.hdr, name + "_2k.hdr"), noise, a.out, a.preview)
        print(t, doc[t])
    json.dump(doc, open(path, "w"), indent=1)


if __name__ == "__main__":
    main()
