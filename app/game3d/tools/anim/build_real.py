"""Build the mid and high tiers' captured-motion libraries (fid29 combat, build 29).

  $BLENDER_PY build_real.py --src <KayKit Knight.glb> --heroes <dir with <key>/lod0..2.glb> --raw <dir with cmcd/ 100style/ cmu/>
      --m2m <m2m.glb> [--keys icons_imani,...] [--work /abs/dir] [--gate 0.005]

Writes (relative to app/game3d), and nothing else:
  anim/real/<key>.glb      a skeleton-only clip library per faction hero: the directional hit reactions (additive),
                           the captured victory, the archetype intro and the GUARD variants
  data/anim_real.json      which state each clip stands in for, per hero, with the build 28 clip's length and event
                           times copied over (a new clip keeps its button's timing), and the tear/T-pose gates
Build 28's libraries (anim/<key>.glb) and data/anim_clips.json are read, never written: low phones load those, and
they stay byte-identical. The raw takes (CMCD, 100STYLE, CMU) are converted into a work folder and never shipped.

Steps: bvh2glb.py (CMCD, 100STYLE) and cmu2glb.py (CMU boxing) cut the sources into skeleton libraries; retarget.py
(the same maths and gates as every build 28 library) puts each clip on the hero's LOD1 skeleton and measures the
tear on LOD0, LOD1 and LOD2; a clip over the gate is left out for that hero (the build 28 clip plays).
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import add_gate  # noqa: E402
GAME = os.path.abspath(os.path.join(HERE, "..", ".."))
REAL = os.path.join(HERE, "real")
HEROES = ["icons_imani", "blockbusters_kofi", "ascendants_zuri", "controllers_tavo", "everborn_oren", "celestials_lyra"]
# intro archetype per hero (100STYLE idles): proud / strutting / neutral
ARCH = {"icons_imani": "Proud", "celestials_lyra": "Proud", "blockbusters_kofi": "Strut", "ascendants_zuri": "Strut",
        "controllers_tavo": "Neutral", "everborn_oren": "Neutral"}
# per direction, candidates in order of preference (the first under the gate on this hero is kept)
HITS = {"front": ["CM_Hit_Front"], "back": ["CM_Hit_Back", "CM_Hit_Back_B"], "left": ["CM_Hit_Left", "CM_Hit_Left_M"],
        "right": ["CM_Hit_Right", "CM_Hit_Right_M"], "front_heavy": ["M2M_Hit_Head"], "front_light": ["M2M_Hit_Chest"]}
GUARDS = ["CB_Guard_13", "CB_Guard_14"]
TIMING = ("frames", "fps", "contact", "in", "out", "tail")
GAINS = (1.0, 0.8, 0.65, 0.5)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-3000:], r.stderr[-3000:])
        raise SystemExit("failed: " + " ".join(cmd[:3]))
    return r.stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--heroes", required=True)
    ap.add_argument("--raw", required=True)
    ap.add_argument("--m2m", required=True)
    ap.add_argument("--keys", default=",".join(HEROES))
    ap.add_argument("--work", default=os.path.join(HERE, "real", "work"))
    ap.add_argument("--gate", type=float, default=0.005)
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    py = sys.executable
    data = json.load(open(os.path.join(GAME, "data", "anim_clips.json")))
    src_cfg = json.load(open(os.path.join(REAL, "src_clips.json")))
    lib = {}
    for name in ("cmcd", "style"):
        out = os.path.join(a.work, name + ".glb")
        sub = "cmcd" if name == "cmcd" else "100style"
        print(run([py, os.path.join(HERE, "bvh2glb.py"), "--clips", os.path.join(REAL, "src_clips.json"), "--lib", name,
                   "--src", os.path.join(a.raw, sub), "--out", out]).strip().splitlines()[-1])
        lib[name] = out
    out = os.path.join(a.work, "cmubox.glb")
    print(run([py, os.path.join(HERE, "cmu2glb.py"), "--cmu", os.path.join(a.raw, "cmu"), "--clips", os.path.join(REAL, "cmu_clips.json"),
               "--out", out]).strip().splitlines()[-1])
    lib["cmubox"] = out
    lib["m2m"] = a.m2m
    # merged configs (the build 28 files are only read)
    clips = json.load(open(os.path.join(HERE, "clips.json")))
    rclips = json.load(open(os.path.join(REAL, "clips.json")))
    clips["clips"].update(rclips["clips"])
    cpath = os.path.join(a.work, "clips_merged.json")
    json.dump(clips, open(cpath, "w"), indent=1)
    rigs = json.load(open(os.path.join(HERE, "rigs.json")))
    rr = json.load(open(os.path.join(REAL, "rigs.json")))
    rigs.update({k: v for k, v in rr.items() if k.endswith("_to_mixamo")})
    rigs["cmubox_to_mixamo"] = rigs["cmu_to_mixamo"]
    rpath = os.path.join(a.work, "rigs_merged.json")
    json.dump(rigs, open(rpath, "w"), indent=1)
    libs = ",".join("%s=%s" % (k, v) for k, v in lib.items())
    outdir = os.path.join(GAME, "anim", "real")
    os.makedirs(outdir, exist_ok=True)
    real = {"_doc": "fid29 combat (build 29): captured motion for the mid and high tiers only (combat_animator.gd, look "
                    "real + fid_combat), in new libraries anim/real/<key>.glb; build 28's anim/*.glb and data/anim_clips.json "
                    "are untouched (low phones load them). Per hero: hit = the additive directional hit reactions "
                    "(layered on the spine, neck and arms by pose_layer.gd, never played as a state); states = the state a "
                    "captured clip stands in for (its length and event times are the build 28 clip's: 'replaces'); "
                    "variants = clips a looping state may play instead of its build 28 clip, picked by a hash of the "
                    "fighter's slot and its count (never the fight's RNG). Written by tools/anim/build_real.py.",
            "credits": ["Motion data from the Cologne Motion Capture Database by TH Köln (University of Applied Sciences), CC BY 4.0. Retargeted and edited.",
                        "The 100STYLE Dataset - Ian Mason, CC BY 4.0. Retargeted and edited.",
                        "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217."],
            "gate_tear_share": a.gate, "clips": {}, "characters": {}}
    attach = os.path.join(GAME, "data", "attach.json")
    weapons = os.path.join(GAME, "tools", "weapons", "weapons.json")
    for key in a.keys.split(","):
        ch28 = data["characters"].get(key, {})
        poses = ch28.get("pick_poses", {})
        want = {}     # clip -> (role, state or hit dir, replaces)
        for d, cs in HITS.items():
            for c in cs:
                want[c] = ("hit", d, "")
        vic28 = poses.get("victory") or ""
        intro28 = poses.get("intro") or ""
        if not vic28:
            # no own victory in build 28 (Tavo): the set's cheer
            vic28 = "Cheer"
        if not intro28:
            intro28 = (data["clips"].get("R_Intro_Guard") and "R_Intro_Guard") or ""
        if vic28 in data["clips"]:
            n = data["clips"][vic28]["frames"]
            c = "CM_Victory_%d" % n
            if c in rclips["clips"]:
                want[c] = ("state", "victory", vic28)
                want[c + "s"] = ("state", "victory", vic28)
        if intro28 in data["clips"]:
            n = data["clips"][intro28]["frames"]
            c = "ST_Intro_%s_%d" % (ARCH[key], n)
            if c not in rclips["clips"]:
                c = next((x for x in rclips["clips"] if x.startswith("ST_Intro_") and x.endswith("_%d" % n)), "")
            if c:
                want[c] = ("state", "intro", intro28)
        for g in GUARDS:
            want[g] = ("variant", "guard", "")
        rep = os.path.join(a.work, key + ".report.json")
        hero = os.path.join(a.heroes, key)
        out = os.path.join(outdir, key + ".glb")
        base = [py, os.path.join(HERE, "retarget.py"), "--src", a.src, "--clips", cpath, "--rigs", rpath, "--attach", attach,
                "--weapons", weapons, "--key", key, "--libs", libs, "--only", ",".join(sorted(want))]
        print("== %s: %d clips" % (key, len(want)), flush=True)
        run(base + ["--target", os.path.join(hero, "lod1.glb"), "--out", out, "--report", rep])
        r = json.load(open(rep))
        for lod in ("lod0.glb", "lod2.glb"):
            if not os.path.exists(os.path.join(hero, lod)):
                continue
            run(base + ["--target", os.path.join(hero, lod), "--out", out + ".lodcheck.glb", "--report", rep + ".lod.json"])
            lr = json.load(open(rep + ".lod.json"))
            for cn, v in lr["clips"].items():
                cur = r["clips"][cn]
                cur.setdefault("tear_by_lod", {})[lod[:4]] = v["tear_share"]
                cur["tear_share"] = max(cur["tear_share"], v["tear_share"])
            os.remove(rep + ".lod.json")
            os.remove(out + ".lodcheck.glb")
        # the additive hit reactions are gated as the game layers them (add_gate.py): on the hero's own build 28
        # idle, guard and light hit, LOD0 to LOD2; their full-body retarget numbers stay in the report
        # a reaction too big for this hero's mesh is played smaller: the largest gain of GAINS that passes
        hits = [c for c in want if want[c][0] == "hit" and c in r["clips"]]
        gains = {}
        todo = list(hits)
        for g in GAINS:
            if not todo:
                break
            addg = add_gate.gate(hero, os.path.join(GAME, "anim", key + ".glb"), out, todo, gain=g)
            for c in list(todo):
                v = addg.get(c, {"tear": 1.0})
                r["clips"][c].setdefault("tear_full_body", r["clips"][c]["tear_share"])
                r["clips"][c]["tear_share"] = round(v["tear"], 5)
                r["clips"][c]["tear_additive"] = dict(v, gain=g)
                if v["tear"] <= a.gate:
                    gains[c] = g
                    todo.remove(c)
        json.dump(r, open(rep, "w"), indent=1)
        ok = sorted(c for c, v in r["clips"].items() if v["tear_share"] <= a.gate and v["gates"].get("tpose_frames", 0) == 0)
        torn = sorted(c for c in r["clips"] if c not in ok)
        # per direction and state the first candidate that passed; every passing variant
        keep = []
        for d, cs in HITS.items():
            got = next((c for c in cs if c in ok), "")
            if got:
                keep.append(got)
        seen = set()
        for c in sorted(want, key=lambda x: (len(x), x)):
            role, what, _ = want[c]
            if role == "state" and c in ok and what not in seen:
                seen.add(what)
                keep.append(c)
            elif role == "variant" and c in ok:
                keep.append(c)
        ok = sorted(keep)
        # the library ships only the clips that passed
        if not ok:
            os.remove(out)
            print("SKIP", key, "every clip over the gate:", torn)
            continue
        run(base[:-1] + [",".join(ok), "--target", os.path.join(hero, "lod1.glb"), "--out", out, "--report", rep + ".pruned.json"])
        os.remove(rep + ".pruned.json")
        with open(out + ".import", "w") as f:
            f.write('[remap]\n\nimporter="keep"\n')
        ch = {"library": "res://anim/real/%s.glb" % key, "hit": {}, "states": {}, "variants": {},
              "fingerprint": {b: r["fingerprint"][b] for b in ("Hips", "RightHand", "LeftFoot")},
              "tear": {c: round(r["clips"][c]["tear_share"], 5) for c in sorted(r["clips"])}, "over_gate": torn,
              "tear_note": "worst share of triangles stretched past 2.5x on LOD0 to LOD2; hit clips measured as layered (add_gate.py)"}
        for c in ok:
            role, what, repl = want[c]
            meta = {"frames": r["clips"][c]["frames"], "fps": r["clips"][c]["fps"], "src": rclips["clips"].get(c, clips["clips"].get(c, {})).get("source", ""),
                    "licence": rclips["clips"].get(c, clips["clips"].get(c, {})).get("licence", "")}
            if role == "hit":
                ch["hit"][what] = c
                ch.setdefault("hit_gain", {})[what] = gains.get(c, 1.0)
            elif role == "state":
                ch["states"][what] = c
                old = data["clips"][repl]
                for k in TIMING:
                    if k in old:
                        meta[k] = old[k]
                meta["replaces"] = repl
            else:
                ch["variants"].setdefault(what, []).append(c)
            real["clips"].setdefault(c, meta)
        real["characters"][key] = ch
        print("OK", key, "kept", ok, "over gate", torn, "bytes", os.path.getsize(out), flush=True)
    json.dump(real, open(os.path.join(GAME, "data", "anim_real.json"), "w"), indent=1, ensure_ascii=False)
    print("WROTE data/anim_real.json")


if __name__ == "__main__":
    main()
