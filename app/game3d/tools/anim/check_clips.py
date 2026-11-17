"""Checks every clip of every library (cq 012): no frame near the rest pose (a T/A-pose flash),
no stretch of frozen frames in a clip that should move. Prints one line per clip and a summary.
  $BLENDER_PY check_clips.py app/game3d/anim/*.glb
fid29 combat (build 29): with --real data/anim_real.json (run from app/game3d) it also checks that every captured clip
standing in for a build 28 clip keeps that button's length and event times (frames, contact, in, out, tail against
data/anim_clips.json, and the frame count in its anim/real library), then checks the anim/real libraries as above.
  python check_clips.py --real data/anim_real.json"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltf import Glb, qinv, qmul, qnorm  # noqa: E402


def ang(a, b):
    d = np.abs(np.sum(qnorm(a) * qnorm(b), -1))
    return np.degrees(2 * np.arccos(np.clip(d, -1, 1)))


bad = 0
args = sys.argv[1:]
if args[:1] == ["--real"]:
    import json
    real = json.load(open(args[1]))
    old = json.load(open(os.path.join(os.path.dirname(args[1]), "anim_clips.json")))["clips"]
    libs = set()
    for key, c in real["characters"].items():
        lib = c["library"].replace("res://", "")
        libs.add(lib)
        frames = {}
        for name, an in Glb(lib).animations().items():
            rots = [ch for ch in an["channels"] if ch[1] == "rotation"]
            frames[name] = len(rots[0][3]) if rots else -1
        for st, cn in c.get("states", {}).items():
            m = real["clips"][cn]
            o = old.get(m.get("replaces", ""), {})
            diff = [k for k in ("frames", "contact", "in", "out", "tail") if (k in o) != (k in m) or (k in o and int(o[k]) != int(m[k]))]
            if frames.get(cn) != o.get("frames"):
                diff.append("library frames %s" % frames.get(cn))
            bad += 1 if diff or not o else 0
            print("%-18s %-9s %-20s replaces %-28s %s" % (key, st, cn, m.get("replaces", "?"), "same length and events" if not diff and o else "CHECK " + str(diff)))
    args = sorted(libs)
for path in args:
    g = Glb(path)
    rest = {i: g.node_trs(i)[1] for i in range(len(g.nodes))}
    for name, an in g.animations().items():
        rots = [(node, vout) for node, p, tin, vout, _ in an["channels"] if p == "rotation"]
        n = len(rots[0][1])
        # mean angle from rest over the bones, per frame (arms and legs move most)
        to_rest = np.mean([ang(v, np.repeat(rest[node][None], n, 0)) for node, v in rots], 0)
        step = np.max([ang(v[1:], v[:-1]) for node, v in rots], 0)
        frozen_run = 0
        run = 0
        for s in step:
            run = run + 1 if s < 0.05 else 0
            frozen_run = max(frozen_run, run)
        flash = float(to_rest.min())
        hold = name.startswith("Death") or name.startswith("UAL_Death") or name in ("Blocking", "2H_Ranged_Aiming")
        ok = flash > 4.0 and (frozen_run < 9 or hold)
        bad += 0 if ok else 1
        print("%-12s %-34s frames=%3d min_from_rest=%5.1f deg  longest_frozen=%2d frames %s" % (
            os.path.basename(path)[:-4], name, n, flash, frozen_run, "ok" if ok else "CHECK"))
print("CHECK_CLIPS problems:", bad)
