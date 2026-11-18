"""Interim SPLIT / WHIRL / RALLY buttons: klein /edit redraws one of Wale's buttons (his art is the first image, two
more of his as style references) in a new colour with a new centre symbol. Inside the Forge GPU lock.
usage: glyphs.py SHEET OUT [ids] [seeds]"""
import base64, io, json, os, sys, time, urllib.request
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path.home() / "realism-20261111/asset/code"))
from envgen import gpulock  # noqa: E402
KLEIN = "http://127.0.0.1:8783"
SHEET, OUT = sys.argv[1], Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
ids = sys.argv[3].split(",") if len(sys.argv) > 3 else ["split", "whirl", "rally"]
seeds = [int(x) for x in sys.argv[4].split(",")] if len(sys.argv) > 4 else [3, 11, 27]
sheet = Image.open(SHEET).convert("RGB")
def crop(cx, cy, r, px=768):
    return sheet.crop((int(cx - r), int(cy - r), int(cx + r), int(cy + r))).resize((px, px), Image.LANCZOS)
shield, shoot, dash = crop(597, 211, 150), crop(288, 286, 128, 512), crop(238, 808, 108, 512)
STYLE = ("Keep exactly the same glossy 3D cartoon mobile game button: the same round thick coloured rim, the same four grey "
         "stone segments on the rim at the four diagonals, the same dark round inner face, the same soft pale halo disc behind "
         "it, the same size and position, the same pale grey background. The other images show more buttons of the same set: "
         "match their style, shine and bold simple symbol drawing. One single bold symbol in the centre, no text, no letters.")
P = {
 "split": "Change this button's colour from green to golden yellow (rim golden yellow, inner face dark brown, halo pale yellow) and "
          "replace the shield symbol with a glowing golden jagged crack splitting the ground in a zigzag from bottom to top, with small "
          "rock shards flying off each side: an earth-splitting ground slam symbol. ",
 "whirl": "Change this button's colour from green to teal (rim bright teal turquoise, inner face very dark teal, halo pale mint teal) and "
          "replace the shield symbol with a white and teal spinning whirlwind blade: two curved crescent sword slashes chasing each other "
          "in a circle, a spiral spin attack symbol. ",
 "rally": "Change this button's colour from green to hot pink (rim hot pink magenta-rose, inner face very dark wine red, halo pale pink) and "
          "replace the shield symbol with a glowing white and pink heart with a small upward arrow chevron above it and little sparkles: "
          "a heal and power-up rally symbol. ",
}
def b64(i):
    b = io.BytesIO(); i.save(b, "PNG"); return base64.b64encode(b.getvalue()).decode()
rec = {}
with gpulock.gpu(f"realism-panel-glyphs:{len(ids) * len(seeds)}", timeout_s=7200):
    for i in ids:
        for s in seeds:
            t = time.time()
            body = json.dumps({"prompt": P[i] + STYLE, "images_b64": [b64(shield), b64(shoot), b64(dash)], "seed": s,
                               "width": 768, "height": 768, "steps": 4}).encode()
            req = urllib.request.Request(KLEIN + "/edit", data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=900) as r:
                d = json.loads(r.read())
            Image.open(io.BytesIO(base64.b64decode(d["image_b64"]))).convert("RGB").save(OUT / f"{i}_{s}.png")
            rec[f"{i}_{s}"] = {"prompt": P[i] + STYLE, "seed": s, "s": round(time.time() - t, 1)}
            print(i, s, rec[f"{i}_{s}"]["s"], flush=True)
json.dump(rec, open(OUT / "glyphs.json", "w"), indent=1)
