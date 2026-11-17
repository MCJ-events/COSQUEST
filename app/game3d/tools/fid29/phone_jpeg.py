#!/usr/bin/env python3
"""fid29 judge copies (frozen after fid29-base): phone-path frames (1170x2532) down to 585x1266 JPEG (quality 90),
the only pictures a lane brings to the Mac (keep 4 GB free there; delete them after judging).
  phone_jpeg.py OUTDIR FRAME.png [FRAME.png ...]"""
import os, sys
from PIL import Image
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
for p in sys.argv[2:]:
    im = Image.open(p).convert("RGB")
    im = im.resize((585, round(585 * im.height / im.width)), Image.LANCZOS)
    im.save(os.path.join(out, os.path.basename(p).rsplit(".", 1)[0] + ".jpg"), quality=90)
