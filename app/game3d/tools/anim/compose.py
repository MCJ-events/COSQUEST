"""Composed clips (anim-readable, 13 Nov 2026): a readable body action built from the retargeted
clips of one character, in that character's own skeleton, so it works on every rig the retarget
works on (the cartoon cast, the faction heroes, Forge auto-rigs).

A clip in clips.json with a "compose" entry is not read from a source library. retarget.py first
retargets its ingredients (other entries of clips.json, from any library: KayKit, Quaternius UAL,
CMU, Mesh2Motion) onto the target, then:

  base    segments of ingredient clips laid end to end on the output's frames (30 fps), each
          {"clip", "from", "to", "at", "speed", "fade"}: frames from..to of the ingredient start at
          output frame `at`, played at `speed`, cross-faded over `fade` frames from what was before
  layers  bone groups taken from another ingredient, {"clip", "bones", "from", "at", "speed",
          "w": [[frame, weight], ...]} (bones: upper, lower, spine, arm_r, arm_l, arms, legs, head,
          or a list of bone names)
  ops     changes in the character's own space (+Y up, +Z forward, +X its left), so they mean the
          same on every rig:
          {"op": "rot", "bone", "axis": [x, y, z], "deg": [[frame, degrees], ...]}  turns a bone
              (and so everything below it) about a model-space axis through the bone
          {"op": "aim", "side": "l"|"r", "yaw": deg, "elev": [[frame, deg]], "reach": 0.96,
              "w": [[frame, weight]]}  two-bone arm IK: the hand goes out along the direction
              (yaw from forward, elevation above level) from the shoulder, at `reach` of the arm
          {"op": "hips", "dy": [[frame, m]], "dz": [[frame, m]]}  moves the hips (and the body)
          {"op": "hand", "side", "deg": [[frame, d]], "axis": [x, y, z]}  turns the hand alone
  Curves are [[frame, value], ...], eased (smoothstep) between keys and held outside them.

The result goes through the same checks as any clip (tear on LOD0 to LOD2, feet, weapon), and its
contact frame is given in the entry ("contact"), designed to land on the game's hit moment.

clip_gates() measures the motion gates per clip: weapon (or striking hand) direction at the
contact against forward (no backward attacks), frames in a T-pose, and planted-foot slide per step.
"""
import math

import numpy as np

from gltf import qinv, qmul, qnorm, qrot, qslerp, mat_to_q

ID = np.array([0, 0, 0, 1.0])

SPINE = ["Spine", "Spine1", "Spine2"]
HEAD = ["Neck", "Head", "HeadTop_End"]
ARM_R = ["RightShoulder", "RightArm", "RightForeArm", "RightHand"]
ARM_L = ["LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand"]
LEGS = ["LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "LeftToe_End", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase", "RightToe_End"]
MASKS = {
    "upper": SPINE + HEAD + ARM_R + ARM_L,
    "lower": ["Hips"] + LEGS,
    "legs": LEGS,
    "spine": SPINE,
    "head": HEAD,
    "arm_r": ARM_R,
    "arm_l": ARM_L,
    "arms": ARM_R + ARM_L,
    "upper_no_arm_r": SPINE + HEAD + ARM_L,
    "upper_no_arm_l": SPINE + HEAD + ARM_R,
}


def curve(keys, f, default=0.0):
    """[[frame, value], ...] at frame f: held before the first and after the last key, eased between."""
    if keys is None:
        return default
    if isinstance(keys, (int, float)):
        return float(keys)
    if not keys:
        return default
    if f <= keys[0][0]:
        return float(keys[0][1])
    for (f0, v0), (f1, v1) in zip(keys[:-1], keys[1:]):
        if f <= f1:
            u = (f - f0) / max(1e-6, f1 - f0)
            u = u * u * (3 - 2 * u)
            return float(v0) + (float(v1) - float(v0)) * u
    return float(keys[-1][1])


def _sample(frames, u):
    """The locals of an ingredient at fractional frame u (rotations slerped, translations lerped)."""
    n = len(frames)
    u = min(max(u, 0.0), n - 1.0)
    i = int(math.floor(u))
    j = min(n - 1, i + 1)
    w = u - i
    if w < 1e-6:
        return [[np.array(x[0], float), np.array(x[1], float), np.array(x[2], float)] for x in frames[i]]
    out = []
    for a, b in zip(frames[i], frames[j]):
        out.append([np.array(a[0], float) * (1 - w) + np.array(b[0], float) * w, qslerp(np.array(a[1], float), np.array(b[1], float), w), np.array(a[2], float)])
    return out


def _blend(a, b, w, idx=None):
    """b over a with weight w, for all nodes or the node indices in idx."""
    out = [[x[0].copy(), x[1].copy(), x[2].copy()] for x in a]
    for k in (range(len(a)) if idx is None else idx):
        out[k][0] = a[k][0] * (1 - w) + b[k][0] * w
        out[k][1] = qslerp(a[k][1], b[k][1], w)
    return out


def _gpos(G, i):
    return G[i][:3, 3].copy()


def _grot(G, i):
    return mat_to_q(G[i][:3, :3])


def _set_world_rot(rt, loc, G, i, q_world):
    p = rt.tgt.parent[i]
    pr = ID if p < 0 else _grot(G, p)
    loc[i][1] = qnorm(qmul(qinv(pr), q_world))


def _axis_angle(axis, deg):
    a = np.array(axis, float)
    a = a / max(1e-9, np.linalg.norm(a))
    h = math.radians(deg) * 0.5
    return np.array([a[0] * math.sin(h), a[1] * math.sin(h), a[2] * math.sin(h), math.cos(h)])


def _arm_ik(rt, loc, G, side, P, w):
    """Two-bone IK of one arm so its hand reaches P (model space), blended by w; the elbow stays in
    the plane it was in, the hand keeps its place on the forearm."""
    tn = rt.tgt.names
    s = "Left" if side == "l" else "Right"
    ia, ie, ih = tn.index(s + "Arm"), tn.index(s + "ForeArm"), tn.index(s + "Hand")
    S, E, H = _gpos(G, ia), _gpos(G, ie), _gpos(G, ih)
    a = np.linalg.norm(E - S)
    b = np.linalg.norm(H - E)
    d = P - S
    c = float(np.clip(np.linalg.norm(d), abs(a - b) + 1e-3, a + b - 1e-3))
    u = d / max(1e-9, np.linalg.norm(d))
    Pc = S + u * c
    pole = (E - S) - u * float((E - S) @ u)
    if np.linalg.norm(pole) < 1e-6:
        pole = np.array([0, -1.0, 0]) - u * (-u[1])
    nrm = pole / np.linalg.norm(pole)
    ca = (a * a + c * c - b * b) / (2 * a * c)
    E2 = S + u * ca * a + nrm * np.sqrt(max(0.0, 1 - ca * ca)) * a
    from gltf import q_from_to
    R1 = qslerp(ID, q_from_to(E - S, E2 - S), w)
    E2w = S + qrot(R1, E - S)
    R2 = qslerp(ID, q_from_to(qrot(R1, H - E), Pc - E2w), w)
    world = {ia: qmul(R1, _grot(G, ia)), ie: qmul(R2, qmul(R1, _grot(G, ie))), ih: qmul(R2, qmul(R1, _grot(G, ih)))}
    for i in (ia, ie, ih):
        p = rt.tgt.parent[i]
        pr = world.get(p, _grot(G, p))
        loc[i][1] = qnorm(qmul(qinv(pr), world[i]))
    return loc, rt.tp.globals_of(loc)


def _dir(yaw_deg, elev_deg):
    y = math.radians(yaw_deg)
    e = math.radians(elev_deg)
    return np.array([math.sin(y) * math.cos(e), math.sin(e), math.cos(y) * math.cos(e)])


def compose_frames(cname, cfg, rts, anims, damp, grips, cache, clip_frames):
    """The target frames of a composed clip. Returns the same tuple as retarget.clip_frames."""
    spec = cfg["clips"][cname]["compose"]
    rt = rts["kaykit"]
    tn = rt.tgt.names

    def ingredient(name):
        if name not in cache:
            cc = cfg["clips"][name]
            lib = cc.get("lib", "kaykit")
            if "compose" in cc:
                cache[name] = compose_frames(name, cfg, rts, anims, damp, grips, cache, clip_frames)[6]
            else:
                cache[name] = clip_frames(rts[lib], cfg, cc, damp, anims[lib], grips, lib)[6]
        return cache[name]

    def idx_of(bones):
        names = MASKS.get(bones, bones) if isinstance(bones, str) else bones
        return [tn.index(b) for b in names if b in tn]

    nfr = int(spec["frames"])
    segs = []
    for s in spec["base"]:
        fr = ingredient(s["clip"])
        f0 = float(s.get("from", 0))
        f1 = float(s.get("to", len(fr) - 1))
        sp = float(s.get("speed", 1.0))
        segs.append({"fr": fr, "from": f0, "to": f1, "at": float(s.get("at", 0)), "speed": sp, "fade": float(s.get("fade", 0))})
    layers = []
    for L in spec.get("layers", []):
        layers.append({"fr": ingredient(L["clip"]), "idx": idx_of(L.get("bones", "upper")), "from": float(L.get("from", 0)),
                       "to": float(L.get("to", 1e9)), "at": float(L.get("at", 0)), "speed": float(L.get("speed", 1.0)), "w": L.get("w", 1.0)})
    i_hips = rt.t_hips
    hk = max(0.3, float(_gpos(rt.t_rest_G, i_hips)[1])) / 0.95   # offsets are for a 0.95 m hip height
    frames = []
    Gs = []
    for f in range(nfr):
        # the base: the last segment that has started, faded in over its `fade` from the one before
        k = 0
        for j, s in enumerate(segs):
            if f >= s["at"]:
                k = j
        s = segs[k]
        cur = _sample(s["fr"], min(s["to"], s["from"] + (f - s["at"]) * s["speed"]))
        if k > 0 and s["fade"] > 0 and f < s["at"] + s["fade"]:
            p = segs[k - 1]
            prev = _sample(p["fr"], min(p["to"], p["from"] + (f - p["at"]) * p["speed"]))
            u = (f - s["at"]) / s["fade"]
            cur = _blend(prev, cur, u * u * (3 - 2 * u))
        for L in layers:
            w = curve(L["w"], f, 1.0)
            if w <= 1e-4:
                continue
            lay = _sample(L["fr"], min(L["to"], L["from"] + max(0.0, f - L["at"]) * L["speed"]))
            cur = _blend(cur, lay, w, L["idx"])
        loc = [[x[0], x[1], x[2]] for x in cur]
        G = rt.tp.globals_of(loc)
        for op in spec.get("ops", []):
            kind = op["op"]
            if kind == "rot":
                deg = curve(op["deg"], f)
                if abs(deg) < 1e-3:
                    continue
                i = tn.index(op["bone"])
                _set_world_rot(rt, loc, G, i, qmul(_axis_angle(op.get("axis", [1, 0, 0]), deg), _grot(G, i)))
                G = rt.tp.globals_of(loc)
            elif kind == "hand":
                deg = curve(op["deg"], f)
                if abs(deg) < 1e-3:
                    continue
                i = tn.index(("Left" if op["side"] == "l" else "Right") + "Hand")
                _set_world_rot(rt, loc, G, i, qmul(_axis_angle(op.get("axis", [1, 0, 0]), deg), _grot(G, i)))
                G = rt.tp.globals_of(loc)
            elif kind == "aim":
                w = curve(op.get("w", 1.0), f, 1.0)
                if w <= 1e-4:
                    continue
                s_ = "Left" if op["side"] == "l" else "Right"
                ia, ie, ih = tn.index(s_ + "Arm"), tn.index(s_ + "ForeArm"), tn.index(s_ + "Hand")
                arm = np.linalg.norm(_gpos(rt.t_rest_G, ie) - _gpos(rt.t_rest_G, ia)) + np.linalg.norm(_gpos(rt.t_rest_G, ih) - _gpos(rt.t_rest_G, ie))
                d = _dir(curve(op.get("yaw", 0.0), f), curve(op.get("elev", 0.0), f))
                P = _gpos(G, ia) + d * arm * float(op.get("reach", 0.96))
                loc, G = _arm_ik(rt, loc, G, op["side"], P, w)
            elif kind == "hips":
                dy = curve(op.get("dy"), f)
                dz = curve(op.get("dz"), f)
                dx = curve(op.get("dx"), f)
                if abs(dy) + abs(dz) + abs(dx) < 1e-6:
                    continue
                wpos = _gpos(G, i_hips) + np.array([dx, dy, dz]) * hk
                p = rt.tgt.parent[i_hips]
                inv = np.linalg.inv(G[p]) if p >= 0 else np.eye(4)
                loc[i_hips][0] = (inv @ np.append(wpos, 1.0))[:3]
                G = rt.tp.globals_of(loc)
        frames.append(loc)
        Gs.append(G)
    n = nfr
    times = np.arange(n) / 30.0
    length = (n - 1) / 30.0
    off = np.zeros((n, 3))
    return times, n, length, "composed", off, np.zeros(3), frames, Gs, []


# ------------------------------------------------------------------ per-clip motion gates

def clip_gates(rt, Gs, grips, cc, contact, floor_rest, fps=30.0):
    """Motion gates of one clip on one rig: the striking direction at the contact against forward
    (+Z: the game faces the fighter at its target), T-pose frames, and planted-foot slide per step."""
    tn = rt.tgt.names
    out = {}
    n = len(Gs)
    # facing: where the weapon tip (or the striking hand) is, seen from the chest, at the contact
    if contact is not None and 0 <= contact < n and cc.get("gate_facing", cc.get("strike", False) or bool(cc.get("compose"))):
        G = Gs[int(contact)]
        chest = _gpos(G, tn.index("Spine2"))
        hips_q = qmul(_grot(G, rt.t_hips), qinv(_grot(rt.t_rest_G, rt.t_hips)))
        side = cc.get("gate_hand", "r")
        hand = tn.index(("Left" if side == "l" else "Right") + "Hand")
        cls = cc.get("contact_class", "sword")
        if side == "r" and cls in grips:
            gm = np.array(grips[cls]["matrix"], float).reshape(4, 4).T
            tip = (G[hand] @ gm @ np.array([0, 0.9, 0, 1.0]))[:3]
        else:
            tip = _gpos(G, hand)
        v = tip - chest
        out["contact_yaw_deg"] = round(math.degrees(math.atan2(v[0], v[2])), 1)
        out["contact_elev_deg"] = round(math.degrees(math.atan2(v[1], max(1e-6, math.hypot(v[0], v[2])))), 1)
        f = qrot(hips_q, [0, 0, 1.0])
        out["hips_yaw_deg"] = round(math.degrees(math.atan2(f[0], f[2])), 1)
        out["backward"] = abs(out["contact_yaw_deg"]) > 90.0 and out["contact_elev_deg"] < 60.0
    # T-pose: both arms straight, level and out to the sides
    tp = 0
    for G in Gs:
        ok = 0
        for s, sx in (("Left", 1.0), ("Right", -1.0)):
            a, e, h = (_gpos(G, tn.index(s + b)) for b in ("Arm", "ForeArm", "Hand"))
            u = (e - a) / max(1e-9, np.linalg.norm(e - a))
            l = (h - e) / max(1e-9, np.linalg.norm(h - e))
            if float(u @ l) > math.cos(math.radians(15)) and abs(u[1]) < 0.25 and u[0] * sx > 0.85:
                ok += 1
        tp += ok == 2
    out["tpose_frames"] = int(tp)
    # planted feet: a foot within 3 cm of the floor is planted; a step is a run of planted frames;
    # its slide is how far the foot gets from where it touched (cm), the worst step counts
    worst = 0.0
    steps = 0
    over2 = 0
    for nm in ("LeftToeBase", "RightToeBase", "LeftFoot", "RightFoot"):
        if nm not in tn:
            continue
        i = tn.index(nm)
        p = np.array([_gpos(G, i) for G in Gs])
        low = p[:, 1] - p[:, 1].min() < 0.03
        k = 0
        while k < n:
            if low[k]:
                j = k
                while j + 1 < n and low[j + 1]:
                    j += 1
                if j > k:
                    d = float(np.max(np.linalg.norm((p[k:j + 1] - p[k])[:, [0, 2]], axis=1))) * 100.0
                    worst = max(worst, d)
                    steps += 1
                    over2 += d > 2.0
                k = j + 1
            else:
                k += 1
    out["foot_steps"] = steps
    out["foot_slide_worst_cm"] = round(worst, 1)
    out["foot_steps_over_2cm"] = int(over2)
    return out
