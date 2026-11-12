"""Record the build 22 fight corpus: seeded bot fights from the Godot fight itself, headless, with the judge log.
usage: corpus.py OUT.jsonl.gz MODS_OUT.jsonl.gz [jobs]"""
import gzip, json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
H = os.path.expanduser("~"); G = f"{H}/lookfight/bin/godot"; R = f"{H}/realism-20261111/panel/game3d"
C = f"{H}/cq-work/239-game-quality-characters/cast060"
CAST = {"hero_glb": f"{C}/pose/armstrong/lod1.glb", "ally_glb": f"{C}/pose/nebulx/lod1.glb", "enemy_glb": f"{C}/deck/hoof/lod1.glb",
        "hero_key": "armstrong", "ally_key": "nebulx", "enemy_key": "hoof"}
jobs = []
def add(plan, seed, fps="30", dur=45, mods=None, **cfg):
    jobs.append({"plan": plan, "fps": fps, "seed": seed, "duration_s": dur, "mods": mods, "cfg": cfg})
for i in range(40): add("caps", 2001 + i)
for i in range(30): add("hoof", 2101 + i, **CAST)
for i in range(15): add("short", 2201 + i, dur=12)
for i in range(8): add("idle", 2301 + i, bot="idle")
for i in range(12): add("fps15", 2401 + i, fps="15")
for i in range(12): add("fps60", 2501 + i, fps="60")
for i in range(10): add("free", 2601 + i, fps="free")
for i in range(5): add("low", 2701 + i, tier="low", **CAST)
for i in range(5): add("high", 2701 + i, tier="high", **CAST)      # the same seeds on another tier: the same records
for i in range(5): add("land", 2801 + i, landscape=True)
MODS = {"run": (30, 650, 1000), "raid": (60, 1300, 1100), "trial1": (45, 720, 1000), "trial8": (45, 1250, 1000),
        "siege": (45, 1100, 1000), "starter": (45, 800, 1000), "heavy": (45, 1000, 1600)}
for name, (dur, hp, dmg) in MODS.items():
    for i in range(4): add(name, 9100 + i, dur=dur, mods={"boss_hp_permille": hp, "boss_dmg_permille": dmg})
    add(name, 9190, dur=dur, mods={"boss_hp_permille": hp, "boss_dmg_permille": dmg}, bot="idle")

def run(j):
    cfg = {"seed": j["seed"], "duration_s": j["duration_s"], **j["cfg"]}
    if j["mods"]: cfg["mods"] = j["mods"]
    cmd = ["nice", "-n", "5", f"{H}/lookfight/bin/capped", "3G", G, "--headless", "--path", R]
    if j["fps"] != "free": cmd += ["--fixed-fps", j["fps"]]
    cmd += ["-s", "res://tools/panel/corpus_fight.gd", "--", "--cfg=" + json.dumps(cfg)]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=900).stdout
    except subprocess.TimeoutExpired:
        return j, None
    line = next((l for l in out.splitlines() if l.startswith("CQSEEDED ")), None)
    return j, json.loads(line[9:]) if line else None

n = int(sys.argv[3]) if len(sys.argv) > 3 else 5
plain, modded, bad = [], [], 0
with ThreadPoolExecutor(n) as ex:
    for k, (j, r) in enumerate(ex.map(run, jobs)):
        if r is None:
            bad += 1; print("FAILED", j["plan"], j["seed"], flush=True); continue
        row = {"plan": j["plan"], "fps": j["fps"], "seed": j["seed"], "duration_s": j["duration_s"]}
        if j["mods"]: row["mods"] = j["mods"]
        row["result"] = r
        (modded if j["mods"] else plain).append(row)
        if k % 10 == 0: print(k, len(jobs), j["plan"], r["outcome"], r["skills"], flush=True)
for path, rows in ((sys.argv[1], plain), (sys.argv[2], modded)):
    with gzip.open(path, "wt") as f:
        for r in rows: f.write(json.dumps(r, separators=(",", ":")) + "\n")
print("done", len(plain), len(modded), "failed", bad)
