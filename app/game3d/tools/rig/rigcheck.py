"""Shared measuring code for the rig tools (cq 014). It reuses cq 012's retarget and tear gate
unchanged (tools/anim/retarget.py: Retarget, Body, clip_frames), so a rig measured here gives
exactly the numbers build_all.py's gate gives.

  rc = RigCheck(target_glb, key, src_kaykit, src_ual)
  share, per_tri, worst_frame, G = rc.tear(clip)       # one clip, the gate's measure
  rc.where(per_tri)                                    # which bones / body regions stretch
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ANIM = os.path.join(HERE, "..", "anim")
sys.path.insert(0, ANIM)
from gltf import Glb  # noqa: E402
import retarget as RT  # noqa: E402

STRETCH = 2.5   # cq 060's measure: a triangle tears when an edge is stretched past 2.5x


class RigCheck:
    def __init__(self, target, key, src, src_ual="", every=3):
        self.cfg = json.load(open(os.path.join(ANIM, "clips.json")))
        rigs = json.load(open(os.path.join(ANIM, "rigs.json")))
        self.key = key
        self.every = every
        self.tgt = Glb(target)
        self.damp = {}
        for spec in self.cfg.get("damp", {}).get(key, []):
            for b in spec["bones"]:
                self.damp[b] = spec["f"]
        self.rts = {"kaykit": RT.Retarget(Glb(src), self.tgt, rigs["kaykit_to_mixamo"], self.damp)}
        self.anims = {"kaykit": self.rts["kaykit"].src.animations()}
        if src_ual:
            self.rts["ual"] = RT.Retarget(Glb(src_ual), self.tgt, rigs["ual_to_mixamo"], self.damp)
            self.anims["ual"] = self.rts["ual"].src.animations()
        self.body = RT.Body(self.tgt, self.rts["kaykit"])

    def frames(self, clip):
        cc = self.cfg["clips"][clip]
        lib = cc.get("lib", "kaykit")
        rt = self.rts[lib]
        out = RT.clip_frames(rt, self.cfg, cc, self.damp, self.anims[lib], {}, lib)
        return out[1], out[7]

    def checked(self, n):
        ks = list(range(0, n, max(1, self.every)))
        if (n - 1) not in ks:
            ks.append(n - 1)
        return ks

    def per_tri(self, G):
        b = self.body
        ln = b._edge_len(b.skin(G))
        s = np.where(b.ok, ln / np.maximum(b.rest_len, 1e-9), 1.0)
        return np.max(s.reshape(3, len(b.tris)), axis=0)

    def tear(self, clip, sim=None):
        """The gate's number for one clip (the worst checked frame), that frame's per-triangle
        stretch, its index and its globals. sim(Gs) -> Gs lets the secondary bones move."""
        n, Gs = self.frames(clip)
        if sim is not None:
            Gs = sim(Gs)
        best = (-1.0, None, 0, None)
        for k in self.checked(n):
            pt = self.per_tri(Gs[k])
            sh = float(np.mean(pt > STRETCH))
            if sh > best[0]:
                best = (sh, pt, k, Gs[k])
        return best

    def where(self, pt, top=8):
        """Dominant bone of each torn triangle, counted."""
        b = self.body
        bad = pt > STRETCH
        if not bad.any():
            return {}
        v0 = b.tris[bad, 0]
        dom = b.jnt[v0, np.argmax(b.wts[v0], 1)]
        names, cnt = np.unique(dom, return_counts=True)
        order = np.argsort(-cnt)[:top]
        return {self.rts["kaykit"].jnames[names[i]]: int(cnt[i]) for i in order}


# ------------------------------------------------------------------ secondary motion (numpy twin of secondary_motion.gd)

import re  # noqa: E402

from gltf import mat_to_q, q_from_to, q_to_mat, qmul, qnorm, qslerp, qinv  # noqa: E402

CHAIN_RE = re.compile(r"^(Robe|Coat|Skirt|Wing|Flame)(.*)_(\d+|end)$")
SEC_JSON = os.path.join(HERE, "..", "..", "data", "secondary.json")


def find_chains(names):
    """{base: [node indices in order, end last]} from bone names like Robe3_0 .. Robe3_2, Robe3_end."""
    out = {}
    for i, n in enumerate(names):
        m = CHAIN_RE.match(n)
        if m:
            out.setdefault(m.group(1) + m.group(2), {})[m.group(3)] = i
    chains = {}
    for base, d in out.items():
        ks = sorted(int(k) for k in d if k != "end")
        if not ks or "end" not in d:
            continue
        chains[base] = [d[str(k)] for k in ks] + [d["end"]]
    return chains


def seg_closest(p, a, b):
    ab = b - a
    t = min(1.0, max(0.0, float((p - a) @ ab) / max(1e-12, float(ab @ ab))))
    return a + t * ab


class Secondary:
    """Drives the chain bones over a clip's frames with the game's secondary sim: a spring
    toward a target (the chain hanging from its parent, swung by the thighs for robes and
    coats), length constraints, leg capsules and an angle limit. Fixed 1/60 s steps."""

    def __init__(self, glb, rest_G, cfg=None):
        self.g = glb
        self.cfg = cfg or json.load(open(SEC_JSON))
        self.chains = find_chains(glb.names)
        n = glb.names
        self.ih = n.index("Hips")
        self.legs = [(n.index(a), n.index(b), r) for a, b, r in (
            ("LeftUpLeg", "LeftLeg", "r_thigh"), ("LeftLeg", "LeftFoot", "r_shin"),
            ("RightUpLeg", "RightLeg", "r_thigh"), ("RightLeg", "RightFoot", "r_shin"))]
        self.il, self.ir = n.index("LeftUpLeg"), n.index("RightUpLeg")
        self.rest = rest_G
        hips = rest_G[self.ih][:3, 3]
        self.spec = {}
        legs_r = dict(self.cfg["legs"])
        legs_r.update(self.cfg.get("characters", {}).get("_any", {}))
        self.legs_r = legs_r
        for base, idx in self.chains.items():
            grp = self.cfg["groups"][self.cfg["prefixes"][CHAIN_RE.match(n[idx[0]]).group(1)]]
            tip = rest_G[idx[-1]][:3, 3]
            # which side the chain hangs on: +1 the character's left (+x), -1 the right
            lat = float(np.clip((tip[0] - hips[0]) / 0.12, -1, 1))
            f = grp["follow"]
            wl = f * float(np.clip(0.5 + 0.5 * lat, 0, 1))
            wr = f * float(np.clip(0.5 - 0.5 * lat, 0, 1))
            L = [float(np.linalg.norm(rest_G[idx[k + 1]][:3, 3] - rest_G[idx[k]][:3, 3])) for k in range(len(idx) - 1)]
            self.spec[base] = {"idx": idx, "grp": grp, "wl": wl, "wr": wr, "len": L}

    def delta(self, G, i):
        return mat_to_q(G[i][:3, :3] @ self.rest[i][:3, :3].T)

    def run(self, Gs, fps=30.0, preroll=20):
        step = self.cfg["step_s"]
        sub = max(1, int(round(1.0 / fps / step)))
        out = [[x.copy() for x in G] for G in Gs]
        state = {}
        seq = [0] * preroll + list(range(len(Gs)))
        for si, k in enumerate(seq):
            G = Gs[k]
            dh = self.delta(G, self.ih)
            dl = qmul(self.delta(G, self.il), qinv(dh))
            dr = qmul(self.delta(G, self.ir), qinv(dh))
            caps = [(G[a][:3, 3], G[b][:3, 3], self.legs_r[r]) for a, b, r in self.legs]
            for base, s in self.spec.items():
                idx, grp = s["idx"], s["grp"]
                T = np.array([G[i][:3, 3] for i in idx])
                qf = qmul(qslerp(np.array([0, 0, 0, 1.0]), dl, s["wl"]), qslerp(np.array([0, 0, 0, 1.0]), dr, s["wr"]))
                Rf = q_to_mat(qf)
                T = T[0] + (T - T[0]) @ Rf.T
                if base not in state:
                    state[base] = [T.copy(), T.copy()]
                p, pp = state[base]
                for _ in range(sub):
                    p, pp = self.step(p, pp, T, s, caps), p
                state[base] = [p, pp]
                if si >= preroll:
                    Go = out[k]
                    for j in range(len(idx) - 1):
                        R = Rf @ G[idx[j]][:3, :3]
                        q = q_from_to(T[j + 1] - T[j], p[j + 1] - p[j])
                        M = np.eye(4)
                        M[:3, :3] = q_to_mat(q) @ R
                        M[:3, 3] = p[j]
                        Go[idx[j]] = M
                    M = Go[idx[-2]].copy()
                    M[:3, 3] = p[-1]
                    Go[idx[-1]] = M
        return out

    def step(self, p, pp, T, s, caps):
        grp = s["grp"]
        L = s["len"]
        n = len(p)
        q = p.copy()
        q[0] = T[0]
        v = (p[1:] - pp[1:]) * (1.0 - grp["damping"])
        q[1:] = p[1:] + v + (T[1:] - p[1:]) * grp["stiffness"]
        cosmax = np.cos(np.radians(grp["max_deg"]))
        jr = grp["joint_r"]
        for j in range(1, n):
            if grp["legs"]:
                for a, b, r in caps:
                    c = seg_closest(q[j], a, b)
                    d = q[j] - c
                    dn = float(np.linalg.norm(d))
                    if dn < r + jr and dn > 1e-9:
                        q[j] = c + d / dn * (r + jr)
            d = q[j] - q[j - 1]
            dn = max(1e-9, float(np.linalg.norm(d)))
            u = d / dn
            t = T[j] - T[j - 1]
            t = t / max(1e-9, float(np.linalg.norm(t)))
            c = float(u @ t)
            if c < cosmax:
                # turn back toward the target direction, to the limit
                w = u - t * c
                w = w / max(1e-9, float(np.linalg.norm(w)))
                u = t * cosmax + w * np.sqrt(1 - cosmax * cosmax)
            q[j] = q[j - 1] + u * L[j - 1]
        return q
