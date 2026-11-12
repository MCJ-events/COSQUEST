#!/usr/bin/env python3
"""hero_sidecar.py <key> [--out DIR]: the summary of one character's clip library, and its
run-time sidecar (anim.glb + anim.json) for a character that is not inside the pck.

The sidecar holds everything anim_library.gd needs to register the library when it finds it
beside a downloaded model: the character's entry of data/anim_clips.json (picks, fingerprint,
ground speeds), the metadata of every clip its picks name, and its clip grips from attach.json."""
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.abspath(os.path.join(HERE, "..", ".."))


def main():
    key = sys.argv[1]
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else ""
    data = json.load(open(os.path.join(GAME, "data", "anim_clips.json")))
    attach = json.load(open(os.path.join(GAME, "data", "attach.json")))
    cfg = json.load(open(os.path.join(HERE, "clips.json")))
    ch = data["characters"].get(key, {})
    if ch.get("status") != "clips":
        print("HERO %s status=%s why=%s" % (key, ch.get("status"), ch.get("why", "")))
        return
    if "--droop" in sys.argv:
        # a realistic body: the stylised clips' arms-out carriage is taken back in the game
        ch["arm_droop"] = float(sys.argv[sys.argv.index("--droop") + 1])
        ch["arm_free_deg"] = 14.0
        json.dump(data, open(os.path.join(GAME, "data", "anim_clips.json"), "w"), indent=1)
    rep = json.load(open(os.path.join(HERE, "reports", key + ".json")))["clips"]
    lost = []
    for kind, picks, sets in (("classic", ch["pick"], cfg["sets"]), ("captured", ch.get("pick_mocap", {}), cfg.get("sets_mocap", {}))):
        for st, e in sets.get("blade", {}).items():
            if not picks.get("blade", {}).get(st):
                first = e["clip"]
                lost.append("%s %s (%s %.2f %%)" % (kind, st, first, rep.get(first, {}).get("tear_share", 0) * 100))
            elif picks["blade"][st] != e["clip"]:
                lost.append("%s %s: %s -> %s" % (kind, st, e["clip"], picks["blade"][st]))
    used = sorted({v for sp in list(ch["pick"].values()) + list(ch.get("pick_mocap", {}).values()) for v in sp.values() if v})
    worst_used = max(rep[c]["tear_share"] for c in used if c in rep)
    hy = data.get("hybrid_states", {}).get("blade", {})
    plays = {}
    for st in ("idle", "run", "attack_1", "attack_2", "attack_3", "heavy", "hit", "stagger", "death", "victory"):
        mode = hy.get(st, "mocap")
        m = ch.get("pick_mocap", {}).get("blade", {}).get(st, "")
        c = ch["pick"]["blade"].get(st, "")
        plays[st] = (m if (mode != "classic" and m) else c) or "(procedural)"
    print("HERO %s clips_in_library=%d worst_tear_of_used=%.2f%% hip_scale=%s" % (key, len(used), worst_used * 100, ch.get("hip_scale")))
    print("  plays (sword, hybrid):", json.dumps(plays))
    print("  lost to the gate or replaced (sword set):", "; ".join(lost) if lost else "nothing")
    if out:
        os.makedirs(out, exist_ok=True)
        shutil.copy(os.path.join(GAME, "anim", key + ".glb"), os.path.join(out, "anim.glb"))
        side = {"v": 1, "key": key, "character": dict(ch, library="anim.glb"),
                "clips": {c: data["clips"][c] for c in used if c in data["clips"]},
                "clip_grips": attach["characters"].get(key, {}).get("clip_grips", {})}
        json.dump(side, open(os.path.join(out, "anim.json"), "w"), indent=1)
        print("  sidecar:", out, "anim.glb %d bytes, anim.json %d bytes" % (os.path.getsize(os.path.join(out, "anim.glb")), os.path.getsize(os.path.join(out, "anim.json"))))


if __name__ == "__main__":
    main()
