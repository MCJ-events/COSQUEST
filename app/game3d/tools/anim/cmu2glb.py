#!/usr/bin/env python3
"""CMU motion capture (ASF/AMC) to a skeleton-only GLB clip library for retarget.py.

  python3 cmu2glb.py --cmu <dir with NN.asf and NN_MM.amc> --clips cmu_clips.json --out cmu.glb
  python3 cmu2glb.py --cmu <dir> --look 02_07 [--sheet out.png] [--f0 a --f1 b --step n]

Source and licence: Carnegie Mellon University Graphics Lab Motion Capture Database,
http://mocap.cs.cmu.edu/ ("This dataset of motions is free for all uses."; "You may include this
data in commercially-sold products, but you may not resell this data directly, even in converted
form."). The raw ASF/AMC files are NOT in the repo: fetch the few takes named in cmu_clips.json
per file from the site (the site asks not to be crawled).

What it does per clip (cmu_clips.json "clips"): cuts frames f0..f1 of a take (source frames at the
take's own rate, 120 or 60 a second), resamples to 30 a second, turns the whole clip about the
vertical so the body faces +Z (the cast's forward) at the "face" frame (or on average), puts the
start at the origin, converts inches to metres, and optionally makes it loop ("loop": the last
"blend" frames are cross-faded into the first so the cycle closes). The skeleton is written with
every joint's rest rotation at identity (the ASF rest pose: a T-pose facing +Z), which is what
retarget.py's "rotation since rest" needs.

--look prints where things happen in a take (hand speed peaks, steps, heading, height) and can
draw a stick-figure contact sheet, to pick the frames by eye.
"""
import argparse
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltf import mat_to_q, q_to_mat, qmul, qnorm, qslerp, write_glb  # noqa: E402

INCH = 0.0254
OUT_FPS = 30.0


def rx(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def ry(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rz(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def euler_xyz(v):
    """ASF/AMC rotation for axis order XYZ: v' = Rz Ry Rx v (degrees)."""
    return rz(math.radians(v[2])) @ ry(math.radians(v[1])) @ rx(math.radians(v[0]))


class Asf:
    def __init__(self, path):
        self.bones = {}          # name -> {dir, length, C, dof}
        self.children = {}
        self.order = ["root"]
        self.scale = 1.0
        sec = ""
        cur = None
        for raw in open(path):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith(":"):
                sec = line.split()[0][1:]
                continue
            tok = line.split()
            if sec == "units" and tok[0] == "length":
                self.scale = (1.0 / float(tok[1])) * INCH
            elif sec == "bonedata":
                if tok[0] == "begin":
                    cur = {"dof": []}
                elif tok[0] == "end":
                    self.bones[cur["name"]] = cur
                elif tok[0] == "name":
                    cur["name"] = tok[1]
                elif tok[0] == "direction":
                    cur["dir"] = np.array([float(x) for x in tok[1:4]])
                elif tok[0] == "length":
                    cur["length"] = float(tok[1])
                elif tok[0] == "axis":
                    cur["C"] = euler_xyz([float(x) for x in tok[1:4]])
                elif tok[0] == "dof":
                    cur["dof"] = tok[1:]
            elif sec == "hierarchy":
                if tok[0] in ("begin", "end"):
                    continue
                self.children[tok[0]] = tok[1:]
        # parents-first order
        self.parent = {"root": None}
        stack = ["root"]
        while stack:
            b = stack.pop(0)
            for c in self.children.get(b, []):
                self.parent[c] = b
                self.order.append(c)
                stack.append(c)

    def offset(self, name):
        """A bone node sits at its bone's start: the end of its parent bone (rest, metres)."""
        p = self.parent[name]
        if p is None or p == "root":
            return np.zeros(3)
        b = self.bones[p]
        return b["dir"] * b["length"] * self.scale


def read_amc(path):
    frames = []
    cur = None
    for raw in open(path):
        line = raw.strip()
        if not line or line[0] in "#:":
            continue
        tok = line.split()
        if len(tok) == 1 and tok[0].isdigit():
            cur = {}
            frames.append(cur)
        elif cur is not None:
            cur[tok[0]] = [float(x) for x in tok[1:]]
    return frames


def frame_pose(asf, fr):
    """(root position in metres, {bone: local rotation matrix}) of one AMC frame."""
    loc = {}
    r = fr["root"]
    pos = np.array(r[0:3]) * asf.scale
    loc["root"] = euler_xyz(r[3:6])
    for name, b in asf.bones.items():
        v = [0.0, 0.0, 0.0]
        vals = fr.get(name, [])
        for d, x in zip(b["dof"], vals):
            v["xyz".index(d[1])] = x
        C = b["C"]
        loc[name] = C @ euler_xyz(v) @ C.T
    return pos, loc


def joints(asf, pos, loc):
    """World position of every bone node and its world rotation."""
    P = {"root": pos}
    R = {"root": loc["root"]}
    for name in asf.order[1:]:
        p = asf.parent[name]
        P[name] = P[p] + R[p] @ asf.offset(name)
        R[name] = R[p] @ loc[name]
    return P, R


def heading(R_root):
    """Yaw (about +Y) of the pelvis: the rest pose faces +Z."""
    f = R_root @ np.array([0.0, 0.0, 1.0])
    return math.atan2(f[0], f[2])


def take(cmu, name):
    subj = name.split("_")[0]
    return Asf(os.path.join(cmu, subj + ".asf")), read_amc(os.path.join(cmu, name + ".amc"))


def build_clip(asf, frames, spec):
    src_fps = float(spec.get("src_fps", 120.0))
    step = src_fps / OUT_FPS
    f0 = int(spec.get("f0", 0))
    f1 = int(spec.get("f1", len(frames) - 1))
    f1 = min(f1, len(frames) - 1)
    idx = [int(round(f0 + k * step)) for k in range(int((f1 - f0) / step) + 1)]
    poses = [frame_pose(asf, frames[i]) for i in idx]
    # facing: turn the clip so the pelvis faces +Z at the reference frame (or on average)
    face = spec.get("face", "mean")
    if isinstance(face, dict):
        # an attack is aimed, not faced: the direction from the pelvis to the striking hand at
        # the "aim" frame becomes +Z (a swordsman stands side-on, so the pelvis is no guide)
        k = min(len(poses) - 1, max(0, int(round((face["aim"] - f0) / step))))
        P, _ = joints(asf, poses[k][0], poses[k][1])
        d = P[face.get("hand", "rhand")] - poses[k][0]
        yaw = math.atan2(d[0], d[2])
    elif isinstance(face, (int, float)):
        k = min(len(poses) - 1, max(0, int(round((face - f0) / step))))
        yaw = heading(poses[k][1]["root"])
    elif face == "start":
        yaw = heading(poses[0][1]["root"])
    else:
        s = sum(math.sin(heading(p[1]["root"])) for p in poses)
        c = sum(math.cos(heading(p[1]["root"])) for p in poses)
        yaw = math.atan2(s, c)
    yaw -= math.radians(float(spec.get("turn", 0.0)))
    T = ry(-yaw)
    p0 = poses[0][0].copy()
    out = []
    for pos, loc in poses:
        d = pos - p0
        d[1] = pos[1]
        l2 = dict(loc)
        l2["root"] = T @ loc["root"]
        out.append((T @ np.array([d[0], 0.0, d[2]]) + np.array([0.0, d[1], 0.0]), l2))
    # the floor: the lowest a toe gets in the clip is the ground (marker and calibration offsets
    # leave the captured feet 2 to 5 cm over y = 0)
    if spec.get("floor", True):
        low = 1e9
        for pos, loc in out:
            P, _ = joints(asf, pos, loc)
            low = min(low, P["ltoes"][1], P["rtoes"][1])
        toe_rest = rest_root_height(asf)
        P0, _ = joints(asf, np.zeros(3), {n: np.eye(3) for n in asf.order})
        shift = low - (toe_rest + min(P0["ltoes"][1], P0["rtoes"][1]))
        out = [(pos - np.array([0.0, shift, 0.0]), loc) for pos, loc in out]
    if spec.get("mirror"):
        out = [mirror(asf, p) for p in out]
    n = len(out)
    lp = spec.get("loop")
    if lp:
        # close the cycle: the last `blend` frames fade into the frames before the first
        # (the take must run at least `blend` frames before f0); travel is made linear first
        blend = int(lp.get("blend", 6))
        pre_idx = [int(round(f0 - (blend - k) * step)) for k in range(blend)]
        if min(pre_idx) >= 0:
            pre = [frame_pose(asf, frames[i]) for i in pre_idx]
            d_end = out[-1][0] - np.array([0.0, out[-1][0][1], 0.0])
            for k in range(blend):
                u = (k + 1.0) / (blend + 1.0)
                u = u * u * (3 - 2 * u)
                j = n - blend + k
                pos_a, loc_a = out[j]
                pp, pl = pre[k]
                d = pp - p0
                pos_b = T @ np.array([d[0], 0.0, d[2]]) + np.array([0.0, pp[1], 0.0]) + d_end
                pl = dict(pl)
                pl["root"] = T @ pl["root"]
                loc_c = {}
                for b in loc_a:
                    q = qslerp(mat_to_q(loc_a[b]), mat_to_q(pl[b]), u)
                    loc_c[b] = q_to_mat(qnorm(q))
                out[j] = (pos_a * (1 - u) + pos_b * u, loc_c)
    return out


def mirror(asf, pose):
    """Left-right mirror (x -> -x) of one pose."""
    pos, loc = pose
    S = np.diag([-1.0, 1.0, 1.0])
    l2 = {}
    for b, m in loc.items():
        o = b
        if b[0] in "lr" and (("r" if b[0] == "l" else "l") + b[1:]) in loc:
            o = ("r" if b[0] == "l" else "l") + b[1:]
        l2[o] = S @ m @ S
    return (S @ pos, l2)


def write(asf, clips, out):
    names = asf.order
    index = {n: i for i, n in enumerate(names)}
    nodes = []
    for n in names:
        nn = {"name": n, "translation": [float(x) for x in asf.offset(n)], "rotation": [0.0, 0.0, 0.0, 1.0]}
        ch = [index[c] for c in asf.children.get(n, [])]
        if ch:
            nn["children"] = ch
        nodes.append(nn)
    # the pelvis rests at its height over the toes (retarget.py scales the hips by rest heights)
    nodes[0]["translation"] = [0.0, float(rest_root_height(asf)), 0.0]
    # leaf markers at the ends of the toes, hands and head so a rig map can aim at them
    for leaf in ("ltoes", "rtoes", "head", "lhand", "rhand"):
        if leaf in asf.bones:
            b = asf.bones[leaf]
            nodes.append({"name": leaf + "_end", "translation": [float(x) for x in b["dir"] * b["length"] * asf.scale]})
            nodes[index[leaf]].setdefault("children", []).append(len(nodes) - 1)
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
        samplers.append({"input": tin, "output": add(np.array([p[0] for p in poses]), "VEC3"), "interpolation": "LINEAR"})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": 0, "path": "translation"}})
        anims.append({"name": cname, "samplers": samplers, "channels": channels})
    gj = {"asset": {"version": "2.0", "generator": "cosquest cmu2glb.py (CMU Graphics Lab Motion Capture Database)"},
          "scene": 0, "scenes": [{"nodes": [0]}], "nodes": nodes, "animations": anims,
          "accessors": accs, "bufferViews": views, "buffers": [{"byteLength": len(blob)}]}
    write_glb(out, gj, bytes(blob))


def rest_root_height(asf):
    """Height of the pelvis over the toes in the rest pose (metres)."""
    P, _ = joints(asf, np.zeros(3), {n: np.eye(3) for n in asf.order})
    return -min(P["ltoes"][1], P["rtoes"][1])


def look(asf, frames, a):
    src_fps = a.src_fps
    step = max(1, int(round(src_fps / OUT_FPS)))
    f0 = a.f0
    f1 = a.f1 if a.f1 > 0 else len(frames) - 1
    idx = list(range(f0, f1 + 1, step))
    rows = []
    for i in idx:
        pos, loc = frame_pose(asf, frames[i])
        P, R = joints(asf, pos, loc)
        rows.append((i, pos, heading(loc["root"]), P))
    print("take frames=%d (%.1f s at %g fps), pelvis rest height %.2f m" % (len(frames), len(frames) / src_fps, src_fps, rest_root_height(asf)))
    floor = min(min(r[3]["ltoes"][1], r[3]["rtoes"][1]) for r in rows)
    print("fr     t    x     z   hipY  yaw  Lft Rft  rhand_v lhand_v  root_v  rh_fwd")
    prev = None
    for k, (i, pos, yaw, P) in enumerate(rows):
        if prev is not None:
            dt = step / src_fps
            rv = np.linalg.norm(P["rhand"] - pos - (prev[3]["rhand"] - prev[1])) / dt
            lv = np.linalg.norm(P["lhand"] - pos - (prev[3]["lhand"] - prev[1])) / dt
            bv = np.linalg.norm((pos - prev[1])[[0, 2]]) / dt
            fwd = np.array([math.sin(yaw), 0, math.cos(yaw)])
            reach = float((P["rhand"] - pos) @ fwd)
            if k % a.every == 0:
                print("%5d %5.2f %5.2f %5.2f %5.2f %4.0f  %s   %s   %6.2f %6.2f  %5.2f  %5.2f" % (
                    i, (i - f0) / src_fps, pos[0] * 1.0, pos[2], pos[1], math.degrees(yaw),
                    "#" if P["ltoes"][1] - floor < 0.04 else ".", "#" if P["rtoes"][1] - floor < 0.04 else ".", rv, lv, bv, reach))
        prev = (i, pos, yaw, P)
    if a.sheet:
        from PIL import Image, ImageDraw
        n = a.cols * a.rows
        pick = [rows[int(k * (len(rows) - 1) / max(1, n - 1))] for k in range(n)]
        cw, chh = 150, 210
        img = Image.new("RGB", (a.cols * cw, a.rows * chh), "white")
        dr = ImageDraw.Draw(img)
        for k, (i, pos, yaw, P) in enumerate(pick):
            ox = (k % a.cols) * cw + cw // 2
            oy = (k // a.cols) * chh + chh - 12
            sc = 92.0
            # a three-quarter view that turns with the body (--view degrees off its front)
            T = ry(-yaw + math.radians(a.view))
            dr.line([ox - cw // 2 + 4, oy - floor * sc, ox + cw // 2 - 4, oy - floor * sc], fill=(170, 170, 170))
            for name in asf.order[1:]:
                p = asf.parent[name]
                pa = T @ (P[p] - pos)
                pb = T @ (P[name] - pos)
                col = (210, 40, 40) if name.startswith("r") else ((40, 80, 210) if name.startswith("l") else (20, 20, 20))
                dr.line([ox - pa[0] * sc, oy - (pa[1] + pos[1]) * sc, ox - pb[0] * sc, oy - (pb[1] + pos[1]) * sc], fill=col, width=2)
            dr.text((ox - cw // 2 + 3, oy - chh + 14), str(i), fill=(0, 0, 0))
        img.save(a.sheet)
        print("sheet", a.sheet)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cmu", required=True)
    ap.add_argument("--clips", default="")
    ap.add_argument("--out", default="")
    ap.add_argument("--look", default="")
    ap.add_argument("--sheet", default="")
    ap.add_argument("--f0", type=int, default=0)
    ap.add_argument("--f1", type=int, default=0)
    ap.add_argument("--every", type=int, default=2)
    ap.add_argument("--cols", type=int, default=12)
    ap.add_argument("--rows", type=int, default=3)
    ap.add_argument("--view", type=float, default=35.0)
    ap.add_argument("--src_fps", type=float, default=120.0)
    a = ap.parse_args()
    if a.look:
        asf, frames = take(a.cmu, a.look)
        look(asf, frames, a)
        return
    cfg = json.load(open(a.clips))
    # one skeleton for the library: the first take's subject; other subjects' rotations are
    # played on it (the retarget only reads rotations and the pelvis path, scaled by its height)
    base = None
    clips = []
    cache = {}
    for cname, spec in cfg["clips"].items():
        if spec["file"] not in cache:
            cache[spec["file"]] = take(a.cmu, spec["file"])
        asf, frames = cache[spec["file"]]
        if base is None:
            base = asf
        poses = build_clip(asf, frames, spec)
        k = rest_root_height(base) / rest_root_height(asf)
        poses = [(p * k, {n: loc.get(n, np.eye(3)) for n in base.order}) for p, loc in poses]
        clips.append((cname, poses))
        print("CLIP %-26s %s frames %d..%d -> %d frames (%.2f s)" % (cname, spec["file"], spec.get("f0", 0), spec.get("f1", len(frames) - 1), len(poses), len(poses) / OUT_FPS))
    write(base, clips, a.out)
    print("WROTE", a.out, os.path.getsize(a.out))


if __name__ == "__main__":
    main()
