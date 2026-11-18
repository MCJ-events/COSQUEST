#!/usr/bin/env python3
"""judge_crops.py <stills dir> <out dir>

Single-character crops of the before/after stills for the blind judge (realism-20261111/judge/judge.py
pairs mode), and the pairs CSV: column a = the real look, column b = build 21, same camera, same moment,
same box. Small crops are enlarged to 520 px high, as the judge's own baseline crops were. Needs Pillow."""
import csv, json, os, sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
os.makedirs(os.path.join(out, "img"), exist_ok=True)
rows = []
for cast in ("cast", "forgen"):
    for t in ("golden", "dusk", "night"):
        meta = json.load(open(os.path.join(src, "%s_%s_after_a.json" % (cast, t))))
        for view, who in (("game", "hero"), ("game", "enemy"), ("side", "hero"), ("side", "enemy"), ("close", "hero")):
            box = meta["views"].get(view, {}).get(who)
            if not box:
                continue
            names = {}
            for v in ("after", "before"):
                im = Image.open(os.path.join(src, "%s_%s_%s_a_%s.png" % (cast, t, v, view))).convert("RGB")
                x0, y0, x1, y1 = box
                px, py = 0.12 * (x1 - x0), 0.06 * (y1 - y0)
                c = im.crop((max(int(x0 - px), 0), max(int(y0 - py), 0), min(int(x1 + px), im.width), min(int(y1 + py), im.height)))
                if c.width < 24 or c.height < 24:
                    break
                if c.height < 520:
                    c = c.resize((max(int(c.width * 520 / c.height), 1), 520), Image.LANCZOS)
                name = "%s_%s_%s_%s_%s.jpg" % ("forge" if cast == "forgen" else cast, t, view, who, v)
                c.save(os.path.join(out, "img", name), quality=92)
                names[v] = "img/" + name
            if len(names) == 2:
                rows.append(["%s_%s_%s_%s" % ("forge" if cast == "forgen" else cast, t, view, who), names["after"], names["before"]])
with open(os.path.join(out, "pairs.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["pair_id", "a", "b"])
    w.writerows(rows)
print(len(rows), "pairs")
