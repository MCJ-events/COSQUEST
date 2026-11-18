#!/usr/bin/env python3
"""BVH motion capture to a skeleton-only GLB clip library for retarget.py (fid29 combat, build 29).

  python3 bvh2glb.py --clips bvh_clips.json --lib cmcd --src <dir> --out cmcd.glb
  python3 bvh2glb.py --look <file.bvh> [--f0 a --f1 b --every n] [--sheet out.png]

Sources (fetched per file, never a whole archive; never shipped raw, never in a public repo):
  cmcd   Cologne Motion Capture Database, TH Koeln (University of Applied Sciences),
         https://mocap.web.th-koeln.de/ , CC BY 4.0 (credit in the app's Credits screen)
  style  100STYLE, Ian Mason et al., https://www.ianxmason.com/100style/ , CC BY 4.0 (credit)

The output is what cmu2glb.py writes for CMU: one skeleton (the library's first take), every joint's
rest rotation at identity and its rest translation the BVH OFFSET in metres, so retarget.py's
"rotation since rest" is the BVH rotation itself; leaf nodes "<joint>_end" at the End Sites; the hips
at their rest height over the toes. Per clip (bvh_clips.json "clips", entries with "lib" = --lib):
frames f0..f1 of the take at its own rate, resampled to 30 a second (or to exactly "frames" output
frames, with "warp" anchors [[source frame, output frame], ...] so an event lands on a given frame:
how a new clip keeps the length and event times of the build 28 clip it stands in for), turned so the
body faces +Z ("face": "mean", "start", a frame, or {"aim": frame, "hand": "RightHand"}), the start at
the origin, the lowest toe on the floor, optionally mirrored left/right.
"""
import argparse
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltf import mat_to_q, q_to_mat, qnorm, qslerp, write_glb  # noqa: E402

OUT_FPS = 30.0


def rot(axis, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    if axis == "X":
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis == "Y":
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def ry(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


class Bvh:
    def __init__(self, path, scale=0.01):
        self.order = []          # joints, parents first
        self.parent = {}
        self.offset = {}
        self.channels = {}
        self.ends = {}           # joint -> End Site offset
        self.children = {}
        toks = open(path).read().split()
        i = 0
        stack = []
        cur = None
        while toks[i] != "MOTION":
            t = toks[i]
            if t in ("ROOT", "JOINT"):
                cur = toks[i + 1]
                self.order.append(cur)
                self.parent[cur] = stack[-1] if stack else None
                if stack:
                    self.children.setdefault(stack[-1], []).append(cur)
                i += 2
            elif t == "End":
                # End Site { OFFSET x y z }
                j = toks.index("OFFSET", i)
                self.ends[stack[-1]] = np.array([float(x) for x in toks[j + 1:j + 4]]) * scale
                i = toks.index("}", j) + 1
                continue
            elif t == "{":
                stack.append(cur)
                i += 1
            elif t == "}":
                stack.pop()
                i += 1
            elif t == "OFFSET":
                self.offset[stack[-1]] = np.array([float(x) for x in toks[i + 1:i + 4]]) * scale
                i += 4
            elif t == "CHANNELS":
                n = int(toks[i + 1])
                self.channels[stack[-1]] = toks[i + 2:i + 2 + n]
                i += 2 + n
            else:
                i += 1
        i += 1
        assert toks[i] == "Frames:"
        nf = int(toks[i + 1])
        assert toks[i + 2] == "Frame" and toks[i + 3] == "Time:"
        self.fps = 1.0 / float(toks[i + 4])
        vals = np.array(toks[i + 5:], dtype=float)
        nch = sum(len(c) for c in self.channels.values())
        self.data = vals[:nf * nch].reshape(nf, nch)
        self.scale = scale
        self.root = self.order[0]
        # a skeleton whose T-pose faces another way than +Z (100STYLE) is turned so its rest faces +Z:
        # offsets turned, every local rotation conjugated (the motion is the same, seen turned)
        self.R0 = np.eye(3)
        rh = rest_heading(self)
        if abs(rh) > 1e-3:
            self.R0 = ry(-rh)
            self.offset = {j: self.R0 @ o for j, o in self.offset.items()}
            self.ends = {j: self.R0 @ o for j, o in self.ends.items()}

    def frame_pose(self, k):
        """(root position in metres, {joint: local rotation matrix}) of frame k."""
        row = self.data[k]
        c = 0
        loc = {}
        pos = np.zeros(3)
        for j in self.order:
            R = np.eye(3)
            for ch in self.channels[j]:
                v = row[c]
                c += 1
                if ch.endswith("position"):
                    pos["XYZ".index(ch[0])] = v * self.scale
                else:
                    R = R @ rot(ch[0], v)
            loc[j] = self.R0 @ R @ self.R0.T
        return self.R0 @ pos, loc

    def joints(self, pos, loc):
        P = {self.root: pos + self.offset[self.root]}
        R = {self.root: loc[self.root]}
        for j in self.order[1:]:
            p = self.parent[j]
            P[j] = P[p] + R[p] @ self.offset[j]
            R[j] = R[p] @ loc[j]
        for j, e in self.ends.items():
            P[j + "_end"] = P[j] + R[j] @ e
        return P, R

    def rest_joints(self):
        return self.joints(np.zeros(3), {j: np.eye(3) for j in self.order})

    def feet(self):
        """The toe joints (lowest leaf of each leg)."""
        out = [j for j in self.order if j in self.ends and self.parent[j] is not None and ("Toe" in j or "toe" in j)]
        return out or [j for j in self.order if j in self.ends and self.rest_joints()[0][j][1] < 0.2]

    def hips_lr(self):
        """(left hip joint, right hip joint)."""
        kids = self.children.get(self.root, [])
        P, _ = self.rest_joints()
        legs = [k for k in kids if P[k][1] < P[self.root][1] + 0.02 and abs(P[k][0] - P[self.root][0]) > 0.02]
        legs = sorted(legs, key=lambda k: -P[k][0])   # +X is the left of a body facing +Z
        return legs[0], legs[-1]

    def rest_root_height(self):
        P, _ = self.rest_joints()
        return P[self.root][1] - min(P[f + "_end"][1] if f + "_end" in P else P[f][1] for f in self.feet())


def heading(bvh, pos, loc):
    """Yaw of the body: forward = lateral (right hip to left hip) x up."""
    l, r = bvh.hips_lr()
    P, _ = bvh.joints(pos, loc)
    lat = P[l] - P[r]
    f = np.cross(lat, np.array([0.0, 1.0, 0.0]))
    return math.atan2(f[0], f[2])


def rest_heading(bvh):
    P, _ = bvh.rest_joints()
    l, r = bvh.hips_lr()
    f = np.cross(P[l] - P[r], np.array([0.0, 1.0, 0.0]))
    return math.atan2(f[0], f[2])


def sample(bvh, x):
    """The pose at fractional source frame x (rotations slerped, position lerped)."""
    k0 = int(math.floor(x))
    k0 = max(0, min(len(bvh.data) - 1, k0))
    k1 = min(len(bvh.data) - 1, k0 + 1)
    u = x - k0
    p0, l0 = bvh.frame_pose(k0)
    if u < 1e-6 or k1 == k0:
        return p0, l0
    p1, l1 = bvh.frame_pose(k1)
    loc = {j: q_to_mat(qnorm(qslerp(mat_to_q(l0[j]), mat_to_q(l1[j]), u))) for j in l0}
    return p0 * (1 - u) + p1 * u, loc


def src_frames(spec, fps):
    """The source frame (fractional) of every output frame."""
    f0 = float(spec.get("f0", 0))
    f1 = float(spec["f1"])
    n = int(spec.get("frames", 0))
    if n <= 0:
        n = int(round((f1 - f0) / fps * OUT_FPS)) + 1
    anchors = [[f0, 0.0]] + [[float(a), float(b)] for a, b in spec.get("warp", [])] + [[f1, float(n - 1)]]
    anchors = sorted(anchors, key=lambda a: a[1])
    xs = []
    for k in range(n):
        for (sa, oa), (sb, ob) in zip(anchors[:-1], anchors[1:]):
            if oa <= k <= ob:
                u = 0.0 if ob == oa else (k - oa) / (ob - oa)
                xs.append(sa + (sb - sa) * u)
                break
    return xs


def mirror_pose(bvh, pose):
    pos, loc = pose
    S = np.diag([-1.0, 1.0, 1.0])
    l2 = {}
    for j, m in loc.items():
        o = j
        if j.startswith("Left") and ("Right" + j[4:]) in loc:
            o = "Right" + j[4:]
        elif j.startswith("Right") and ("Left" + j[5:]) in loc:
            o = "Left" + j[5:]
        l2[o] = S @ m @ S
    return S @ pos, l2


def build_clip(bvh, spec):
    xs = src_frames(spec, bvh.fps)
    poses = [sample(bvh, x) for x in xs]
    face = spec.get("face", "mean")
    if isinstance(face, dict):
        x = float(face["aim"])
        k = int(np.argmin([abs(v - x) for v in xs]))
        P, _ = bvh.joints(poses[k][0], poses[k][1])
        d = P[face.get("hand", "RightHand")] - P[bvh.root]
        yaw = math.atan2(d[0], d[2])
    elif isinstance(face, (int, float)):
        k = int(np.argmin([abs(v - face) for v in xs]))
        yaw = heading(bvh, *poses[k])
    elif face == "start":
        yaw = heading(bvh, *poses[0])
    else:
        s = sum(math.sin(heading(bvh, *p)) for p in poses)
        c = sum(math.cos(heading(bvh, *p)) for p in poses)
        yaw = math.atan2(s, c)
    yaw -= math.radians(float(spec.get("turn", 0.0)))
    T = ry(-yaw)
    p0 = poses[0][0].copy()
    out = []
    for pos, loc in poses:
        d = pos - p0
        l2 = dict(loc)
        l2[bvh.root] = T @ loc[bvh.root]
        out.append((T @ np.array([d[0], 0.0, d[2]]) + np.array([0.0, pos[1], 0.0]), l2))
    # the floor: the lowest a toe gets in the clip is the ground
    low = 1e9
    feet = bvh.feet()
    for pos, loc in out:
        P, _ = bvh.joints(pos, loc)
        for f in feet:
            low = min(low, P[f + "_end"][1] if f + "_end" in P else P[f][1])
    out = [(pos - np.array([0.0, low, 0.0]), loc) for pos, loc in out]
    if spec.get("mirror"):
        out = [mirror_pose(bvh, p) for p in out]
    return out


def write(bvh, clips, out, generator):
    names = list(bvh.order)
    index = {n: i for i, n in enumerate(names)}
    nodes = []
    for n in names:
        nn = {"name": n, "translation": [float(x) for x in bvh.offset[n]], "rotation": [0.0, 0.0, 0.0, 1.0]}
        ch = [index[c] for c in bvh.children.get(n, [])]
        if ch:
            nn["children"] = ch
        nodes.append(nn)
    nodes[0]["translation"] = [0.0, float(bvh.rest_root_height()), 0.0]
    for j, e in bvh.ends.items():
        nodes.append({"name": j + "_end", "translation": [float(x) for x in e]})
        nodes[index[j]].setdefault("children", []).append(len(nodes) - 1)
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

    anims = []
    for cname, poses in clips:
        t = np.arange(len(poses)) / OUT_FPS
        tin = add(t.reshape(-1, 1), "SCALAR", True)
        samplers = []
        channels = []
        for n in names:
            q = np.array([mat_to_q(p[1][n]) for p in poses])
            for k in range(1, len(q)):
                if np.dot(q[k], q[k - 1]) < 0:
                    q[k] = -q[k]
            samplers.append({"input": tin, "output": add(q, "VEC4"), "interpolation": "LINEAR"})
            channels.append({"sampler": len(samplers) - 1, "target": {"node": index[n], "path": "rotation"}})
        samplers.append({"input": tin, "output": add(np.array([p[0] + bvh.offset[bvh.root] for p in poses]), "VEC3"), "interpolation": "LINEAR"})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": 0, "path": "translation"}})
        anims.append({"name": cname, "samplers": samplers, "channels": channels})
    gj = {"asset": {"version": "2.0", "generator": generator},
          "scene": 0, "scenes": [{"nodes": [0]}], "nodes": nodes, "animations": anims,
          "accessors": accs, "bufferViews": views, "buffers": [{"byteLength": len(blob)}]}
    write_glb(out, gj, bytes(blob))


def look(path, a):
    bvh = Bvh(path)
    step = max(1, int(round(bvh.fps / OUT_FPS)))
    f1 = a.f1 if a.f1 > 0 else len(bvh.data) - 1
    print("%s: %d frames at %.0f fps (%.1f s), joints %d, rest hips %.2f m, rest heading %.0f deg, feet %s" % (
        os.path.basename(path), len(bvh.data), bvh.fps, len(bvh.data) / bvh.fps, len(bvh.order), bvh.rest_root_height(),
        math.degrees(rest_heading(bvh)), bvh.feet()))
    l, r = bvh.hips_lr()
    sp = [j for j in bvh.order if j.lower().startswith(("spine", "chest"))]
    top = sp[-1] if sp else bvh.root
    head = [j for j in bvh.order if j.lower() == "head"][0]
    prev = None
    print("frame    t   hipY  yaw  lean  tilt  head_v  trunk_w  rhand_v lhand_v  root_v")
    for k in range(a.f0, f1 + 1, step):
        pos, loc = bvh.frame_pose(k)
        P, R = bvh.joints(pos, loc)
        yaw = heading(bvh, pos, loc)
        up = P[top] - P[bvh.root]
        fwd = np.array([math.sin(yaw), 0, math.cos(yaw)])
        left = np.cross(np.array([0.0, 1.0, 0.0]), fwd)
        lean = math.degrees(math.atan2(float(up @ fwd), float(up[1])))
        tilt = math.degrees(math.atan2(float(up @ left), float(up[1])))
        if prev is not None:
            dt = step / bvh.fps
            hv = np.linalg.norm((P[head] - P[bvh.root]) - (prev[0][head] - prev[0][bvh.root])) / dt
            Rt = R[top] @ prev[1][top].T
            tw = math.degrees(math.acos(max(-1.0, min(1.0, (np.trace(Rt) - 1) / 2)))) / dt
            rh = [j for j in P if j.startswith(("RightHand", "RightWrist")) and not j.endswith("_end")][0]
            lh = [j for j in P if j.startswith(("LeftHand", "LeftWrist")) and not j.endswith("_end")][0]
            rv = np.linalg.norm((P[rh] - P[bvh.root]) - (prev[0][rh] - prev[0][bvh.root])) / dt
            lv = np.linalg.norm((P[lh] - P[bvh.root]) - (prev[0][lh] - prev[0][bvh.root])) / dt
            bv = np.linalg.norm((pos - prev[2])[[0, 2]]) / dt
            if (k - a.f0) // step % a.every == 0:
                print("%6d %5.2f %5.2f %4.0f %5.0f %5.0f  %6.2f  %6.0f  %6.2f %6.2f  %5.2f" % (
                    k, k / bvh.fps, pos[1], math.degrees(yaw), lean, tilt, hv, tw, rv, lv, bv))
        prev = (P, R, pos)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clips", default="")
    ap.add_argument("--lib", default="")
    ap.add_argument("--src", default="")
    ap.add_argument("--out", default="")
    ap.add_argument("--look", default="")
    ap.add_argument("--f0", type=int, default=0)
    ap.add_argument("--f1", type=int, default=0)
    ap.add_argument("--every", type=int, default=2)
    a = ap.parse_args()
    if a.look:
        look(a.look, a)
        return
    cfg = json.load(open(a.clips))
    base = None
    clips = []
    cache = {}
    for cname, spec in cfg["clips"].items():
        if spec.get("lib") != a.lib:
            continue
        fp = os.path.join(a.src, spec["file"])
        if fp not in cache:
            cache[fp] = Bvh(fp)
        bvh = cache[fp]
        if base is None:
            base = bvh
        poses = build_clip(bvh, spec)
        k = base.rest_root_height() / bvh.rest_root_height()
        poses = [(p * k, {n: loc.get(n, np.eye(3)) for n in base.order}) for p, loc in poses]
        clips.append((cname, poses))
        print("CLIP %-24s %s frames %s..%s -> %d frames (%.2f s)" % (cname, spec["file"], spec.get("f0", 0), spec.get("f1"), len(poses), len(poses) / OUT_FPS))
    if base is None:
        raise SystemExit("no clip for lib " + a.lib)
    write(base, clips, a.out, "cosquest bvh2glb.py (%s)" % a.lib)
    print("WROTE", a.out, os.path.getsize(a.out))


if __name__ == "__main__":
    main()
