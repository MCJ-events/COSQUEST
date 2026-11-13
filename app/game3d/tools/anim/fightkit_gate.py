#!/usr/bin/env python3
"""fightkit_gate.py: the game's gates on one character's fight library, for a fight kit (build 28).

  fightkit_gate.py <key> --sidecar DIR --report OUT.json
      After add_hero.sh <key>: the library's verdict. Not ok when the character has no library
      (a core state with no clip under the 0.5 % tear gate: add_hero.sh marks it "procedural").
      Every readable button pick is checked as readable_gates.py checks it (tear under the gate,
      facing the target at contact: cuts within 45 deg, the rest 90; no T-pose frame); a pick that
      fails is DROPPED from the sidecar's anim.json (that button keeps its classic clip), never
      played. The verdict is also written into anim.json ("gates").
  fightkit_gate.py --pick OUT  <key> <method> <report> <sidecar dir> <rigged lods dir or ""> ...
      The best candidate that is ok (most readable picks kept, then the lowest worst tear): its
      anim.glb, anim.json and rigged lod0..2.glb copied to OUT, OUT/verdict.json written.
      Exit 0 when one is kept, 3 when none passes."""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.abspath(os.path.join(HERE, "..", ".."))
CORE = ("idle", "run", "attack_1", "hit", "death")


def gate(key, sidecar, report):
    data = json.load(open(os.path.join(GAME, "data", "anim_clips.json")))
    ch = data["characters"].get(key, {})
    out = {"key": key, "ok": False}
    if ch.get("status") != "clips":
        out["why"] = ch.get("why") or "no library (status %s)" % ch.get("status")
        json.dump(out, open(report, "w"), indent=1)
        print("GATE %s no: %s" % (key, out["why"]))
        return 1
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as t:
        tmp = t.name
    subprocess.run([sys.executable, os.path.join(HERE, "readable_gates.py"), "--json", tmp], check=True,
                   capture_output=True, text=True, cwd=GAME)
    rows = [r for r in json.load(open(tmp)) if r["key"] == key]
    os.unlink(tmp)
    played = [r for r in rows if r["clip"]]
    bad = [r for r in played if not (r["tear_ok"] and r["facing_ok"] and not r["tpose"])]
    picks = (ch.get("pick", {}) or {}).get("blade", {})
    out.update({
        "ok": True, "status": ch["status"], "tear_worst_pct": round(100 * float(ch.get("tear_worst") or 0), 3),
        "clips_over_gate": len(ch.get("clips_over_gate") or []),
        "core": {s: picks.get(s, "") for s in CORE},
        "readable": {"picks": len(played) - len(bad), "fallbacks": len(rows) - len(played),
                     "dropped": [{"state": r["state"], "set": r["set"], "clip": r["clip"], "tear_pct": r["tear_pct"],
                                  "contact_yaw": r["contact_yaw"], "tpose": r["tpose"]} for r in bad]},
        "worst_foot_slide_cm": max([r["foot_worst_cm"] or 0 for r in played] or [0]),
    })
    side = os.path.join(sidecar, "anim.json")
    if os.path.isfile(side):
        j = json.load(open(side))
        pr = j["character"].get("pick_readable", {})
        for r in bad:
            if r["state"] in ("intro", "victory"):
                j["character"].get("pick_poses", {}).pop(r["state"], None)
            else:
                pr.get(r["set"], {}).pop(r["state"], None)
        j["gates"] = {k: out[k] for k in ("tear_worst_pct", "clips_over_gate", "readable", "worst_foot_slide_cm")}
        json.dump(j, open(side, "w"), indent=1)
    else:
        out.update({"ok": False, "why": "no sidecar written"})
    json.dump(out, open(report, "w"), indent=1)
    print("GATE %s %s: tear worst %.2f %%, readable picks %d (dropped %d, fallbacks %d)" % (
        key, "ok" if out["ok"] else "no", out.get("tear_worst_pct", 0), out["readable"]["picks"],
        len(out["readable"]["dropped"]), out["readable"]["fallbacks"]))
    return 0 if out["ok"] else 1


def pick(out_dir, args):
    cands = []
    for i in range(0, len(args), 5):
        key, method, report, sidecar, rigdir = args[i:i + 5]
        rep = json.load(open(report)) if os.path.isfile(report) else {"ok": False, "why": "no report"}
        cands.append({"key": key, "method": method, "rep": rep, "sidecar": sidecar, "rigdir": rigdir})
    ok = [c for c in cands if c["rep"].get("ok")]
    verdict = {"tried": [{"key": c["key"], "method": c["method"], "ok": bool(c["rep"].get("ok")),
                          "why": c["rep"].get("why"), "tear_worst_pct": c["rep"].get("tear_worst_pct"),
                          "readable_picks": (c["rep"].get("readable") or {}).get("picks")} for c in cands]}
    if not ok:
        verdict.update({"ok": False, "why": "; ".join("%s: %s" % (c["method"], c["rep"].get("why")) for c in cands)})
        json.dump(verdict, open(os.path.join(out_dir, "verdict.json"), "w"), indent=1)
        print("FIGHTKIT no kit: " + verdict["why"])
        return 3
    best = sorted(ok, key=lambda c: (-c["rep"]["readable"]["picks"], c["rep"]["tear_worst_pct"]))[0]
    for n in ("anim.glb", "anim.json"):
        shutil.copy(os.path.join(best["sidecar"], n), os.path.join(out_dir, n))
    if best["rigdir"]:
        for lod in (0, 1, 2):
            p = os.path.join(best["rigdir"], "lod%d.glb" % lod)
            if os.path.isfile(p):
                shutil.copy(p, os.path.join(out_dir, "lod%d.glb" % lod))
    verdict.update({"ok": True, "key": best["key"], "method": best["method"], "gates": best["rep"],
                    "lods": bool(best["rigdir"])})
    json.dump(verdict, open(os.path.join(out_dir, "verdict.json"), "w"), indent=1)
    print("FIGHTKIT kept %s (%s): tear worst %.2f %%, readable picks %d" % (
        best["key"], best["method"], best["rep"]["tear_worst_pct"], best["rep"]["readable"]["picks"]))
    return 0


def main():
    a = sys.argv[1:]
    if a and a[0] == "--pick":
        return pick(a[1], a[2:])
    key = a[0]
    return gate(key, a[a.index("--sidecar") + 1], a[a.index("--report") + 1])


if __name__ == "__main__":
    sys.exit(main())
