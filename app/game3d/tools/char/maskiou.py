#!/usr/bin/env python3
"""fid29 charshade: what VRAM block compression does to the material-ID masks.

  maskiou.py MASK_DIR DECODED_DIR
For every <hero>_<lod>.png in MASK_DIR (the lossless source) and its <hero>_<lod>_<etc2|s3tc>.png in DECODED_DIR
(tools/char/maskdecode.gd: the imported texture, decompressed): per class (R skin, G metal, B leather, A cloth sheen)
the IoU of weight >= 0.5 between source and decoded, over the texels where either has the class, and the mean absolute
weight error. Also "leather_or_cloth_as_skin": the share of source leather / cloth texels (>= 0.5) whose decoded skin
weight is >= 0.5 (the lane's "no leather counted as skin"). One JSON line per mask and format.
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

src_dir, dec_dir = Path(sys.argv[1]), Path(sys.argv[2])
for p in sorted(src_dir.glob("*_lod*.png")):
    if p.stem.endswith("_debug"):
        continue
    a = np.asarray(Image.open(p).convert("RGBA"), np.float32) / 255
    for fmt in ("etc2", "s3tc"):
        q = dec_dir / f"{p.stem}_{fmt}.png"
        if not q.exists():
            continue
        b = np.asarray(Image.open(q).convert("RGBA"), np.float32) / 255
        out = {"mask": p.stem, "fmt": fmt}
        for i, c in enumerate(["skin", "metal", "leather", "cloth"]):
            sa, sb = a[..., i] >= 0.5, b[..., i] >= 0.5
            u = (sa | sb).sum()
            out[c + "_iou"] = round(float((sa & sb).sum() / u), 4) if u > 0 else None
            out[c + "_texels"] = int(sa.sum())
            out[c + "_mae"] = round(float(np.abs(a[..., i] - b[..., i]).mean()), 4)
        lc = (a[..., 2] >= 0.5) | (a[..., 3] >= 0.5)
        out["leather_or_cloth_as_skin"] = round(float((lc & (b[..., 0] >= 0.5)).sum() / max(lc.sum(), 1)), 5)
        print(json.dumps(out))
