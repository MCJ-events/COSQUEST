"""export_char.py (build 29 Forge characters, 18 Nov 2026): a finished Forge character (.blend with its Rig, as the
Forge artist's lift pipeline leaves it) as the two game files a faction hero ships, lod0 and lod1.

  blender -b <final.blend> --python export_char.py -- <out dir> [lod0_tris=50000] [lod1_tris=19000] [jpeg=86]
          [reskin=<base.blend>] [reskin_parts=Outfit,Boot_l,Boot_r]

The game loads hero files at run time with GLTFDocument (importer "keep"), whose materials read UV0 only. The lift
pipeline leaves base colour on a second UV set ("proj") for the Outfit and Body, beside normal and ORM maps on
"UVMap". So the projected colour is baked onto UVMap (Cycles EMIT bake) and "proj" is dropped; parts with only
"proj" (the lifted head, the boots) keep it as their one set. Then:
  lod0: every visible mesh, skin, face shape keys, textures capped per surface (Outfit colour and normal 2048, the
        rest 1024 or less), JPEG inside the GLB like the six faction heroes.
  lod1: the same meshes decimated to about lod1_tris in all (shape keys dropped first: the decimator cannot keep
        them), textures halved.
Prints EXPORT_DONE with triangle counts and file sizes. Never writes beside the source .blend."""
import bpy, os, sys, json

A = sys.argv[sys.argv.index("--") + 1:]
out = os.path.abspath(A[0]); os.makedirs(out, exist_ok=True)
opt = dict(x.split("=", 1) for x in A[1:])
LOD0 = int(opt.get("lod0_tris", 50000)); LOD1 = int(opt.get("lod1_tris", 19000)); JQ = int(opt.get("jpeg", 86))
CAP0 = {"geo_outfit": 2048, "geo_head": 1024, "geo_body": 1024}      # colour cap per surface on lod0 (others 512)
sc = bpy.context.scene
for im in bpy.data.images:
    if im.filepath:
        im.filepath = bpy.path.abspath(im.filepath)
meshes = [o for o in sc.objects if o.type == "MESH" and not o.hide_render]
rig = next(o for o in sc.objects if o.type == "ARMATURE")
for o in meshes + [rig]:
    o.hide_viewport = False; o.hide_select = False
    try:
        o.hide_set(False)
    except RuntimeError:
        pass


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def tex_nodes(m):
    return [n for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image] if m and m.use_nodes else []


def uv_of(m, n):
    for l in n.inputs["Vector"].links:
        return getattr(l.from_node, "uv_map", "")
    return ""


def bake_proj_to_uvmap(o):
    """Base colour sampled through 'proj' baked onto 'UVMap'; the material then reads the baked image on UVMap."""
    uvs = [u.name for u in o.data.uv_layers]
    if "proj" not in uvs or len(uvs) < 2:
        return None
    m = o.data.materials[0]
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    src = next((l.from_node for l in bsdf.inputs["Base Color"].links), None)
    if src is None:
        return None
    size = max(src.image.size[0], 1024) if src.image else 2048
    size = min(size, 2048)
    img = bpy.data.images.new("bake_" + o.name, size, size, alpha=False)
    img.colorspace_settings.name = "sRGB"
    tgt = nt.nodes.new("ShaderNodeTexImage"); tgt.image = img
    uvn = nt.nodes.new("ShaderNodeUVMap"); uvn.uv_map = [u for u in uvs if u != "proj"][0]
    nt.links.new(uvn.outputs["UV"], tgt.inputs["Vector"])
    out_n = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    old_surf = out_n.inputs["Surface"].links[0].from_socket
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(src.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out_n.inputs["Surface"])
    for n in nt.nodes:
        n.select = False
    tgt.select = True; nt.nodes.active = tgt
    o.data.uv_layers.active = o.data.uv_layers[uvn.uv_map]
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
    sc.render.engine = "CYCLES"; sc.cycles.samples = 1; sc.cycles.device = "CPU"
    sc.render.bake.margin = 8; sc.render.bake.use_clear = True; sc.render.bake.use_selected_to_active = False; sc.render.bake.target = "IMAGE_TEXTURES"
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o], selected_editable_objects=[o]):
        bpy.ops.object.bake(type="EMIT")
    # restore the surface, colour now from the baked image on UVMap
    nt.links.new(old_surf, out_n.inputs["Surface"]); nt.nodes.remove(em)
    nt.links.new(tgt.outputs["Color"], bsdf.inputs["Base Color"])
    nt.nodes.remove(src)
    img.pack()
    o.data.uv_layers.remove(o.data.uv_layers["proj"])
    return img.name


def cap_images(scale_div, caps):
    """Scale every image used by the meshes so its long side is at most its surface's cap (divided by scale_div)."""
    done = {}
    for o in meshes:
        for m in o.data.materials:
            for n in tex_nodes(m):
                im = n.image
                is_colour = any(l.to_socket.name == "Base Color" for s in n.outputs for l in s.links)
                cap = caps.get(o.name, 512) if is_colour else (2048 if (o.name == "geo_outfit" and n.outputs[0].links and n.outputs[0].links[0].to_node.type == "NORMAL_MAP") else min(caps.get(o.name, 512), 1024))
                cap = max(256, cap // scale_div)
                key = im.name
                if key in done:
                    continue
                w, h = im.size
                if max(w, h) > cap:
                    if im.packed_file is None and im.filepath and os.path.exists(im.filepath):
                        im.reload()
                    im.scale(int(w * cap / max(w, h)), int(h * cap / max(w, h)))
                done[key] = cap


def export(path):
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    for o in meshes:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_skins=True,
                              export_morph=True, export_morph_normal=False, export_animations=False, export_apply=False,
                              export_image_format="JPEG", export_jpeg_quality=JQ, export_yup=True)


def drop_emission_if_black():
    for o in meshes:
        for m in o.data.materials:
            for n in tex_nodes(m):
                if any(l.to_socket.name.startswith("Emission") for s in n.outputs for l in s.links):
                    import numpy as np
                    a = np.empty(len(n.image.pixels), dtype=np.float32); n.image.pixels.foreach_get(a)
                    px = a.reshape(-1, 4)[:, :3]
                    if px.size == 0 or float(px.max()) < 0.02:
                        for s in n.outputs:
                            for l in list(s.links):
                                m.node_tree.links.remove(l)


def reskin(base_blend, names):
    """Skin weights for the garment parts taken again from the clean MPFB2 base body (base.blend's "Body", the same
    rig and fit): nearest-face interpolated, 4 influences, normalised, smoothed twice. The lift pipeline's own garment
    weights bleed where the arms-down rest pose puts a hand against a hip pouch, and tear in nearly every clip."""
    with bpy.data.libraries.load(base_blend, link=False) as (src, dst):
        dst.objects = ["Body"]
    sb = dst.objects[0]; sb.name = "SkinSrc"; sc.collection.objects.link(sb)
    sb.matrix_world = next(o for o in meshes if o.name == "Body").matrix_world.copy() if any(o.name == "Body" for o in meshes) else sb.matrix_world
    if sb.data.shape_keys:
        bpy.context.view_layer.objects.active = sb; bpy.ops.object.select_all(action="DESELECT"); sb.select_set(True)
        bpy.ops.object.shape_key_remove(all=True)
    for m in list(sb.modifiers):
        sb.modifiers.remove(m)
    done = []
    for o in meshes:
        if o.name not in names:
            continue
        tmp = bpy.data.objects.new("tmp_" + o.name, o.data.copy()); sc.collection.objects.link(tmp)
        tmp.matrix_world = o.matrix_world.copy()
        if tmp.data.shape_keys:
            bpy.context.view_layer.objects.active = tmp; bpy.ops.object.select_all(action="DESELECT"); tmp.select_set(True)
            bpy.ops.object.shape_key_remove(all=True)
        tmp.vertex_groups.clear()
        for g in sb.vertex_groups:
            tmp.vertex_groups.new(name=g.name)
        d = tmp.modifiers.new("dt", "DATA_TRANSFER"); d.object = sb; d.use_object_transform = True
        d.use_vert_data = True; d.data_types_verts = {"VGROUP_WEIGHTS"}; d.vert_mapping = "POLYINTERP_NEAREST"
        d.layers_vgroup_select_src = "ALL"; d.layers_vgroup_select_dst = "NAME"
        bpy.ops.object.select_all(action="DESELECT"); tmp.select_set(True); bpy.context.view_layer.objects.active = tmp
        bpy.ops.object.modifier_apply(modifier="dt")
        bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
        bpy.ops.object.vertex_group_smooth(group_select_mode="ALL", factor=0.5, repeat=2)
        bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
        bpy.ops.object.mode_set(mode="OBJECT")
        # back onto the real object by vertex index (its shape keys stay)
        o.vertex_groups.clear()
        for g in tmp.vertex_groups:
            o.vertex_groups.new(name=g.name)
        for v in tmp.data.vertices:
            for ge in v.groups:
                if ge.weight > 1e-4:
                    o.vertex_groups[tmp.vertex_groups[ge.group].name].add([v.index], ge.weight, "REPLACE")
        bpy.data.objects.remove(tmp)
        done.append(o.name)
    bpy.data.objects.remove(sb)
    return done


def merge_fingers():
    """The game's clip libraries carry the 25-bone humanoid skeleton (tools/anim/add_hero.sh): no finger bones.
    Finger weights go to their hand, then the finger bones are removed, so the hand moves as one piece (the clips
    never animate fingers, so this is how they already looked in the game)."""
    fingers = [b.name for b in rig.data.bones if "Hand" in b.name and not b.name.endswith("Hand")]
    for o in meshes:
        vg = o.vertex_groups
        for f in fingers:
            if f not in vg:
                continue
            hand = ("Left" if f.startswith("Left") else "Right") + "Hand"
            h = vg.get(hand) or vg.new(name=hand)
            gi = vg[f].index
            for v in o.data.vertices:
                for g in v.groups:
                    if g.group == gi and g.weight > 0:
                        h.add([v.index], g.weight, "ADD")
            vg.remove(vg[f])
    bpy.ops.object.select_all(action="DESELECT"); rig.select_set(True); bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for f in fingers:
        eb = rig.data.edit_bones.get(f)
        if eb:
            rig.data.edit_bones.remove(eb)
    bpy.ops.object.mode_set(mode="OBJECT")
    return len(fingers)


baked = [bake_proj_to_uvmap(o) for o in meshes]
reskinned = reskin(opt["reskin"], opt.get("reskin_parts", "Outfit,Boot_l,Boot_r").split(",")) if opt.get("reskin") else []
n_fingers = merge_fingers()
# mesh nodes never share a bone's name (the lifted head object is "Head", like the bone; the clip retarget and the
# game's skeleton lookups find nodes by name)
for o in meshes:
    o.name = "geo_" + o.name.lower()
# face shape keys only where the face is (the lifted head); the trimmed body under the clothes keeps none
for o in meshes:
    if o.name != "geo_head" and o.data.shape_keys:
        bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.shape_key_remove(all=True)
drop_emission_if_black()
rep = {"source": bpy.data.filepath, "baked": [b for b in baked if b], "finger_bones_merged": n_fingers, "reskinned": reskinned,
       "bones": len(rig.data.bones)}
t0 = sum(tri_count(o) for o in meshes)
if t0 > LOD0:
    for o in meshes:
        if o.data.shape_keys is None:
            d = o.modifiers.new("dec", "DECIMATE"); d.ratio = LOD0 / t0
            bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier="dec")
cap_images(1, CAP0)
p0 = os.path.join(out, "lod0.glb"); export(p0)
rep["lod0"] = {"tris": sum(tri_count(o) for o in meshes), "bytes": os.path.getsize(p0)}
# lod1
t = sum(tri_count(o) for o in meshes)
for o in meshes:
    bpy.context.view_layer.objects.active = o
    if o.data.shape_keys:
        bpy.ops.object.select_all(action="DESELECT"); o.select_set(True)
        o.active_shape_key_index = 0
        bpy.ops.object.shape_key_remove(all=True)
    d = o.modifiers.new("dec", "DECIMATE"); d.ratio = min(1.0, LOD1 / t)
    bpy.ops.object.modifier_apply(modifier="dec")
cap_images(2, CAP0)
p1 = os.path.join(out, "lod1.glb"); export(p1)
rep["lod1"] = {"tris": sum(tri_count(o) for o in meshes), "bytes": os.path.getsize(p1)}
json.dump(rep, open(os.path.join(out, "export.json"), "w"), indent=1)
print("EXPORT_DONE", json.dumps(rep))
