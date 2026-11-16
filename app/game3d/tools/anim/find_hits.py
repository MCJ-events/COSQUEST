#!/usr/bin/env python3
"""Finds the moments a captured body takes a blow (fid29 combat): in the receiver's take of a two-person
capture (CMCD "E_Nussknacker", "E_Kampf", the 2018-01-17 SAM sparring takes), the frames where the trunk
is jolted: the chest's angular speed relative to the pelvis peaks from a calm run before it, with the head
thrown the same way. Each jolt's direction is read from where the chest goes in the body's own frame
(back = struck in front, forward = struck from behind, to its left = struck on its right side).

  python3 find_hits.py --src <dir> take1.bvh take2.bvh ... [--top 6] [--json out.json]

Prints per take the jolts (frame at the source rate, push direction, peak speed in deg/s, chest travel in
degrees over the next 0.25 s) best first, so a clip window can be cut round each: f0 = the calm frame
before it, f1 = 0.5 s after.
"""
import argparse
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bvh2glb import Bvh, heading  # noqa: E402


def chest_of(bvh):
    sp = [j for j in bvh.order if j.lower().startswith(("spine", "chest"))]
    return sp[-1]


def scan(path, top):
    bvh = Bvh(path)
    step = max(1, int(round(bvh.fps / 60.0)))
    chest = chest_of(bvh)
    head = [j for j in bvh.order if j.lower() == "head"][0]
    ks = list(range(0, len(bvh.data), step))
    lean = []
    tilt = []
    for k in ks:
        pos, loc = bvh.frame_pose(k)
        P, R = bvh.joints(pos, loc)
        yaw = heading(bvh, pos, loc)
        fwd = np.array([math.sin(yaw), 0.0, math.cos(yaw)])
        left = np.cross(np.array([0.0, 1.0, 0.0]), fwd)
        up = (P[head] - P[bvh.root])
        lean.append(math.degrees(math.atan2(float(up @ fwd), float(up[1]))))
        tilt.append(math.degrees(math.atan2(float(up @ left), float(up[1]))))
    lean = np.array(lean)
    tilt = np.array(tilt)
    dt = step / bvh.fps
    v = np.hypot(np.gradient(lean, dt), np.gradient(tilt, dt))
    out = []
    used = np.zeros(len(ks), bool)
    for i in np.argsort(-v):
        if used[i] or v[i] < 40.0:
            continue
        a = max(0, i - int(0.12 / dt))
        b = min(len(ks) - 1, i + int(0.25 / dt))
        # a jolt: calm before it (the body was not already swaying hard)
        calm = float(np.median(v[max(0, a - int(0.2 / dt)):a + 1])) if a > 0 else 0.0
        if calm > 0.45 * v[i]:
            used[max(0, i - int(0.3 / dt)):i + int(0.3 / dt)] = True
            continue
        dl = float(lean[b] - lean[a])
        dtl = float(tilt[b] - tilt[a])
        travel = math.hypot(dl, dtl)
        if travel < 6.0:
            used[max(0, i - int(0.3 / dt)):i + int(0.3 / dt)] = True
            continue
        if abs(dl) >= abs(dtl):
            push = "back" if dl < 0 else "fwd"
        else:
            push = "left" if dtl > 0 else "right"
        out.append({"file": os.path.basename(path), "frame": int(ks[i]), "f0": int(ks[a]), "f1": int(ks[min(len(ks) - 1, i + int(0.5 / dt))]),
                    "fps": round(bvh.fps, 2), "push": push, "peak_dps": round(float(v[i]), 1), "lean": round(dl, 1), "tilt": round(dtl, 1),
                    "travel": round(travel, 1), "calm": round(calm, 1)})
        used[max(0, i - int(0.4 / dt)):i + int(0.4 / dt)] = True
        if len(out) >= top:
            break
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--top", type=int, default=8)
    ap.add_argument("--json", default="")
    ap.add_argument("takes", nargs="+")
    a = ap.parse_args()
    allh = []
    for t in a.takes:
        hs = scan(os.path.join(a.src, t), a.top)
        for h in hs:
            print("%-38s frame %5d (%5.2f s) push %-5s peak %6.1f deg/s  lean %+6.1f tilt %+6.1f  travel %5.1f  calm %5.1f" % (
                h["file"], h["frame"], h["frame"] / h["fps"], h["push"], h["peak_dps"], h["lean"], h["tilt"], h["travel"], h["calm"]))
        allh += hs
    if a.json:
        json.dump(allh, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()
