"""usdz.py: a USDZ beside every <name>__lod<n>.glb of a pack, for iOS (cq 239). Blender headless:

  blender -b --factory-startup --python usdz.py -- <pack dir> [<pack dir> ...]

The GLB is imported as it is (mesh, skin, textures) and exported with Blender's USD exporter,
textures packed in the .usdz. The pack's SHA256SUMS is rewritten."""
import hashlib
import os
import sys

import bpy

dirs = sys.argv[sys.argv.index("--") + 1:]
for d in dirs:
    for fn in sorted(os.listdir(d)):
        if not fn.endswith(".glb"):
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=os.path.join(d, fn))
        out = os.path.join(d, fn[:-4] + ".usdz")
        bpy.ops.wm.usd_export(filepath=out, export_textures=True, export_animation=False, selected_objects_only=False)
        print("CQUSDZ", out, os.path.getsize(out))
    with open(os.path.join(d, "SHA256SUMS"), "w") as f:
        for fn in sorted(os.listdir(d)):
            if fn != "SHA256SUMS":
                f.write("%s  %s\n" % (hashlib.sha256(open(os.path.join(d, fn), "rb").read()).hexdigest(), fn))
