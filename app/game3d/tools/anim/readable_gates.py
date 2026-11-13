#!/usr/bin/env python3
"""readable_gates.py [--md out.md] [--json out.json]: the motion gates of every readable pick, per rig.

For each character in data/anim_clips.json and each readable state of its own weapon set (sword for the
cartoon cast's blade set, the set its default class gives otherwise), the clip it plays and that clip's
numbers from tools/anim/reports/<key>.json: tear (worst of LOD0 to LOD2; gate 0.5 %), the weapon or
striking hand's direction at the contact against forward (no backward attacks: within 90 degrees, and
the BAR's 45 for the cuts), T-pose frames, and the worst planted-foot slide inside the clip. A state with
no pick falls back to what the character played before (named)."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.abspath(os.path.join(HERE, "..", ".."))
STATES = ["attack_1", "attack_2", "attack_3", "skill_shoot", "skill_rain", "skill_charge", "skill_shield", "skill_split",
          "skill_rally", "guard", "parry", "hit_light", "hit_heavy", "knockdown", "intro", "victory"]
CUTS = ("attack_1", "attack_2", "attack_3", "skill_shoot", "skill_split", "skill_charge")


def main():
    d = json.load(open(os.path.join(GAME, "data", "anim_clips.json")))
    att = json.load(open(os.path.join(GAME, "data", "attach.json")))
    cfg = json.load(open(os.path.join(HERE, "clips.json")))
    rows = []
    for key, ch in sorted(d["characters"].items()):
        if ch.get("status") != "clips" or "pick_readable" not in ch:
            continue
        rep = json.load(open(os.path.join(HERE, "reports", key + ".json")))["clips"]
        own_cls = cfg.get("default_class", {}).get(key) or att["weapons"].get(att["characters"].get(key, {}).get("default_weapon") or "", {}).get("grip", "sword")
        own = d["class_set"].get(own_cls, "blade")
        for sname in (["blade"] + ([own] if own != "blade" else [])):
          for st in STATES:
            if sname != "blade" and st in ("intro", "victory"):
                continue
            if st in ("intro", "victory"):
                clip = ch.get("pick_poses", {}).get(st, "")
                if not clip:
                    continue
            else:
                if st not in d.get("sets_readable", {}).get(sname, {}):
                    continue
                clip = ch["pick_readable"].get(sname, {}).get(st, "")
            if not clip:
                fb = ch.get("pick", {}).get(sname, {}).get({"skill_shoot": "attack_2", "skill_rain": "skill_rally", "hit_light": "hit", "hit_heavy": "hit", "knockdown": "hit"}.get(st, st), "")
                rows.append({"key": key, "set": sname, "state": st, "clip": "", "fallback": fb})
                continue
            r = rep.get(clip, {})
            g = r.get("gates", {})
            yaw = g.get("contact_yaw_deg")
            rows.append({"key": key, "set": sname, "state": st, "clip": clip, "tear_pct": round(100 * r.get("tear_share", 0), 2),
                         "tear_ok": r.get("tear_share", 1) <= 0.005, "contact_yaw": yaw,
                         "facing_ok": (yaw is None) or (abs(yaw) <= (45 if st in CUTS else 90)),
                         "tpose": g.get("tpose_frames", 0), "foot_worst_cm": g.get("foot_slide_worst_cm")})
    if "--json" in sys.argv:
        json.dump(rows, open(sys.argv[sys.argv.index("--json") + 1], "w"), indent=1)
    lines = ["| rig | set | state | clip | tear % (gate 0.5) | facing at contact (deg) | T-pose frames | worst foot slide in clip (cm) |", "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        if not r["clip"]:
            lines.append("| %s | %s | %s | none passes; keeps %s | | | | |" % (r["key"], r["set"], r["state"], r["fallback"] or "the procedural pose"))
        else:
            lines.append("| %s | %s | %s | %s | %.2f%s | %s%s | %d | %s |" % (r["key"], r["set"], r["state"], r["clip"], r["tear_pct"], "" if r["tear_ok"] else " OVER",
                         "-" if r["contact_yaw"] is None else r["contact_yaw"], "" if r["facing_ok"] else " OFF", r["tpose"], r["foot_worst_cm"]))
    played = [r for r in rows if r["clip"]]
    summ = ("picks %d, fallbacks %d; tear over gate %d; facing off %d; T-pose frames %d" %
            (len(played), len(rows) - len(played), sum(not r["tear_ok"] for r in played), sum(not r["facing_ok"] for r in played), sum(r["tpose"] for r in played)))
    print(summ)
    if "--md" in sys.argv:
        open(sys.argv[sys.argv.index("--md") + 1], "w").write(summ + "\n\n" + "\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
