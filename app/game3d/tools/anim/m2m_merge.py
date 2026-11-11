#!/usr/bin/env python3
"""Merge Mesh2Motion human clips (one GLB per clip) into one skeleton-only GLB for retarget.py.

  python3 m2m_merge.py --src <dir of decoded *.glb> --out m2m.glb [--only a,b,c]

Source and licence: Mesh2Motion (https://github.com/Mesh2Motion/mesh2motion-app, README "Licenses":
"The art assets (3d models, rigs, animations) are all licensed under CC0"). The published clips are
meshopt-compressed; decode them first with glTF-Transform (read with the meshopt decoder, drop EXT_meshopt_compression, write).
Every clip is sampled at 30 frames a second on the first file's skeleton (matched by bone name);
clip names become M2M_<Name> with spaces as underscores.
"""
import argparse
import glob
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltf import Glb, Pose, write_glb  # noqa: E402

FPS = 30.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    files = sorted(f for f in glob.glob(os.path.join(a.src, "*.glb")) if os.path.basename(f) not in ("model.glb", "rest-pose.glb"))
    if a.only:
        keep = set(a.only.split(","))
        files = [f for f in files if os.path.basename(f)[:-4] in keep]
    base = Glb(files[0])
    bpose = Pose(base)
    # the armature subtree only (no mesh nodes)
    names = base.names
    blob = bytearray()
    views = []
    accs = []

    def add(arr, typ, minmax=False):
        arr = np.ascontiguousarray(arr, dtype=np.float32)
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        blob.extend(arr.tobytes())
        views.append({"buffer": 0, "byteOffset": off, "byteLength": arr.nbytes})
        acc = {"bufferView": len(views) - 1, "componentType": 5126, "count": int(arr.shape[0]), "type": typ}
        if minmax:
            acc["min"] = [float(arr.min())]
            acc["max"] = [float(arr.max())]
        accs.append(acc)
        return len(accs) - 1

    nodes = []
    for i, n in enumerate(base.nodes):
        t, r, s = base.node_trs(i)
        nn = {"name": names[i], "translation": [float(x) for x in t], "rotation": [float(x) for x in r], "scale": [float(x) for x in s]}
        if n.get("children"):
            nn["children"] = list(n["children"])
        nodes.append(nn)
    roots = [i for i in range(len(nodes)) if base.parent[i] < 0]
    anims = []
    for f in files:
        g = Glb(f)
        gp = Pose(g)
        for aname, an in g.animations().items():
            n = max(2, int(round(an["length"] * FPS)) + 1)
            times = np.linspace(0.0, an["length"], n)
            animated = sorted({(node, path) for node, path, _a, _b, _c in an["channels"] if node is not None and path in ("rotation", "translation")})
            tin = add(times.reshape(-1, 1), "SCALAR", True)
            samplers = []
            channels = []
            locs = [gp.locals_at(an, t) for t in times]
            for node, path in animated:
                if g.names[node] not in names:
                    continue
                bi = names.index(g.names[node])
                if path == "rotation":
                    q = np.array([l[node][1] for l in locs])
                    for k in range(1, len(q)):
                        if np.dot(q[k], q[k - 1]) < 0:
                            q[k] = -q[k]
                    samplers.append({"input": tin, "output": add(q, "VEC4"), "interpolation": "LINEAR"})
                else:
                    samplers.append({"input": tin, "output": add(np.array([l[node][0] for l in locs]), "VEC3"), "interpolation": "LINEAR"})
                channels.append({"sampler": len(samplers) - 1, "target": {"node": bi, "path": path}})
            out_name = "M2M_" + aname.replace(" ", "_")
            anims.append({"name": out_name, "samplers": samplers, "channels": channels})
            print("CLIP %-34s %s %.2f s" % (out_name, os.path.basename(f), an["length"]))
    gj = {"asset": {"version": "2.0", "generator": "cosquest m2m_merge.py (Mesh2Motion CC0 clips)"}, "scene": 0,
          "scenes": [{"nodes": roots}], "nodes": nodes, "animations": anims, "accessors": accs, "bufferViews": views,
          "buffers": [{"byteLength": len(blob)}]}
    write_glb(a.out, gj, bytes(blob))
    print("WROTE", a.out, os.path.getsize(a.out))


if __name__ == "__main__":
    main()
