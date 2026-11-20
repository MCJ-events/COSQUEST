#!/usr/bin/env python3
"""Smoothness report (fight-motion-31) from tools/anim_probe.gd (v2) logs, any frame rate.

  python3 smooth_report.py run.probe.jsonl [--fps 60] [--json out.json] [--label name] [--roles hero,ally,enemy]

What is measured, on the FINAL drawn pose (the probe's world joint positions), per fighter:

  root      the Hips' acceleration in the world (the drawn body's travel: a dash or a shove that starts
            or stops in one frame shows here), m/s^2 at size 1
  pose      hands, feet, head and forearms relative to the Hips (the pose and the turn), m/s^2 at size 1
  spikes    frames whose acceleration is over SPIKE (and over BIG) m/s^2. A real swing peaks at a few
            hundred m/s^2 over several frames; a one-frame snap (a clip switch, a pop, a step in the
            root) is a spike well over that on one frame. Frames next to a hit-stop freeze are left out
            and counted on their own (a freeze is meant to stop the body dead).
  at_switch the share of pose spikes in the first 6 frames after a state change (snaps at transitions)
  jerk      the 99th centile of the pose acceleration
  freeze    the share of fight frames frozen by hit-stop, and how many freezes a second
  flicker   locomotion state changes (idle / walk / run / sprint) that undo themselves within 0.3 s
  turn      the drawn body's turn rate: frames over 720 deg/s outside the whirl
"""
import argparse, json, math, collections

POSE = ["Head", "LeftHand", "RightHand", "LeftFoot", "RightFoot", "LeftForeArm", "RightForeArm"]
SPIKE = 300.0
BIG = 800.0
LOCO = {"idle", "_", "walk", "run", "sprint"}


def d2(a, b, c):
    return math.sqrt(sum((a[i] - 2 * b[i] + c[i]) ** 2 for i in range(3)))


def rel(r, p):
    return [r[p][i] - r["Hips"][i] for i in range(3)]


def q(xs, f):
    if not xs:
        return 0.0
    s = sorted(xs)
    return s[int(f * (len(s) - 1))]


def fighter(rows, fps):
    rows = [r for r in rows if r.get("vis") and r["fs"] in ("fighting", "ending", "intro") and "Hips" in r]
    out = {"frames": len(rows)}
    root, pose, root_sp, pose_sp, pose_big, root_big, sw_sp = [], [], 0, 0, 0, 0, 0
    near_frz = 0
    by_state = collections.Counter()
    since_switch = 99
    for i in range(1, len(rows) - 1):
        a, b, c = rows[i - 1], rows[i], rows[i + 1]
        since_switch = 0 if b["st"] != a["st"] else since_switch + 1
        if c["fr"] - a["fr"] != 2:
            continue
        sz = max(0.3, float(b.get("size", 1.0)))
        k = fps * fps / sz
        if a["frz"] or b["frz"] or c["frz"]:
            near_frz += 1
            continue
        ra = d2(a["Hips"], b["Hips"], c["Hips"]) * k
        root.append(ra)
        if ra > SPIKE:
            root_sp += 1
        if ra > BIG:
            root_big += 1
        worst = 0.0
        for p in POSE:
            if p in a and p in b and p in c:
                worst = max(worst, d2(rel(a, p), rel(b, p), rel(c, p)) * k)
        pose.append(worst)
        if worst > SPIKE:
            pose_sp += 1
            by_state[b["st"]] += 1
            if since_switch < 6:
                sw_sp += 1
        if worst > BIG:
            pose_big += 1
    n = max(1, len(pose))
    secs = len(rows) / fps
    out.update({
        "pose_spike_frames": pose_sp, "pose_spikes_per_s": round(pose_sp / secs, 2),
        "pose_big_frames": pose_big, "pose_p50": round(q(pose, .5)), "pose_p99": round(q(pose, .99)), "pose_max": round(max(pose or [0])),
        "root_spike_frames": root_sp, "root_big_frames": root_big, "root_p99": round(q(root, .99)), "root_max": round(max(root or [0])),
        "at_switch_share": round(sw_sp / max(1, pose_sp), 2), "spikes_by_state": dict(by_state.most_common(10)),
        "frames_next_to_freeze": near_frz,
    })
    fight = [r for r in rows if r["fs"] == "fighting"]
    frz = sum(1 for r in fight if r["frz"])
    runs = 0
    prev = False
    for r in fight:
        if r["frz"] and not prev:
            runs += 1
        prev = r["frz"]
    out["freeze_share"] = round(frz / max(1, len(fight)), 3)
    out["freezes_per_s"] = round(runs / max(0.01, len(fight) / fps), 2)
    # locomotion flicker
    seq = []
    for r in rows:
        if not seq or seq[-1][1] != r["st"]:
            seq.append((r["fr"], r["st"]))
    flick = 0
    for i in range(2, len(seq)):
        if seq[i][1] == seq[i - 2][1] and seq[i - 1][1] in LOCO and seq[i][1] in LOCO and (seq[i][0] - seq[i - 1][0]) < 0.3 * fps:
            flick += 1
    out["loco_flicker"] = flick
    out["state_changes"] = len(seq)
    # drawn turn rate (the body's forward from the probe)
    fast = 0
    for a, b in zip(rows, rows[1:]):
        if b["fr"] - a["fr"] != 1 or b["st"] == "skill_whirl" or b["frz"]:
            continue
        fa, fb = a.get("fwd"), b.get("fwd")
        if not fa or not fb:
            continue
        ya, yb = math.atan2(fa[0], fa[1]), math.atan2(fb[0], fb[1])
        dy = abs((yb - ya + math.pi) % (2 * math.pi) - math.pi)
        if math.degrees(dy) * fps > 720:
            fast += 1
    out["fast_turn_frames"] = fast
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("probe")
    ap.add_argument("--fps", type=float, default=60.0)
    ap.add_argument("--json", default="")
    ap.add_argument("--label", default="")
    ap.add_argument("--roles", default="hero,ally,enemy")
    a = ap.parse_args()
    rows = [json.loads(l) for l in open(a.probe)]
    res = {"label": a.label or a.probe, "fps": a.fps, "fighters": {}}
    for role in a.roles.split(","):
        res["fighters"][role] = fighter([r for r in rows if r.get("role") == role], a.fps)
    if a.json:
        json.dump(res, open(a.json, "w"), indent=1)
    print("##", res["label"])
    keys = ["frames", "pose_spikes_per_s", "pose_spike_frames", "pose_big_frames", "pose_p99", "pose_max", "root_spike_frames",
            "root_big_frames", "root_p99", "at_switch_share", "freeze_share", "freezes_per_s", "loco_flicker", "fast_turn_frames"]
    print("| metric | " + " | ".join(res["fighters"]) + " |")
    print("|---|" + "---|" * len(res["fighters"]))
    for k in keys:
        print("| %s | " % k + " | ".join(str(res["fighters"][r].get(k)) for r in res["fighters"]) + " |")
    for r in res["fighters"]:
        print(r, "spikes by state:", res["fighters"][r]["spikes_by_state"])


if __name__ == "__main__":
    main()
