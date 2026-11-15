# fid29-dressing: fetch Poly Haven models (CC0) at 1K glTF with their textures, recording URL, size and sha256 for
# docs/game3d/fid29/ASSETS-LICENCES-dressing.md. Run on mm1 (CPU box), never the Mac:
#   python3 -I ph_dl.py street_lamp_01 street_lamp_02 utility_box_01 ...   -> ~/cq-overflow/b29/dressing/dl/ph/<id>/, records.json
# ambientCG materials (Bark007, Concrete034, Rock030, Metal046B, LeafSet027) were fetched as their 1K-JPG zips.
import json, os, sys, hashlib, urllib.request, time
UA = {"User-Agent": "cq-fid29-dressing/1.0"}
ids = sys.argv[1:]
root = os.path.expanduser("~/cq-overflow/b29/dressing/dl/ph")
rec = []
def get(url, path):
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as f:
            f.write(r.read())
        time.sleep(0.3)
    return hashlib.sha256(open(path, "rb").read()).hexdigest(), os.path.getsize(path)
for a in ids:
    req = urllib.request.Request("https://api.polyhaven.com/files/" + a, headers=UA)
    d = json.load(urllib.request.urlopen(req, timeout=60))
    g = d["gltf"]["1k"]["gltf"]
    base = os.path.join(root, a)
    sh, sz = get(g["url"], os.path.join(base, os.path.basename(g["url"])))
    rec.append([a, os.path.basename(g["url"]), g["url"], sz, sh])
    for k, v in g["include"].items():
        sh, sz = get(v["url"], os.path.join(base, k))
        rec.append([a, k, v["url"], sz, sh])
json.dump(rec, open(os.path.join(root, "records.json"), "w"), indent=0)
print(len(rec), "files", sum(r[3] for r in rec) / 1e6, "MB")
