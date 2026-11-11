#!/usr/bin/env python3
"""Motion bar report (realism-20261111, BAR.md section C) from tools/anim_probe.gd (v2) logs.

  python3 motion_report.py run1.probe.jsonl [run2.probe.jsonl ...] \
      [--keys hero=armstrong,ally=bobo,enemy=hoof] [--reports tools/anim/reports] \
      [--json out.json] [--md out.md] [--label build-21]

Pure Python 3 (no numpy). Every number is per fighter and per state group, then rolled up.
What is measured, and how (all on the FINAL drawn pose, 30 frames a second):

  feet      A foot is "planted" on a frame when its ankle or its toe joint is within PLANT_H of that
            joint's own floor height (its 5th centile over the fight). A step is one run of planted
            frames (at least 3; a longer stand is cut every 30 frames). The slide of a step is the
            farthest the contact point gets from where it first touched, in cm (horizontal). The
            contact point is whichever of ankle and toe is lower on that frame, so a heel-to-toe
            roll is not counted as sliding.
  mismatch  On locomotion frames with a planted foot: the planted foot's speed over the ground
            divided by the body's speed (0 = the foot holds the ground, 1 = the foot is carried
            along with the body, a pure glide).
  facing    For every directed attack (the combo, the heavy, CHARGE, SPLIT): the arc the weapon tip
            sweeps round the body from 4 frames before the contact to 6 after, while it is extended
            (hips to tip; shoulder to right hand when there is no weapon). The swing is off by the
            angle between that arc and the direction to where the target stood when the swing
            began (0 when the arc passes through it). The drawn body's forward is compared with
            the same direction. Off = more than 45 degrees.
  flashes   bind pose: every limb bone (upper and lower arms and legs) within BIND_DEG of its rest
            rotation. T-pose: both arms straight, level and out to the sides.
  weight    For every landed blow: anticipation = drawn frames from the swing's start to the
            contact, follow-through = drawn frames from the contact to the end of the swing (hit-stop
            frames are counted: the viewer sees them). The victim: how far the hips move relative to
            the fighter's own origin in the 12 frames after the blow, against the head.
  tear      Per state: the clip that played, its torn-triangle share per LOD from the retarget
            reports (tools/anim/reports/<key>.json; the 0.5 % gate, 1 % for run and sprint).
"""
import argparse
import json
import math
import os
import sys
from collections import defaultdict

FPS = 30.0
PLANT_H = 0.03          # m at size 1
STEP_MAX = 30           # frames: a longer stance is measured in pieces
BIND_DEG = 6.0
OFF_DEG = 45.0
SLIDE_PASS_CM = 2.0
SLIDE_WORST_CM = 5.0
ANTIC_MIN = 3
FOLLOW_MIN = 3
HIPS_MIN_CM = 3.0
GROUPS = {"idle": "idle", "_": "idle", "walk": "walk", "run": "jog", "sprint": "jog", "hit": "hit", "stagger": "stagger",
          "guard": "guard", "death": "ko", "victory": "victory", "dodge": "dodge"}
ATTACK = ["attack_1", "attack_2", "attack_3", "heavy", "parry", "skill_charge", "skill_split", "skill_whirl",
          "skill_rally", "skill_shield"]
DIRECTED = ["attack_1", "attack_2", "attack_3", "heavy", "skill_charge", "skill_split"]
GATE_GROUPS = ["idle", "walk", "jog", "attack"]


def group(st):
    if st in ATTACK:
        return "attack"
    return GROUPS.get(st, st)


def sub(a, b):
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]


def hlen(v):
    return math.hypot(v[0], v[2])


def vlen(v):
    return math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])


def ang_h(a, b):
    """Angle in degrees between two horizontal directions [x, z]."""
    la = math.hypot(a[0], a[1])
    lb = math.hypot(b[0], b[1])
    if la < 1e-6 or lb < 1e-6:
        return None
    c = max(-1.0, min(1.0, (a[0] * b[0] + a[1] * b[1]) / (la * lb)))
    return math.degrees(math.acos(c))


def ang3(a, b):
    la = vlen(a)
    lb = vlen(b)
    if la < 1e-6 or lb < 1e-6:
        return 0.0
    c = max(-1.0, min(1.0, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb)))
    return math.degrees(math.acos(c))


def pct(xs, p):
    if not xs:
        return 0.0
    s = sorted(xs)
    return s[min(len(s) - 1, int(p * (len(s) - 1) + 0.5))]


def load(path):
    rows = defaultdict(list)
    hits = []
    for line in open(path):
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if r.get("ev") == "hit":
            hits.append(r)
        elif "role" in r:
            rows[r["role"]].append(r)
    return rows, hits


def live(r):
    return r.get("vis") and "Hips" in r and r.get("fs") in ("fighting", "ending")


def feet(rs):
    """Steps of one fighter: [{foot, group, frames, slide_cm, fr}] and the mismatch samples."""
    steps = []
    mism = defaultdict(list)
    glide = defaultdict(int)
    frames_by_group = defaultdict(int)
    rs = [r for r in rs if live(r) and not r["dead"]]
    if len(rs) < 10:
        return steps, mism, glide, frames_by_group
    size = rs[0].get("size", 1.0)
    thr = PLANT_H * size
    for i in range(1, len(rs)):
        if rs[i]["fr"] == rs[i - 1]["fr"] + 1:
            g = group(rs[i]["st"])
            frames_by_group[g] += 1
            v = hlen(sub(rs[i]["pos"], rs[i - 1]["pos"])) * FPS
            if g == "idle" and v > 0.3:
                glide[g] += 1
    for side in ("Left", "Right"):
        ak = side + "Foot"
        tk = side + "ToeBase"
        a_base = pct([r[ak][1] - r["pos"][1] for r in rs], 0.05)
        t_base = pct([r[tk][1] - r["pos"][1] for r in rs], 0.05)
        cur = None
        for i, r in enumerate(rs):
            ah = r[ak][1] - r["pos"][1] - a_base
            th = r[tk][1] - r["pos"][1] - t_base
            planted = min(ah, th) < thr
            cont = i > 0 and rs[i - 1]["fr"] == r["fr"] - 1
            if planted and cur is not None and cont and cur["n"] < STEP_MAX:
                # the contact point: the lower joint on this frame, followed from the last frame
                key = ak if ah <= th else tk
                d = sub(r[key], rs[i - 1][key])
                cur["acc"][0] += d[0]
                cur["acc"][2] += d[2]
                cur["slide"] = max(cur["slide"], hlen(cur["acc"]))
                cur["n"] += 1
                cur["groups"][group(r["st"])] += 1
                g = group(r["st"])
                if g in ("walk", "jog"):
                    body_v = hlen(sub(r["pos"], rs[i - 1]["pos"])) * FPS
                    if body_v > 0.5:
                        mism[g].append(hlen(d) * FPS / body_v)
            else:
                if cur is not None and cur["n"] >= 3:
                    steps.append(cur)
                cur = None
                if planted:
                    cur = {"foot": side, "fr": r["fr"], "n": 1, "acc": [0.0, 0.0, 0.0], "slide": 0.0,
                           "groups": defaultdict(int)}
                    cur["groups"][group(r["st"])] += 1
        if cur is not None and cur["n"] >= 3:
            steps.append(cur)
    out = []
    for s in steps:
        g = max(s["groups"].items(), key=lambda kv: kv[1])[0]
        out.append({"foot": s["foot"], "fr": s["fr"], "frames": s["n"], "group": g, "slide_cm": round(s["slide"] * 100.0 / size, 2)})
    return out, mism, glide, frames_by_group


def actions(rs):
    """One-shot actions of a fighter: [{st, i0, i1, hit_at, len}] (indices into rs)."""
    acts = []
    cur = None
    for i, r in enumerate(rs):
        st = r["st"]
        new = st in ATTACK and (cur is None or cur["st"] != st or r["t"] + 1e-4 < rs[i - 1]["t"])
        if cur is not None and (st != cur["st"] or new):
            cur["i1"] = i - 1
            acts.append(cur)
            cur = None
        if new:
            cur = {"st": st, "i0": i, "i1": i, "hit_at": r.get("hit_at", -1.0), "len": r.get("len", 0.0)}
    if cur is not None:
        cur["i1"] = len(rs) - 1
        acts.append(cur)
    return acts


def facing(rs, acts):
    out = []
    for a in acts:
        if a["st"] not in DIRECTED:
            continue
        r0 = rs[a["i0"]]
        if "tgt" not in r0 or not live(r0):
            continue
        # the contact frame: the action clock passes the hit time; else the fastest hand frame
        ic = None
        if a["hit_at"] > 0:
            for i in range(a["i0"], a["i1"] + 1):
                if rs[i]["t"] >= a["hit_at"]:
                    ic = i
                    break
        if ic is None:
            best = -1.0
            for i in range(a["i0"] + 1, a["i1"] + 1):
                if "RightHand" in rs[i] and "RightHand" in rs[i - 1]:
                    v = vlen(sub(rs[i]["RightHand"], rs[i - 1]["RightHand"]))
                    if v > best:
                        best = v
                        ic = i
        if ic is None or "Hips" not in rs[ic]:
            continue
        rc = rs[ic]
        aim = sub(r0["tgt"], rc["pos"])
        aim_a = math.atan2(aim[0], aim[2])
        # the arc the weapon sweeps round the contact, while it is extended (reach over 60 % of
        # the swing's longest): the swing is off by how far the aim lies outside that arc
        pts = []
        for i in range(max(a["i0"], ic - 4), min(a["i1"], ic + 6) + 1):
            if rs[i].get("frz") and i != ic:
                continue
            p = rs[i].get("tip")
            o = rs[i].get("Hips")
            if p is None:
                p = rs[i].get("RightHand")
                o = rs[i].get("RightArm")
            if p is None or o is None:
                continue
            d = sub(p, o)
            pts.append((hlen(d), math.degrees(math.atan2(d[0], d[2]) - aim_a)))
        sw = None
        arc = None
        if pts:
            rmax = max(p[0] for p in pts)
            rel = [((p[1] + 180.0) % 360.0) - 180.0 for p in pts if p[0] >= 0.6 * rmax]
            # unwrap along the sweep so an arc through the back does not split at 180
            un = [rel[0]]
            for x in rel[1:]:
                while x - un[-1] > 180.0:
                    x -= 360.0
                while x - un[-1] < -180.0:
                    x += 360.0
                un.append(x)
            lo, hi = min(un), max(un)
            arc = [round(lo, 0), round(hi, 0)]
            if hi - lo >= 360.0:
                sw = 0.0
            else:
                # distance from the aim (0, or a full turn away) to the arc
                sw = min(0.0 if lo <= k <= hi else min(abs(lo - k), abs(hi - k)) for k in (-360.0, 0.0, 360.0))
        bd = ang_h(rc.get("fwd", [0, 0]), [aim[0], aim[2]])
        # the worst the drawn body is turned away from the aim over the whole swing
        worst_body = 0.0
        for i in range(a["i0"], a["i1"] + 1):
            x = ang_h(rs[i].get("fwd", [0, 0]), [aim[0], aim[2]])
            if x is not None:
                worst_body = max(worst_body, x)
        out.append({"fr": r0["fr"], "st": a["st"], "contact_fr": rc["fr"], "dist_m": round(hlen(aim), 2),
                    "swing_off_deg": None if sw is None else round(sw, 1), "swing_arc_deg": arc, "body_off_deg": None if bd is None else round(bd, 1),
                    "body_off_start_deg": round(ang_h(r0.get("fwd", [0, 0]), [aim[0], aim[2]]) or 0.0, 1),
                    "body_off_worst_deg": round(worst_body, 1)})
    return out


def flashes(rs):
    bind = []
    tpose = []
    n = 0
    for r in rs:
        if not live(r) or "dev" not in r:
            continue
        n += 1
        if r["dev"][0] < BIND_DEG:
            bind.append([r["fr"], r["st"]])
        ok = True
        f = r.get("fwd")
        if not f:
            continue
        lat = [f[1], 0.0, -f[0]]
        for side in ("Left", "Right"):
            up = sub(r[side + "ForeArm"], r[side + "Arm"])
            lo = sub(r[side + "Hand"], r[side + "ForeArm"])
            level = abs(math.degrees(math.asin(max(-1.0, min(1.0, up[1] / max(1e-6, vlen(up)))))))
            out_a = ang3(up, lat)
            out_a = min(out_a, 180.0 - out_a)
            if level > 20.0 or out_a > 30.0 or ang3(up, lo) > 30.0:
                ok = False
        if ok and not r["dead"]:
            tpose.append([r["fr"], r["st"]])
    return n, bind, tpose


def weight(rows, hits, acts_by_role):
    out = []
    for h in hits:
        src = h["src"]
        dst = h["dst"]
        rs = rows.get(src, [])
        rd = rows.get(dst, [])
        if not rs or not rd:
            continue
        idx = {r["fr"]: i for i, r in enumerate(rs)}
        i = idx.get(h["fr"])
        e = {"fr": h["fr"], "src": src, "dst": dst, "kind": h.get("kind", ""), "ko": h.get("ko", False)}
        act = None
        if i is not None:
            for a in acts_by_role[src]:
                if a["i0"] <= i <= a["i1"]:
                    act = a
        if act is None:
            # a ranged blow (the bolt lands after the cast): the cast before it stands for the swing
            prev = [a for a in acts_by_role[src] if i is not None and a["i1"] < i and i - a["i1"] < 45]
            if prev:
                a = prev[-1]
                ic = a["i1"]
                for j in range(a["i0"], a["i1"] + 1):
                    if a["hit_at"] > 0 and rs[j]["t"] >= a["hit_at"]:
                        ic = j
                        break
                e.update({"ranged": True, "st": a["st"], "antic": ic - a["i0"], "follow": a["i1"] - ic})
            else:
                e.update({"ranged": True, "st": "", "antic": None, "follow": None})
        else:
            e.update({"ranged": False, "st": act["st"], "antic": i - act["i0"], "follow": act["i1"] - i})
        # the victim: hips and head relative to its own origin over the next 12 frames
        didx = {r["fr"]: k for k, r in enumerate(rd)}
        k = didx.get(h["fr"])
        if k is not None and k > 0 and "Hips" in rd[k - 1]:
            size = rd[k].get("size", 1.0)
            base = rd[k - 1]
            hip0 = sub(base["Hips"], base["pos"])
            head0 = sub(base["Head"], base["pos"])
            hmax = 0.0
            dmax = 0.0
            root = 0.0
            sts = set()
            for j in range(k, min(len(rd), k + 12)):
                if "Hips" not in rd[j]:
                    continue
                hmax = max(hmax, vlen(sub(sub(rd[j]["Hips"], rd[j]["pos"]), hip0)))
                dmax = max(dmax, vlen(sub(sub(rd[j]["Head"], rd[j]["pos"]), head0)))
                root = max(root, hlen(sub(rd[j]["pos"], base["pos"])))
                sts.add(rd[j]["st"])
            e.update({"hips_cm": round(hmax * 100 / size, 1), "head_cm": round(dmax * 100 / size, 1),
                      "root_cm": round(root * 100, 1), "dst_states": sorted(sts)})
        out.append(e)
    return out


def tear_table(rows, keys, reports):
    out = {}
    for role, key in keys.items():
        p = os.path.join(reports, key + ".json") if reports else ""
        if not p or not os.path.exists(p):
            continue
        rep = json.load(open(p))["clips"]
        seen = {}
        for r in rows.get(role, []):
            c = r.get("clip", "")
            if not c.startswith("cq/"):
                continue
            name = c[3:].replace("__loop", "")
            seen.setdefault(r["st"], set()).add(name)
        t = {}
        for st, names in sorted(seen.items()):
            for nm in sorted(names):
                v = rep.get(nm)
                if v is None:
                    continue
                by = dict(v.get("tear_by_lod", {}))
                worst = v["tear_share"]
                if "tear_worst_lod" not in v:
                    by["lod1"] = worst
                t.setdefault(st, []).append({"clip": nm, "worst": worst, "by_lod": by})
        out[role] = {"key": key, "states": t}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("logs", nargs="+")
    ap.add_argument("--keys", default="")
    ap.add_argument("--reports", default="")
    ap.add_argument("--json", default="")
    ap.add_argument("--md", default="")
    ap.add_argument("--label", default="")
    a = ap.parse_args()
    keys = dict(kv.split("=") for kv in a.keys.split(",") if "=" in kv)
    res = {"label": a.label, "logs": a.logs, "fighters": {}, "attacks": [], "hits": [], "tear": {}}
    steps_all = []
    for li, path in enumerate(a.logs):
        rows, hits = load(path)
        run = os.path.basename(path).replace(".probe.jsonl", "")
        acts_by_role = {}
        for role, rs in rows.items():
            fid = "%s/%s" % (run, role)
            steps, mism, glide, fbg = feet(rs)
            acts = actions(rs)
            acts_by_role[role] = acts
            fac = facing(rs, acts)
            n, bind, tpose = flashes(rs)
            by = {}
            for g in sorted(set(s["group"] for s in steps)):
                xs = [s["slide_cm"] for s in steps if s["group"] == g]
                by[g] = {"steps": len(xs), "median_cm": round(pct(xs, 0.5), 2), "p90_cm": round(pct(xs, 0.9), 2),
                         "worst_cm": round(max(xs), 2), "over_2cm": sum(1 for x in xs if x > SLIDE_PASS_CM),
                         "over_5cm": sum(1 for x in xs if x > SLIDE_WORST_CM)}
            pops = defaultdict(int)
            for r in rs:
                if live(r) and r.get("pop", 0.0) > 60.0:
                    pops[group(r["st"])] += 1
            states = defaultdict(int)
            for r in rs:
                if live(r):
                    states[r["st"]] += 1
            res["fighters"][fid] = {
                "key": keys.get(role, ""), "frames": n, "frames_by_state": dict(states), "slide": by,
                "mismatch": {g: {"n": len(v), "median": round(pct(v, 0.5), 3), "p90": round(pct(v, 0.9), 3)} for g, v in mism.items()},
                "idle_glide_frames": dict(glide), "bind_frames": bind, "tpose_frames": tpose,
                "pops_over_60deg": dict(pops)}
            for s in steps:
                s["who"] = fid
            steps_all += steps
            for f in fac:
                f["who"] = fid
            res["attacks"] += fac
        for w in weight(rows, hits, acts_by_role):
            w["run"] = run
            res["hits"].append(w)
        if li == 0:
            res["tear"] = tear_table(rows, keys, a.reports)
    # ---- roll-up against BAR.md section C
    summ = {}
    sl = {}
    for g in sorted(set(s["group"] for s in steps_all)):
        xs = [s["slide_cm"] for s in steps_all if s["group"] == g]
        sl[g] = {"steps": len(xs), "median_cm": round(pct(xs, 0.5), 2), "p90_cm": round(pct(xs, 0.9), 2),
                 "worst_cm": round(max(xs), 2), "share_over_2cm": round(sum(1 for x in xs if x > SLIDE_PASS_CM) / len(xs), 3),
                 "over_5cm": sum(1 for x in xs if x > SLIDE_WORST_CM)}
    summ["slide"] = sl
    gate = [s["slide_cm"] for s in steps_all if s["group"] in GATE_GROUPS]
    summ["planted_feet"] = {"steps": len(gate), "over_2cm": sum(1 for x in gate if x > SLIDE_PASS_CM),
                            "over_5cm": sum(1 for x in gate if x > SLIDE_WORST_CM), "median_cm": round(pct(gate, 0.5), 2),
                            "worst_cm": round(max(gate), 2) if gate else 0.0,
                            "pass": bool(gate) and all(x <= SLIDE_PASS_CM for x in gate)}
    mm = defaultdict(list)
    for fid, f in res["fighters"].items():
        for g, v in f["mismatch"].items():
            mm[g].append(v["median"])
    summ["mismatch_median"] = {g: round(sum(v) / len(v), 3) for g, v in mm.items()}
    at = res["attacks"]
    off = [x for x in at if x["swing_off_deg"] is not None and x["swing_off_deg"] > OFF_DEG]
    boff = [x for x in at if x["body_off_deg"] is not None and x["body_off_deg"] > OFF_DEG]
    summ["facing"] = {"attacks": len(at), "swing_off_45": len(off), "body_off_45_at_contact": len(boff),
                      "body_off_45_at_start": sum(1 for x in at if x["body_off_start_deg"] > OFF_DEG),
                      "worst_swing_deg": max([x["swing_off_deg"] or 0.0 for x in at] or [0.0]),
                      "worst_body_deg": max([x["body_off_deg"] or 0.0 for x in at] or [0.0]),
                      "pass": len(off) == 0 and len(boff) == 0}
    nb = sum(len(f["bind_frames"]) for f in res["fighters"].values())
    nt = sum(len(f["tpose_frames"]) for f in res["fighters"].values())
    summ["pose_flashes"] = {"frames": sum(f["frames"] for f in res["fighters"].values()), "bind": nb, "tpose": nt, "pass": nb + nt == 0}
    hs = res["hits"]
    melee = [h for h in hs if not h.get("ranged")]
    ok_a = [h for h in melee if h["antic"] is not None and h["antic"] >= ANTIC_MIN]
    ok_f = [h for h in melee if h["follow"] is not None and h["follow"] >= FOLLOW_MIN]
    react = [h for h in hs if "hips_cm" in h and not h["ko"]]
    hips_ok = [h for h in react if h["hips_cm"] >= HIPS_MIN_CM]
    stag = [h for h in react if "stagger" in h.get("dst_states", []) or "hit" in h.get("dst_states", [])]
    stag_ok = [h for h in stag if h["hips_cm"] >= HIPS_MIN_CM]
    summ["weight"] = {"hits": len(hs), "melee": len(melee), "ranged": len(hs) - len(melee),
                      "antic_ok": len(ok_a), "antic_min": min([h["antic"] for h in melee if h["antic"] is not None] or [0]),
                      "antic_median": pct([h["antic"] for h in melee if h["antic"] is not None], 0.5),
                      "follow_ok": len(ok_f), "follow_median": pct([h["follow"] for h in melee if h["follow"] is not None], 0.5),
                      "reactions": len(react), "hips_move": len(hips_ok),
                      "hips_median_cm": pct([h["hips_cm"] for h in react], 0.5), "head_median_cm": pct([h["head_cm"] for h in react], 0.5),
                      "stagger_or_hit_clip": len(stag), "stagger_hips_move": len(stag_ok),
                      "pass": len(ok_a) == len(melee) and len(ok_f) == len(melee) and len(stag_ok) == len(stag) and len(melee) > 0}
    worst_t = 0.0
    over = []
    for role, t in res["tear"].items():
        for st, lst in t["states"].items():
            for c in lst:
                gate_t = 0.01 if st in ("run", "sprint") else 0.005
                worst_t = max(worst_t, c["worst"])
                if c["worst"] > gate_t:
                    over.append("%s %s %s %.2f%%" % (t["key"], st, c["clip"], c["worst"] * 100))
    summ["tear"] = {"worst": worst_t, "over_gate": over, "pass": not over} if res["tear"] else {"pass": None, "worst": None, "over_gate": []}
    res["summary"] = summ
    if a.json:
        json.dump(res, open(a.json, "w"), indent=1)
    md = []
    md.append("## Motion bar: %s" % (a.label or ", ".join(os.path.basename(x) for x in a.logs)))
    md.append("")
    md.append("| Item | Measured | Bar | Pass |")
    md.append("|---|---|---|---|")
    p = summ["planted_feet"]
    md.append("| Planted feet (idle, walk, jog, attack) | %d steps, median %.1f cm, %d over 2 cm (%.0f %%), %d over 5 cm, worst %.1f cm | under 2 cm, none over 5 cm | %s |" % (
        p["steps"], p["median_cm"], p["over_2cm"], 100.0 * p["over_2cm"] / max(1, p["steps"]), p["over_5cm"], p["worst_cm"], "yes" if p["pass"] else "NO"))
    f = summ["facing"]
    md.append("| Facing | %d directed attacks, %d swing over 45 deg off, %d body over 45 deg off at contact (%d at the start), worst swing %.0f deg | 0 | %s |" % (
        f["attacks"], f["swing_off_45"], f["body_off_45_at_contact"], f["body_off_45_at_start"], f["worst_swing_deg"], "yes" if f["pass"] else "NO"))
    pf = summ["pose_flashes"]
    md.append("| Pose flashes | %d bind-pose frames, %d T-pose frames of %d | 0 | %s |" % (pf["bind"], pf["tpose"], pf["frames"], "yes" if pf["pass"] else "NO"))
    w = summ["weight"]
    md.append("| Weight | %d blows (%d melee): anticipation at least 3 frames on %d of %d (least %s, median %s); follow-through on %d of %d (median %s); hit or stagger clips where the hips move at least 3 cm: %d of %d (all reactions: hips median %.1f cm, head %.1f cm) | every blow | %s |" % (
        w["hits"], w["melee"], w["antic_ok"], w["melee"], w["antic_min"], w["antic_median"], w["follow_ok"], w["melee"], w["follow_median"],
        w["stagger_hips_move"], w["stagger_or_hit_clip"], w["hips_median_cm"], w["head_median_cm"], "yes" if w["pass"] else "NO"))
    t = summ["tear"]
    if t["pass"] is not None:
        md.append("| Tearing (clips that played, worst LOD) | worst %.2f %%; over the gate: %s | at most 0.5 %% (run 1 %%) | %s |" % (
            t["worst"] * 100, ", ".join(t["over_gate"]) or "none", "yes" if t["pass"] else "NO"))
    md.append("")
    md.append("Foot slide per state group (all fighters): cm per step")
    md.append("")
    md.append("| State | Steps | Median | 90th centile | Worst | Over 2 cm | Over 5 cm | Foot speed / body speed |")
    md.append("|---|---|---|---|---|---|---|---|")
    for g, v in summ["slide"].items():
        md.append("| %s | %d | %.1f | %.1f | %.1f | %.0f %% | %d | %s |" % (g, v["steps"], v["median_cm"], v["p90_cm"], v["worst_cm"],
                  v["share_over_2cm"] * 100, v["over_5cm"], ("%.2f" % summ["mismatch_median"][g]) if g in summ["mismatch_median"] else ""))
    md.append("")
    md.append("Per fighter")
    md.append("")
    md.append("| Fighter | Frames | Slide median / worst cm (idle) | (walk) | (jog) | (attack) | Bind | T-pose | Pops over 60 deg |")
    md.append("|---|---|---|---|---|---|---|---|---|")
    for fid, fv in res["fighters"].items():
        def c(g):
            v = fv["slide"].get(g)
            return "%.1f / %.1f (%d)" % (v["median_cm"], v["worst_cm"], v["steps"]) if v else ""
        md.append("| %s %s | %d | %s | %s | %s | %s | %d | %d | %d |" % (fid, fv["key"], fv["frames"], c("idle"), c("walk"), c("jog"), c("attack"),
                  len(fv["bind_frames"]), len(fv["tpose_frames"]), sum(fv["pops_over_60deg"].values())))
    md.append("")
    md.append("Attacks off target (swing or body over 45 deg at contact)")
    md.append("")
    md.append("| Who | Frame | State | Distance m | Swing off deg | Body off deg (start / contact / worst) |")
    md.append("|---|---|---|---|---|---|")
    for x in at:
        if (x["swing_off_deg"] or 0) > OFF_DEG or (x["body_off_deg"] or 0) > OFF_DEG:
            md.append("| %s | %d | %s | %.1f | %s | %s / %s / %s |" % (x["who"], x["fr"], x["st"], x["dist_m"], x["swing_off_deg"],
                      x["body_off_start_deg"], x["body_off_deg"], x["body_off_worst_deg"]))
    if res["tear"]:
        md.append("")
        md.append("Tear per state and LOD (share of triangles stretched past 2.5x, percent)")
        md.append("")
        md.append("| Fighter | State | Clip | LOD0 | LOD1 | LOD2 | Worst |")
        md.append("|---|---|---|---|---|---|---|")
        for role, tt in res["tear"].items():
            for st, lst in tt["states"].items():
                for cinfo in lst:
                    by = cinfo["by_lod"]
                    md.append("| %s | %s | %s | %s | %s | %s | %.2f |" % (tt["key"], st, cinfo["clip"],
                              *[("%.2f" % (by[l] * 100)) if l in by else "" for l in ("lod0", "lod1", "lod2")], cinfo["worst"] * 100))
    text = "\n".join(md) + "\n"
    if a.md:
        open(a.md, "w").write(text)
    sys.stdout.write(text)


if __name__ == "__main__":
    main()
