# fid29-dressing: Poly Haven street props -> two decimated LODs per kind, UVs moved into the shared prop atlas.
# Blender 4.5, CPU only, headless:
#   blender -b --factory-startup -P props_blender.py -- <ph_dir> <out_dir>
# One glb per kind and LOD (positions in metres, base centre at the origin, front +z), no materials: the atlas
# material is set in the game. Layout and caps: atlas_layout.json (shared with make_atlas.py and the game).
import bpy, bmesh, sys, os, json, glob, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
PH, OUT = argv[0], argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
L = json.load(open(os.path.join(HERE, "atlas_layout.json")))
os.makedirs(OUT, exist_ok=True)
GRID = float(L["grid"])  # cells per side


def cell_rect(c):
    # [x, y, size] in grid units, top-left origin -> normalised (X, Y, W, H)
    return (c[0] / GRID, c[1] / GRID, c[2] / GRID, c[2] / GRID)


def remap_uv(me, rects_by_mat, swatch_by_mat):
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        mi = poly.material_index
        for li in poly.loop_indices:
            if mi in swatch_by_mat:
                uv[li].uv = swatch_by_mat[mi]
                continue
            X, Y, W, H = rects_by_mat[mi]
            u, v = uv[li].uv
            u = min(max(u, 0.0), 1.0)
            v = min(max(v, 0.0), 1.0)
            # glTF flips v (top-left origin); the atlas is top-left too
            uv[li].uv = (X + u * W, 1.0 - Y - H + v * H)


def tri_count(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


def decimate_to(o, cap):
    n = tri_count(o)
    if n <= cap:
        return n
    for _ in range(4):
        m = o.modifiers.new("dec", "DECIMATE")
        m.decimate_type = "COLLAPSE"
        m.ratio = max(0.01, cap / float(tri_count(o)) * 0.98)
        m.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=m.name)
        if tri_count(o) <= cap:
            break
    return tri_count(o)


def export(o, path):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_materials="NONE",
                              export_normals=True, export_texcoords=True, export_tangents=False,
                              export_vertex_color="NONE", export_apply=True, export_yup=True)


report = {}
for kind, k in L["kinds"].items():
    if k.get("src") is None:
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    src = glob.glob(os.path.join(PH, k["src"], "*.gltf"))[0]
    bpy.ops.import_scene.gltf(filepath=src)
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH" and "graffiti" not in o.name]
    for o in [o for o in bpy.context.scene.objects if o.type == "MESH" and "graffiti" in o.name]:
        bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    # unparent (glTF import may leave empties): bake the world matrix
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    me = o.data
    # base centre at the origin, scaled to the kind's real height when given
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
    c = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)))
    s = float(k.get("height_m", 0)) / (max(zs) - min(zs)) if k.get("height_m") else 1.0
    yaw = math.radians(float(k.get("yaw_deg", 0)))
    for v in me.vertices:
        p = (v.co - c) * s
        v.co = Vector((p.x * math.cos(yaw) - p.y * math.sin(yaw), p.x * math.sin(yaw) + p.y * math.cos(yaw), p.z))
    me.update()
    # materials -> atlas rects (a cell split in columns, one per textured material) and swatches
    rects, sw = {}, {}
    tex_mats = [m for m in k["mats"] if m not in k.get("swatch", {})]
    X, Y, W, H = cell_rect(k["cell"])
    for i, slot in enumerate(o.material_slots):
        name = slot.material.name if slot.material else ""
        base = name.split(".")[0]
        if base in k.get("swatch", {}):
            sx, sy = L["swatch"][k["swatch"][base]]
            sw[i] = (sx, 1.0 - sy)
        else:
            j = tex_mats.index(base) if base in tex_mats else 0
            rects[i] = (X + W * j / len(tex_mats), Y, W / len(tex_mats), H)
    remap_uv(me, rects, sw)
    o.data.materials.clear()
    n0 = tri_count(o)
    lod0 = decimate_to(o, int(k["cap0"]))
    # merge duplicate verts left by the scan, so LOD1 collapses evenly (UV seams kept by the decimator)
    export(o, os.path.join(OUT, "%s_lod0.glb" % kind))
    lod1 = decimate_to(o, int(k["cap1"]))
    export(o, os.path.join(OUT, "%s_lod1.glb" % kind))
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
    report[kind] = {"src_tris": n0, "lod0": lod0, "lod1": lod1,
                    "size_m": [round(max(xs) - min(xs), 2), round(max(zs) - min(zs), 2), round(max(ys) - min(ys), 2)]}
    print("PROPS", kind, report[kind], flush=True)
json.dump(report, open(os.path.join(OUT, "props_report.json"), "w"), indent=1)
print("PROPS_DONE", flush=True)
