"""fid29 heromaps: selected-to-active bakes in Blender (Cycles, CPU), from one or more textured source meshes onto a
target mesh with its own (new) UVs. Meshes come in as raw arrays (glTF frame and UV convention), so nothing is re-posed,
re-oriented or re-skinned; only images come out.

  blender -b --factory-startup --python bake_bl.py -- SPEC.json
SPEC: {"meshes": "in.npz",                      # src{k}_pos/_nrm/_uv/_idx, tgt_pos/_nrm/_uv/_idx
       "sources": [{"base": png, "orm": png|null, "normal": png|null, "emissive": png|null}, ...],
       "passes": {"base": [W, H, out.png], "orm": [...], "normal": [...], "emissive": [...]},
       "cage": 0.02, "maxdist": 0.04, "samples": 4, "margin": 16, "threads": 12}
Colour passes are emission bakes (no lighting): base colour sRGB in and out, data maps Non-Color in and out. The normal
pass is a tangent-space bake of the sources' shading normals (their own normal maps included) in the target's MikkTSpace
frame from its glTF normals and UVs: the frame Godot builds at load (GLTFDocument, generate tangents).
"""
import json, sys, time
import numpy as np
import bpy

spec = json.load(open(sys.argv[sys.argv.index('--') + 1]))
M = np.load(spec['meshes'])
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = int(spec.get('samples', 4))
sc.render.threads_mode = 'FIXED'
sc.render.threads = int(spec.get('threads', 12))
sc.view_settings.view_transform = 'Standard'
sc.render.bake.margin = int(spec.get('margin', 16))
sc.render.bake.margin_type = 'EXTEND'


def mesh(name, P, N, UV, I):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(P)); me.vertices.foreach_set('co', P.astype(np.float32).ravel())
    me.loops.add(len(I) * 3); me.loops.foreach_set('vertex_index', I.astype(np.int32).ravel())
    me.polygons.add(len(I))
    me.polygons.foreach_set('loop_start', np.arange(0, len(I) * 3, 3, dtype=np.int32))
    me.polygons.foreach_set('loop_total', np.full(len(I), 3, np.int32))
    me.polygons.foreach_set('use_smooth', np.ones(len(I), bool))
    me.update(calc_edges=True)
    uvl = me.uv_layers.new(name='UV')
    uv = UV.astype(np.float32).copy(); uv[:, 1] = 1.0 - uv[:, 1]          # glTF (top-left) -> Blender (bottom-left)
    uvl.data.foreach_set('uv', uv[I.reshape(-1)].ravel())
    n = N.astype(np.float32); n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-8)
    me.normals_split_custom_set_from_vertices([tuple(x) for x in n])
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    return ob


def img(path, data):
    if not path:
        return None
    im = bpy.data.images.load(path)
    im.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    return im


srcs = []
for k, s in enumerate(spec['sources']):
    ob = mesh('src%d' % k, M['src%d_pos' % k], M['src%d_nrm' % k], M['src%d_uv' % k], M['src%d_idx' % k])
    if int(s.get('subdiv', 0)) > 0:
        # a smooth high source (Catmull-Clark on the shipped triangles), for a normal map that takes the facets away
        md = ob.modifiers.new('sub', 'SUBSURF'); md.levels = md.render_levels = int(s['subdiv'])
        md.uv_smooth = 'PRESERVE_BOUNDARIES'
    mat = bpy.data.materials.new('srcmat%d' % k); mat.use_nodes = True
    nt = mat.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    emit = nt.nodes.new('ShaderNodeEmission')
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UV'
    tex = {}
    for key, data in (('base', False), ('orm', True), ('normal', True), ('emissive', False)):
        im = img(s.get(key), data)
        if im is None:
            continue
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = im; t.interpolation = 'Linear'; t.extension = 'EXTEND'
        nt.links.new(uvn.outputs['UV'], t.inputs['Vector'])
        tex[key] = t
    if 'normal' in tex:
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.space = 'TANGENT'; nm.uv_map = 'UV'
        nt.links.new(tex['normal'].outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    ob.data.materials.append(mat)
    srcs.append((ob, nt, out, bsdf, emit, tex))

tgt = mesh('target', M['tgt_pos'], M['tgt_nrm'], M['tgt_uv'], M['tgt_idx'])
tmat = bpy.data.materials.new('tgtmat'); tmat.use_nodes = True
tnt = tmat.node_tree
tnode = tnt.nodes.new('ShaderNodeTexImage')
tuv = tnt.nodes.new('ShaderNodeUVMap'); tuv.uv_map = 'UV'
tnt.links.new(tuv.outputs['UV'], tnode.inputs['Vector'])
tgt.data.materials.append(tmat)
tnt.nodes.active = tnode

for o in bpy.context.view_layer.objects:
    o.select_set(False)
for s in srcs:
    s[0].select_set(True)
tgt.select_set(True)
bpy.context.view_layer.objects.active = tgt

report = {}
for key, (w, h, outp) in spec['passes'].items():
    t0 = time.time()
    data = key in ('orm', 'normal', 'ao')
    im = bpy.data.images.new('bake_' + key, int(w), int(h), alpha=False, float_buffer=False)
    im.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    if key == 'normal':
        im.generated_color = (0.5, 0.5, 1.0, 1.0)
    tnode.image = im
    for ob, nt, out, bsdf, emit, tex in (srcs if key != 'ao' else []):
        for l in list(out.inputs['Surface'].links):
            nt.links.remove(l)
        if key == 'normal':
            nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
        else:
            src_key = key if key in tex else None
            if src_key:
                nt.links.new(tex[src_key].outputs['Color'], emit.inputs['Color'])
            else:
                emit.inputs['Color'].default_value = (1, 1, 1, 1) if key == 'cover' else ((0, 0, 0, 1) if key == 'emissive' else (0.5, 0.5, 0.5, 1))
                for l in list(emit.inputs['Color'].links):
                    nt.links.remove(l)
            emit.inputs['Strength'].default_value = 1.0
            nt.links.new(emit.outputs['Emission'], out.inputs['Surface'])
    kw = dict(type='NORMAL' if key == 'normal' else 'EMIT', use_selected_to_active=True, cage_extrusion=float(spec.get('cage', 0.02)),
              max_ray_distance=float(spec.get('maxdist', 0.04)), margin=int(spec.get('margin', 16)), use_clear=True)
    if key == 'ao':
        # ambient occlusion of the target itself, the sources standing by as occluders (head, hands, hair)
        for s_ in srcs:
            s_[0].select_set(False)
        sc.world = sc.world or bpy.data.worlds.new('w')
        sc.world.light_settings.distance = float(spec.get('ao_distance', 0.25))
        kw = dict(type='AO', use_selected_to_active=False, margin=int(spec.get('margin', 16)), use_clear=True)
    if key == 'normal':
        kw.update(normal_space='TANGENT', normal_r='POS_X', normal_g='POS_Y', normal_b='POS_Z')
    bpy.ops.object.bake(**kw)
    im.filepath_raw = outp
    im.file_format = 'PNG'
    im.save()
    report[key] = {'size': [int(w), int(h)], 'seconds': round(time.time() - t0, 1), 'out': outp}
    print('BAKE', key, json.dumps(report[key]), flush=True)
print('BAKEDONE', json.dumps(report), flush=True)
