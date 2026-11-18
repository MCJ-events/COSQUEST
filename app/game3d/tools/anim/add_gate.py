"""The tear gate for an additive clip, measured the way the game layers it (fid29 combat, build 29).

A directional hit reaction is never played as a pose: pose_layer.gd adds each spine, neck, head and arm bone's
rotation since the clip's first frame on top of whatever the body plays, with the weight combat_animator.gd gives
it (the strongest blow's 1.0, eased out over the last 35 % of the reaction). So its gate is measured on top of the
poses a blow lands on: the hero's own build 28 idle, guard and light hit (from anim/<key>.glb), every other frame
of the hit clip at that weight, on LOD0, LOD1 and LOD2 (the same 2.5x stretch measure and 0.5 % gate as every clip).

  $BLENDER_PY add_gate.py --hero <dir with lod0..2.glb> --lib28 anim/<key>.glb --real anim/real/<key>.glb --clips A,B [--json out]
"""
import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltf import Glb, Pose, qinv, qmul, qnorm, qslerp  # noqa: E402
from retarget import Body  # noqa: E402

ADD_BONES = ["Spine", "Spine1", "Spine2", "Neck", "Head", "LeftShoulder", "LeftArm", "LeftForeArm",
             "RightShoulder", "RightArm", "RightForeArm"]
BASES = [("R_Idle", (0.0, 0.5)), ("R_Guard_hi", (0.0,)), ("UAL_Hit_Chest", (0.1,)), ("R_Idle_2H", (0.0,))]


class Shim:
    """What retarget.Body reads of a Retarget: the target's joints and rest globals."""

    def __init__(self, tgt):
        self.tgt = tgt
        p = Pose(tgt)
        self.t_rest_G = p.globals_of(p.rest)
        skin = tgt.json["skins"][0]
        self.joints = skin["joints"]
        self.jnames = [tgt.names[j] for j in self.joints]


def lib_rots(glb, name, t):
    """{bone name: local rotation} of a library clip at time t."""
    p = Pose(glb)
    an = glb.animations()[name]
    loc = p.locals_at(an, t)
    return {glb.names[i]: np.array(loc[i][1], float) for i in range(len(loc))}, an["length"]


def gate(hero, lib28, real, clips, every=2, gain=1.0):
    out = {}
    l28 = Glb(lib28)
    lr = Glb(real)
    anims28 = l28.animations()
    animsr = lr.animations()
    for lod in ("lod0.glb", "lod1.glb", "lod2.glb"):
        path = os.path.join(hero, lod)
        if not os.path.exists(path):
            continue
        tgt = Glb(path)
        sh = Shim(tgt)
        body = Body(tgt, sh)
        tp = Pose(tgt)
        idx = {n: i for i, n in enumerate(tgt.names)}
        for c in clips:
            if c not in animsr:
                continue
            h0, ln = lib_rots(lr, c, 0.0)
            worst = out.get(c, {"tear": 0.0, "where": {}})
            for base, ts in BASES:
                if base not in anims28:
                    continue
                for tb in ts:
                    b, bl = lib_rots(l28, base, tb * anims28[base]["length"])
                    t = 0.0
                    while t <= ln + 1e-6:
                        ht, _ = lib_rots(lr, c, t)
                        u = min(1.0, t / max(ln, 1e-6))
                        x = min(1.0, max(0.0, (u - 0.65) / 0.35))
                        w = gain * (1.0 - x * x * (3.0 - 2.0 * x))     # combat_animator.gd _add_layers_now at full strength
                        loc = [list(x) for x in tp.rest]
                        for name, q in b.items():
                            if name in idx:
                                loc[idx[name]][1] = q
                        for name in ADD_BONES:
                            if name in idx and name in h0 and name in b:
                                d = qnorm(qslerp(np.array([0.0, 0.0, 0.0, 1.0]), qnorm(qmul(qinv(h0[name]), ht[name])), w))
                                loc[idx[name]][1] = qnorm(qmul(b[name], d))
                        G = tp.globals_of(loc)
                        share, _p99, _mx, where = body.tear(G)
                        if share > worst["tear"]:
                            worst = {"tear": share, "where": where, "lod": lod[:4], "base": base, "t": round(t, 3)}
                        t += every / 30.0
            out[c] = worst
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hero", required=True)
    ap.add_argument("--lib28", required=True)
    ap.add_argument("--real", required=True)
    ap.add_argument("--clips", required=True)
    ap.add_argument("--json", default="")
    a = ap.parse_args()
    r = gate(a.hero, a.lib28, a.real, a.clips.split(","))
    for c, v in r.items():
        print("ADD %-16s tear %.5f %s" % (c, v["tear"], json.dumps({k: v.get(k) for k in ("lod", "base", "t", "where")})))
    if a.json:
        json.dump(r, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()
