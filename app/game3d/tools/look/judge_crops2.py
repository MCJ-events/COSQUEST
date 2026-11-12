#!/usr/bin/env python3
"""judge_crops2.py <stills dir> <out dir> [--round3]

Round 2 pairs for the blind judge (a = the real look with the close camera and the beats, b = build 21):
game camera hero and target, the intro shot, the victory shot and the side camera, per cast, time of day
and orientation. Each crop is ONE fighter's box in its own frame, so ours is larger when the camera is
closer: that is what the player sees. The crop rule: build 21's crop is enlarged to 520 px high when it is
smaller (as the judge's own baseline crops were), and ours is enlarged by at most the same factor (never
more), then capped at 1100 px high. Writes pairs.csv (pair_id,a,b) and ours.txt (the a-side game-camera and
intro crops in portrait, for the score and blocky modes). Needs Pillow."""
import csv, json, os, sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
os.makedirs(os.path.join(out, "img"), exist_ok=True)
rows, ours, sizes = [], [], []
SETS = {"port": [("a", "game", "hero"), ("a", "game", "enemy"), ("beats_intro", "game", "hero"), ("beats_win", "game", "hero"), ("a", "side", "hero")],
        "land": [("a", "game", "hero"), ("beats_intro", "game", "hero")]}


def crop(cast, t, v, o, shot, view, who):
    base = "%s_%s_%s_%s_%s" % (cast, t, v, o, shot)
    jp = os.path.join(src, base + ".json")
    ip = os.path.join(src, "%s_%s.png" % (base, view))
    if not (os.path.exists(jp) and os.path.exists(ip)):
        return None
    box = json.load(open(jp))["views"].get(view, {}).get(who)
    if not box:
        return None
    im = Image.open(ip).convert("RGB")
    x0, y0, x1, y1 = box
    c = im.crop((max(int(x0), 0), max(int(y0), 0), min(int(x1), im.width), min(int(y1), im.height)))
    return c if c.width >= 24 and c.height >= 24 else None


R3 = "--round3" in sys.argv     # round 3: Forge and asset characters only; game hero, game target, intro, victory; both orientations
if R3:
    SETS = {o: [("a", "game", "hero"), ("a", "game", "enemy"), ("beats_intro", "game", "hero"), ("beats_win", "game", "hero")] for o in ("port", "land")}
for cast in (("forgen", "asset") if R3 else ("cast", "forgen", "asset")):
    name = {"cast": "cast", "forgen": "forge", "asset": "asset"}[cast]
    for t in ("golden", "dusk", "night"):
        for o in ("port", "land"):
            for shot, view, who in SETS[o]:
                b = crop(cast, t, "before", o, shot, view, who)
                a = crop(cast, t, "after", o, shot, view, who)
                if a is None or b is None:
                    print("missing", cast, t, o, shot, view, who)
                    continue
                k = max(1.0, 520.0 / b.height)
                ka = min(k, 1100.0 / a.height)
                b2 = b.resize((max(int(b.width * k), 1), max(int(b.height * k), 1)), Image.LANCZOS) if k != 1.0 else b
                a2 = a.resize((max(int(a.width * ka), 1), max(int(a.height * ka), 1)), Image.LANCZOS) if ka != 1.0 else a
                pid = "%s_%s_%s_%s_%s_%s" % (name, t, o, shot.replace("beats_", ""), view, who)
                a2.save(os.path.join(out, "img", pid + "_after.jpg"), quality=92)
                b2.save(os.path.join(out, "img", pid + "_before.jpg"), quality=92)
                rows.append([pid, "img/%s_after.jpg" % pid, "img/%s_before.jpg" % pid])
                sizes.append([pid, a.height, b.height, round(ka, 2), round(k, 2)])
                if R3 or (o == "port" and view == "game" and who == "hero" and shot in ("a", "beats_intro")):
                    ours.append("img/%s_after.jpg" % pid)
with open(os.path.join(out, "pairs.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["pair_id", "a", "b"])
    w.writerows(rows)
with open(os.path.join(out, "crop_sizes.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["pair_id", "ours_px_high", "build21_px_high", "ours_enlarged_x", "build21_enlarged_x"])
    w.writerows(sizes)
open(os.path.join(out, "ours.txt"), "w").write("\n".join(ours) + "\n")
print(len(rows), "pairs,", len(ours), "pictures for score and blocky")
