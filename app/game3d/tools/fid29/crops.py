#!/usr/bin/env python3
"""fid29 named crops (frozen after fid29-base): cut the boxes look_shots.gd wrote ("crops": true) out of a shot.
  crops.py SHOT.png SHOT.json OUTDIR [--who hero] [--names face,eyes,hair,torso,legs,hand_l,hand_r,ground] [--min 96]
Each crop is saved as OUTDIR/<shot>__<who>_<name>.png, scaled up (nearest) to at least --min px on its short side."""
import json, os, sys
from PIL import Image
a = sys.argv[1:]
shot, meta, out = a[0], a[1], a[2]
who = a[a.index("--who") + 1] if "--who" in a else "hero"
names = (a[a.index("--names") + 1] if "--names" in a else "face,eyes,hair,torso,legs,hand_l,hand_r,ground").split(",")
mn = int(a[a.index("--min") + 1]) if "--min" in a else 96
os.makedirs(out, exist_ok=True)
im = Image.open(shot).convert("RGB")
view = "game"
cr = json.load(open(meta)).get("crops", {}).get(view, {}).get(who, {})
base = os.path.basename(shot).rsplit(".", 1)[0]
for n in names:
    r = cr.get(n)
    if not r or r[2] - r[0] < 2 or r[3] - r[1] < 2:
        continue
    c = im.crop(tuple(int(round(v)) for v in r))
    k = max(1, -(-mn // max(1, min(c.size))))
    if k > 1:
        c = c.resize((c.width * k, c.height * k), Image.NEAREST)
    c.save(os.path.join(out, f"{base}__{who}_{n}.png"))
    print(n, [int(v) for v in r])
