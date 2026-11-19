"""forge_pull_char.py (19 Nov 2026; copied from ubmids/costquest-renderer deploy/artist, 6f38739): a character PUBLISHED in the Forge -> the folder the game's install step takes.

  python3 forge_pull_char.py <name or element id> <out dir> [--api https://costquest-api...] [--key forge_mei]

The game's playable cast is baked into the app (app/game3d/tools/forge_chars/install.sh + chars.json in
ubmids/cosquest-merged: lod0/lod1 into cast/heroes/, clip library from the strict tear gate, pck re-export), while the
Forge catalogue (GET /v1/catalogue, public) feeds held items, opponents and allies at run time. This script is the
bridge between the two: it reads the public catalogue, takes the named character's published LODs (sha256 checked)
and writes <out>/lod0.glb, lod1.glb, lod2.glb and forge.json (element id, version, where it came from). Point the
character's "source" in chars.json at <out> and run install.sh <key>: install.sh copies a folder that already holds
lod0.glb and lod1.glb as it is and runs the same gate. Standard library only."""
import argparse
import hashlib
import json
import os
import sys
import urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("who")
ap.add_argument("out")
ap.add_argument("--api", default=os.environ.get("CQ_API", "https://costquest.204.168.162.79.sslip.io"))
a = ap.parse_args()
base = a.api.rstrip("/")


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"Cache-Control": "no-cache"}), timeout=120) as r:
        return r.read()


cat = json.loads(get(f"{base}/v1/catalogue?type=character"))["elements"]
hits = [e for e in cat if e.get("id") == a.who or (e.get("name") or "").lower() == a.who.lower()]
if not hits:
    sys.exit(f"no published character {a.who!r} in the catalogue ({', '.join(sorted(e.get('name', '?') for e in cat))})")
el = sorted(hits, key=lambda e: e.get("version", 0))[-1]
os.makedirs(a.out, exist_ok=True)
got = {}
for f in el.get("files") or []:
    if not f["file"].endswith(".glb"):
        continue
    blob = get(base + f["url"])
    if f.get("sha256") and hashlib.sha256(blob).hexdigest() != f["sha256"]:
        sys.exit(f"checksum mismatch on {f['file']}")
    dst = os.path.join(a.out, f"lod{f['lod']}.glb")
    open(dst, "wb").write(blob)
    got[f"lod{f['lod']}.glb"] = len(blob)
if "lod0.glb" not in got or "lod1.glb" not in got:
    sys.exit(f"the published files lack lod0/lod1: {sorted(got)}")
json.dump({"element_id": el.get("id"), "name": el.get("name"), "version": el.get("version"), "api": base,
           "rigged": el.get("rigged"), "files": got}, open(os.path.join(a.out, "forge.json"), "w"), indent=1)
print("PULLED", el.get("name"), el.get("id"), "v", el.get("version"), got)
