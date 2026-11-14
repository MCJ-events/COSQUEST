# fid29-dressing: a London plane (Platanus x hispanica) street tree, our own procedural model (own work, CC0):
# a mottled trunk forking at ~3 m into 4 to 5 upward-spreading limbs, three more forks to the twigs, and leaf-cluster
# cards (ambientCG LeafSet027 leaves, make_atlas.py) on the twigs, their normals bent out from the crown so the crown
# shades as one volume. Outputs:
#   plane_lod0.glb   bark (UVs in the prop atlas's bark cell) + leaves (UV 0..1 of plane_leaves_<tier>.png): 3k-6k tris
#   plane_imp.glb    the mid tier's impostor: 3 crossed cards (UV 0..1 of plane_imp.png)
#   plane_imp.png    the impostor's texture: the LOD0 tree rendered with Cycles (CPU), 2 views side by side
#   blender -b --factory-startup -P tree_blender.py -- <atlas_dir> <acg_dir> <out_dir>
import bpy, bmesh, sys, os, json, math, random
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
ATLAS, ACG, OUT = argv[0], argv[1], argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
L = json.load(open(os.path.join(HERE, "atlas_layout.json")))
os.makedirs(OUT, exist_ok=True)
G = float(L["grid"])
bx, by, bs = L["kinds"]["bark"]["cell"]
BARK = (bx / G, by / G, bs / G)  # top-left origin
rnd = random.Random(1906)

H_TRUNK = 3.1
CARD = 1.5          # leaf card side (m): capped so the crown's overdraw stays near 3 layers
N_CARDS = 380


def perp(d):
    a = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    u = d.cross(a).normalized()
    return u, d.cross(u).normalized()


bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UV")
bark_faces, leaf_faces = [], []
tips = []


def tube(a, b, r0, r1, sides, v0):
    d = (b - a)
    ln = d.length
    d.normalize()
    u, w = perp(d)
    ring = []
    for end, r in ((a, r0), (b, r1)):
        ring.append([bm.verts.new(end + (u * math.cos(t) + w * math.sin(t)) * r)
                     for t in [2 * math.pi * i / sides for i in range(sides)]])
    v1 = min(1.0, v0 + ln / 5.0)
    for i in range(sides):
        j = (i + 1) % sides
        f = bm.faces.new((ring[0][i], ring[0][j], ring[1][j], ring[1][i]))
        for loop, (uu, vv) in zip(f.loops, ((i / sides, v0), ((i + 1) / sides, v0), ((i + 1) / sides, v1), (i / sides, v1))):
            # bark cell of the atlas (Blender v up; the glTF export flips it)
            loop[uvl].uv = (BARK[0] + uu * BARK[2], 1.0 - BARK[1] - BARK[2] + vv * BARK[2])
        bark_faces.append(f)
    return v1 if v1 < 1.0 else 0.0


def branch(a, d, ln, r, depth, v0):
    # bend: a plane's limbs rise then arch out
    pts = [a]
    segs = 3 if depth < 2 else (2 if depth < 4 else 1)
    dd = d.copy()
    for s in range(segs):
        dd = (dd + Vector((rnd.uniform(-.14, .14), rnd.uniform(-.14, .14), rnd.uniform(-.04, .1) - 0.03 * depth))).normalized()
        pts.append(pts[-1] + dd * (ln / segs))
    rr = [r * (1 - 0.35 * i / segs) for i in range(segs + 1)]
    sides = 7 if depth == 0 else (5 if depth < 2 else (4 if depth < 4 else 3))
    v = v0
    for i in range(segs):
        v = tube(pts[i], pts[i + 1], rr[i], rr[i + 1], sides, v)
    end = pts[-1]
    if depth >= 4:
        tips.append((end, dd))
        tips.append((pts[-2].lerp(end, 0.4), dd))
        return
    n = 3 if depth == 0 else 2
    for k in range(n):
        u, w = perp(dd)
        ang = rnd.uniform(0, 2 * math.pi)
        spread = math.radians(rnd.uniform(18, 32))
        nd = (dd * math.cos(spread) + (u * math.cos(ang) + w * math.sin(ang)) * math.sin(spread)).normalized()
        nd.z = max(nd.z, 0.15)
        branch(pts[-1] if k == 0 else pts[-2].lerp(end, 0.6), nd.normalized(), ln * rnd.uniform(0.62, 0.78), rr[-1] * 0.8, depth + 1, 0.0)


# trunk (slight lean), then 4-5 limbs from the fork
lean = Vector((rnd.uniform(-.06, .06), rnd.uniform(-.06, .06), 1)).normalized()
top = lean * H_TRUNK
tube(Vector((0, 0, 0)), lean * 1.2, 0.34, 0.27, 9, 0.0)
tube(lean * 1.2, top, 0.27, 0.22, 9, 0.24)
nl = 4
for i in range(nl):
    az = 2 * math.pi * (i + rnd.uniform(-.2, .2)) / nl
    el = math.radians(rnd.uniform(62, 74))
    d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
    branch(top - lean * rnd.uniform(0, .5), d, rnd.uniform(4.2, 5.2), 0.16, 0, 0.0)

# leaf cards on the tips, the crown capped by count (N_CARDS) and card size (CARD)
lo = Vector((min(t[0].x for t in tips), min(t[0].y for t in tips), min(t[0].z for t in tips)))
hi = Vector((max(t[0].x for t in tips), max(t[0].y for t in tips), max(t[0].z for t in tips)))
ctr = (lo + hi) / 2
ctr.z -= 0.6
rad = Vector(((hi.x - lo.x) / 2 + 0.6, (hi.y - lo.y) / 2 + 0.6, (hi.z - lo.z) / 2 + 1.0))
ctr = (lo + hi) / 2
spots = [t[0] for t in tips]
rnd.shuffle(spots)
spots = spots[:N_CARDS // 2]
while len(spots) < N_CARDS:
    d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1))).normalized()
    r = rnd.uniform(0.55, 1.0)
    q = ctr + Vector((d.x * rad.x, d.y * rad.y, d.z * rad.z)) * r
    if q.z > H_TRUNK + 1.6:
        spots.append(q)
leaf_normals = []
for p in spots:
    out = Vector(((p - ctr).x / rad.x, (p - ctr).y / rad.y, (p - ctr).z / rad.z)).normalized()
    nrm = (out + Vector((rnd.uniform(-.5, .5), rnd.uniform(-.5, .5), rnd.uniform(-.2, .5)))).normalized()
    u, w = perp(nrm)
    rot = rnd.uniform(0, 2 * math.pi)
    u, w = u * math.cos(rot) + w * math.sin(rot), -u * math.sin(rot) + w * math.cos(rot)
    s = CARD * rnd.uniform(0.85, 1.15) / 2
    c = p + out * 0.2
    vs = [bm.verts.new(c + (u * x + w * y) * s) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    f = bm.faces.new(vs)
    for loop, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uvl].uv = uv
    f.material_index = 1
    leaf_faces.append(f)
    leaf_normals.append([(Vector(((v.co - ctr).x / rad.x, (v.co - ctr).y / rad.y, (v.co - ctr).z / rad.z)).normalized() + Vector((0, 0, 0.3))).normalized() for v in vs])

me = bpy.data.meshes.new("plane")
bm.to_mesh(me)
bm.free()
ob = bpy.data.objects.new("plane", me)
bpy.context.scene.collection.objects.link(ob)
mb = bpy.data.materials.new("bark")
ml = bpy.data.materials.new("leaves")
me.materials.append(mb)
me.materials.append(ml)
# custom normals: bark smooth, leaves the crown volume
loops_n = []
li = 0
leaf_i = 0
for poly in me.polygons:
    if poly.material_index == 1:
        ns = leaf_normals[leaf_i]
        leaf_i += 1
        for k in range(poly.loop_total):
            loops_n.append(ns[k])
    else:
        for vi in poly.vertices:
            loops_n.append(me.vertices[vi].normal.copy())
me.normals_split_custom_set(loops_n)
for poly in me.polygons:
    poly.use_smooth = True
me.calc_loop_triangles()
tris = len(me.loop_triangles)
nb = sum(1 for t in me.loop_triangles if me.polygons[t.polygon_index].material_index == 0)
dims = [round(x, 2) for x in ob.dimensions]
print("TREE lod0 tris %d (bark %d, leaves %d), cards %d, size %s" % (tris, nb, tris - nb, len(leaf_faces), dims), flush=True)
bpy.ops.object.select_all(action="DESELECT")
ob.select_set(True)
bpy.context.view_layer.objects.active = ob
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "plane_lod0.glb"), export_format="GLB", use_selection=True,
                          export_materials="PLACEHOLDER", export_normals=True, export_texcoords=True,
                          export_vertex_color="NONE", export_yup=True)

# ---- impostor: render the tree from two sides with Cycles (CPU), transparent film
sc = bpy.context.scene
for o in [o for o in sc.objects if o.name.startswith("Cube")]:
    bpy.data.objects.remove(o)
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = 48
sc.render.film_transparent = True
sc.render.resolution_x = 512
sc.render.resolution_y = 512
sc.view_settings.view_transform = "Standard"


def tex_mat(m, img, alpha):
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(img)
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.8
    if alpha:
        nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
        m.blend_method = "CLIP" if hasattr(m, "blend_method") else None
    return t


tex_mat(ml, os.path.join(ATLAS, "plane_leaves_high.png"), True)
# the bark straight from the prop atlas (its UVs already point into the bark cell)
tex_mat(mb, os.path.join(ATLAS, "props_high_a.png"), False)
w = bpy.data.worlds.new("w")
w.use_nodes = True
w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.75, 0.8, 0.9, 1)
w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
sc.world = w
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 2.2
sun.rotation_euler = (math.radians(35), 0, math.radians(30))
sc.collection.objects.link(sun)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
size = max(ob.dimensions.x, ob.dimensions.y, ob.dimensions.z) * 1.04
cam.data.ortho_scale = size
sc.collection.objects.link(cam)
sc.camera = cam
bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
zc = size / 2
xc = (min(v.x for v in bb) + max(v.x for v in bb)) / 2
yc = (min(v.y for v in bb) + max(v.y for v in bb)) / 2
views = []
for k, az in enumerate((0.0, 90.0)):
    a = math.radians(az)
    cam.location = (xc + 40 * math.sin(a), yc - 40 * math.cos(a), zc)
    cam.rotation_euler = (math.radians(90), 0, a)
    sc.render.filepath = os.path.join(OUT, "imp_%d.png" % k)
    bpy.ops.render.render(write_still=True)
    views.append(sc.render.filepath)
print("TREE impostor size %.2f centre %.2f %.2f" % (size, xc, yc), flush=True)
json.dump({"size": size, "xc": xc, "yc": yc, "tris": tris, "bark_tris": nb, "cards": len(leaf_faces), "dims": dims},
          open(os.path.join(OUT, "plane.json"), "w"))

# impostor mesh: 2 crossed vertical cards (view 0 on the x-z plane, view 1 on the y-z plane), each half of the texture
bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UV")
h = size
for k in range(2):
    a = math.radians(90.0 * k)
    ax = Vector((math.cos(a), math.sin(a), 0))
    c = Vector((xc, yc, 0))
    vs = [bm.verts.new(c + ax * x * h / 2 + Vector((0, 0, z * h))) for x, z in ((-1, 0), (1, 0), (1, 1), (-1, 1))]
    f = bm.faces.new(vs)
    for loop, (uu, vv) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uvl].uv = (k * 0.5 + uu * 0.5, vv)
me2 = bpy.data.meshes.new("imp")
bm.to_mesh(me2)
ob2 = bpy.data.objects.new("imp", me2)
sc.collection.objects.link(ob2)
bpy.ops.object.select_all(action="DESELECT")
ob2.select_set(True)
bpy.context.view_layer.objects.active = ob2
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "plane_imp.glb"), export_format="GLB", use_selection=True,
                          export_materials="NONE", export_normals=True, export_texcoords=True, export_yup=True)
print("TREE_DONE", flush=True)
