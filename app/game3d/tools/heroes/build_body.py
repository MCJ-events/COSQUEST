"""fid29 heromaps: re-bake one hero's body maps onto its (repacked) body mesh.

  build_body.py --target T.glb --source S.glb --out OUT.glb --work DIR [--colour 2048] [--normal 2048] [--orm 1024]
                [--repack DIR/repack.npz] [--extra-source X.glb ...]
1. repack.py on the target body (geometry_0) at the colour size (or a given repack.npz);
2. Blender (bake_bl.py, Cycles CPU): colour, ORM, emissive and tangent-space normal from the source body (its own normal
   map included) onto the target body's new UVs; a "cover" pass finds texels no ray reached;
3. writes OUT.glb = the target with the body primitive re-indexed (vertices split along the new seams; every other
   attribute copied from the vertex it came from: same positions, normals, joints and weights) and the new maps (PNG).
Nothing else in the file changes. KTX2 encoding is a separate step (ktx_glb.py).
"""
import argparse, json, os, subprocess, sys, time
import numpy as np
from PIL import Image
from hglb import Glb
import repack as rp

BLENDER = os.environ.get('BLENDER', 'blender')
HERE = os.path.dirname(os.path.abspath(__file__))


def body_arrays(g, name='geometry_0'):
    mi, prim = g.find_prim(name)
    A = g.prim_arrays(prim)
    return mi, prim, A


def save_png(img, p):
    img.save(p, compress_level=3)
    return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--target', required=True); ap.add_argument('--source', required=True)
    ap.add_argument('--out', required=True); ap.add_argument('--work', required=True)
    ap.add_argument('--colour', type=int, default=2048); ap.add_argument('--normal', type=int, default=2048)
    ap.add_argument('--orm', type=int, default=1024); ap.add_argument('--emissive', type=int, default=256)
    ap.add_argument('--repack', default=None)
    ap.add_argument('--source-maps', default=None, help='json {base, orm, normal, emissive} png paths overriding the source GLB maps')
    ap.add_argument('--cage', type=float, default=0.012); ap.add_argument('--maxdist', type=float, default=0.03)
    ap.add_argument('--samples', type=int, default=4); ap.add_argument('--threads', type=int, default=12)
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    t0 = time.time()
    T, S = Glb(a.target), Glb(a.source)
    tmi, tprim, TA = body_arrays(T)
    smi, sprim, SA = body_arrays(S)
    st = {}
    if a.repack and os.path.exists(a.repack):
        R = dict(np.load(a.repack))
    else:
        R, st = rp.repack(T, 'geometry_0', a.colour)
        np.savez_compressed(os.path.join(a.work, 'repack.npz'), **R)
    print('REPACK', json.dumps(st), flush=True)
    vm, uv, ix = R['vmap'], R['uv'], R['idx']
    # source maps
    smaps = S.material_maps(sprim['material'])
    srcp = {}
    for k in ('base', 'orm', 'normal', 'emissive'):
        if k in smaps:
            srcp[k] = save_png(S.image(smaps[k]).convert('RGB'), os.path.join(a.work, 'src_%s.png' % k))
    if a.source_maps:
        srcp.update(json.load(open(a.source_maps)))
    np.savez(os.path.join(a.work, 'bake_in.npz'),
             src0_pos=SA['POSITION'], src0_nrm=SA['NORMAL'], src0_uv=SA['TEXCOORD_0'], src0_idx=SA['indices'],
             tgt_pos=TA['POSITION'][vm], tgt_nrm=TA['NORMAL'][vm], tgt_uv=uv, tgt_idx=ix)
    passes = {'base': [a.colour, a.colour, os.path.join(a.work, 'out_base.png')],
              'normal': [a.normal, a.normal, os.path.join(a.work, 'out_normal.png')],
              'orm': [a.orm, a.orm, os.path.join(a.work, 'out_orm.png')],
              'cover': [512, 512, os.path.join(a.work, 'out_cover.png')]}
    if 'emissive' in srcp:
        passes['emissive'] = [a.emissive, a.emissive, os.path.join(a.work, 'out_emissive.png')]
    spec = {'meshes': os.path.join(a.work, 'bake_in.npz'), 'sources': [srcp], 'passes': passes, 'cage': a.cage,
            'maxdist': a.maxdist, 'samples': a.samples, 'margin': 16, 'threads': a.threads}
    json.dump(spec, open(os.path.join(a.work, 'bake.json'), 'w'), indent=1)
    t1 = time.time()
    r = subprocess.run([BLENDER, '-b', '--factory-startup', '--python', os.path.join(HERE, 'bake_bl.py'), '--', os.path.join(a.work, 'bake.json')],
                       capture_output=True, text=True)
    open(os.path.join(a.work, 'blender.log'), 'w').write(r.stdout[-20000:] + r.stderr[-20000:])
    if 'BAKEDONE' not in r.stdout:
        raise SystemExit('bake failed, see %s/blender.log' % a.work)
    # coverage: texels of the target's islands no ray reached (cover pass is white where hit; islands from a raster)
    cov = np.asarray(Image.open(passes['cover'][2]).convert('L'), np.float32) / 255
    # assemble
    out = Glb(a.target)
    mi, prim = out.find_prim('geometry_0')
    arrays = {k: TA[k][vm] for k in prim['attributes']}
    arrays['TEXCOORD_0'] = uv
    arrays['indices'] = ix
    out.set_prim(prim, arrays)
    maps = out.material_maps(prim['material'])
    m = out.j['materials'][prim['material']]
    newimg = {k: Image.open(passes[k][2]).convert('RGB') for k in ('base', 'orm', 'normal') + (('emissive',) if 'emissive' in passes else ())}
    for k, im in newimg.items():
        if k in maps:
            out.set_image(maps[k], im)
        elif k == 'normal':
            m['normalTexture'] = {'index': out.add_image(im, 'body_normal')}
        elif k == 'orm':
            m.setdefault('pbrMetallicRoughness', {})['metallicRoughnessTexture'] = {'index': out.add_image(im, 'body_orm')}
    ex = m.setdefault('extras', {})
    ex['cq_heromaps'] = {'repack': st, 'bake': {'colour': a.colour, 'normal': a.normal, 'orm': a.orm, 'from': os.path.basename(a.source)}}
    out.save(a.out)
    res = {'out': a.out, 'repack': st, 'cover_black_share': round(float((cov < 0.5).mean()), 4), 'seconds': round(time.time() - t0, 1),
           'bake_seconds': round(time.time() - t1, 1), 'mib': round(os.path.getsize(a.out) / 1048576, 2)}
    json.dump(res, open(os.path.join(a.work, 'result.json'), 'w'), indent=1)
    print('RESULT', json.dumps(res), flush=True)


if __name__ == '__main__':
    main()
