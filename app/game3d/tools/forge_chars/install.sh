#!/usr/bin/env bash
# install.sh <key> [--force]: build one Forge character into the game from chars.json (build 29, 18 Nov 2026).
#   Run from anywhere on the farm, inside this checkout. Heavy steps run under choom -n 500 and nice.
#   1. source .blend -> lod0.glb + lod1.glb (export_char.py: proj colour baked onto UV0, fingers merged into the
#      hands, JPEG maps), or a folder that already holds lod0.glb and lod1.glb;
#   2. tools/anim/add_hero.sh <key> (clip library, anim_clips.json, attach.json, report; the strict tear gate);
#   3. only if the gate gave the character its clips: copies the two files to cast/heroes/<key>_lod{0,1}.glb with
#      "keep" import files (loaded at run time like the faction heroes).
# A character that fails the gate is reported and NOT copied (--force copies anyway; never for a release).
# After it: run the Godot tests (tests/hero_cast_test.gd), add the key to fight.gd FORGE_CAST and
# features/waleui/characters.ts if it is new, re-export the pck (app/scripts/godot-export.sh ios).
set -euo pipefail
key=$1; force=${2:-}
HERE=$(cd "$(dirname "$0")" && pwd); GAME=$(cd "$HERE/../.." && pwd)
W=${FORGE_CHARS_WORK:-$HOME/cq-work/forge-chars-29}
BL=${BL:-$HOME/forge/blender/blender}
read -r src exp < <(python3 - "$HERE/chars.json" "$key" <<'PY'
import json, os, sys
c = json.load(open(sys.argv[1]))["characters"][sys.argv[2]]
print(os.path.expanduser(c["source"]), c.get("export", ""))
PY
)
out=$W/out/$key; mkdir -p "$out"
if [ -d "$src" ]; then
  cp "$src/lod0.glb" "$src/lod1.glb" "$out/"
else
  ( cd "$out" && choom -n 500 -- nice -n 10 "$BL" -b "$src" --python "$HERE/export_char.py" -- . $exp > export.log 2>&1 )
  grep -o "EXPORT_DONE.*" "$out/export.log" || { echo "export failed: $out/export.log" >&2; exit 2; }
fi
cd "$GAME"
export HERO_CAST=$W/cast HERO_OUT=$W/sidecar
choom -n 500 -- bash tools/anim/add_hero.sh "$key" "$out" --no-pack | tee "$W/add_$key.log"
status=$(python3 -c "import json;print(json.load(open('data/anim_clips.json'))['characters'].get('$key',{}).get('status',''))")
if [ "$status" != "clips" ] && [ "$force" != "--force" ]; then
  echo "NOT INSTALLED $key: status=$status (see $W/add_$key.log)"; exit 3
fi
for l in 0 1; do
  cp "$out/lod$l.glb" "cast/heroes/${key}_lod$l.glb"
  printf '[remap]\n\nimporter="keep"\n' > "cast/heroes/${key}_lod$l.glb.import"
done
echo "INSTALLED $key: $(ls -l cast/heroes/${key}_lod0.glb cast/heroes/${key}_lod1.glb | awk '{print $5}' | tr '\n' ' ')"
