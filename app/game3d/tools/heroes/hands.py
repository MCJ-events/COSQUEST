"""fid29 heromaps: the hands get their own map. The MakeHuman (CC0) hands sat in a corner of a full-body layout (4.5 % of
their map); here they are unwrapped on their own (xatlas, MIT) to fill the square, the existing hand colour is baked
across (Blender Cycles CPU, same mesh), and a normal map is baked from the same hands subdivided twice (Catmull-Clark:
the facets of the shipped triangles go) plus a fine procedural skin grain on bare hands (not on gloves). Same mesh,
same rig, same weights: only the UVs (vertices split along the new seams) and the maps change.

usage: hands.py IN.glb OUT.glb --size 1024 --work DIR
"""
import argparse, json, os, subprocess, sys, time
import numpy as np
from PIL import Image
from hglb import Glb
import repack as rp

HERE = os.path.dirname(os.path.abspath(__file__))


def grain(size, seed=3, cells=(64, 128), amp=(0.6, 0.4)):
    """tileable value-noise height (smooth cubic interpolation of random lattices), 0-mean"""
    rng = np.random.default_rng(seed)
    h = np.zeros((size, size), np.float32)
    for c, a in zip(cells, amp):
        lat = rng.standard_normal((c, c)).astype(np.float32)
        x = np.arange(size) * c / size
        i0 = np.floor(x).astype(int) % c; i1 = (i0 + 1) % c; f = x - np.floor(x); f = f * f * (3 - 2 * f)
        row = lat[:, i0] * (1 - f) + lat[:, i1] * f
        h += a * (row[i0, :] * (1 - f)[:, None] + row[i1, :] * f[:, None])
    return h - h.mean()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('dst'); ap.add_argument('--size', type=int, default=1024)
    ap.add_argument('--work', required=True); ap.add_argument('--grain', type=float, default=0.12)
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    t0 = time.time()
    g = Glb(a.src)
    names = [me.get('name') for me in g.j['meshes']]
    if 'hands' not in names:
        g.save(a.dst)
        print(json.dumps({'src': os.path.basename(a.src), 'hands': False}))
        return
    mi, prim = g.find_prim('hands')
    A = g.prim_arrays(prim)
    R, st = rp.repack(g, 'hands', a.size, padding=4, all_seen=True)
    vm, uv, ix = R['vmap'], R['uv'], R['idx']
    mat = g.j['materials'][prim['material']]
    surf = str((mat.get('extras') or {}).get('cq_surface', 'skin'))
    maps = g.material_maps(prim['material'])
    srcp = os.path.join(a.work, 'src_base.png')
    g.image(maps['base']).convert('RGB').save(srcp)
    np.savez(os.path.join(a.work, 'in.npz'), src0_pos=A['POSITION'], src0_nrm=A['NORMAL'], src0_uv=A['TEXCOORD_0'], src0_idx=A['indices'],
             tgt_pos=A['POSITION'][vm], tgt_nrm=A['NORMAL'][vm], tgt_uv=uv, tgt_idx=ix)
    outs = {}
    for name, srcs, passes in (('colour', [{'base': srcp}], {'base': [a.size, a.size, os.path.join(a.work, 'base.png')]}),
                               ('normal', [{'subdiv': 2}], {'normal': [a.size, a.size, os.path.join(a.work, 'normal.png')]})):
        spec = {'meshes': os.path.join(a.work, 'in.npz'), 'sources': srcs, 'passes': passes, 'cage': 0.004, 'maxdist': 0.01,
                'samples': 4, 'margin': 8, 'threads': 12}
        sp = os.path.join(a.work, name + '.json'); json.dump(spec, open(sp, 'w'))
        r = subprocess.run([os.environ.get('BLENDER', 'blender'), '-b', '--factory-startup', '--python', os.path.join(HERE, 'bake_bl.py'), '--', sp],
                           capture_output=True, text=True)
        open(os.path.join(a.work, name + '.log'), 'w').write(r.stdout[-6000:] + r.stderr[-6000:])
        if 'BAKEDONE' not in r.stdout:
            raise SystemExit('hands bake failed: ' + name)
    base = Image.open(os.path.join(a.work, 'base.png')).convert('RGB')
    nrm = np.asarray(Image.open(os.path.join(a.work, 'normal.png')).convert('RGB'), np.float32) / 255 * 2 - 1
    # a ray that met the wrong finger (webs, tips) bends the normal past 55 deg: those texels fall back to flat
    bad = nrm[..., 2] < 0.57
    nrm[bad] = np.array([0, 0, 1.0], np.float32)
    if surf == 'skin' and a.grain > 0:
        h = grain(a.size)
        gy, gx = np.gradient(h)
        d = np.stack([-gx * a.grain * 6, gy * a.grain * 6, np.ones_like(h)], 2)     # +Y up (glTF), image rows go down
        d /= np.linalg.norm(d, axis=2, keepdims=True)
        # whiteout blend
        n = np.stack([nrm[..., 0] + d[..., 0], nrm[..., 1] + d[..., 1], nrm[..., 2] * d[..., 2]], 2)
        nrm = n / np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-6)
    nimg = Image.fromarray(((nrm * 0.5 + 0.5) * 255 + 0.5).clip(0, 255).astype(np.uint8))
    arrays = {k: A[k][vm] for k in prim['attributes']}
    arrays['TEXCOORD_0'] = uv; arrays['indices'] = ix
    g.set_prim(prim, arrays)
    g.set_image(maps['base'], base)
    if 'normal' in maps:
        g.set_image(maps['normal'], nimg)
    else:
        mat['normalTexture'] = {'index': g.add_image(nimg, 'hands_normal')}
    mat.setdefault('extras', {})['cq_heromaps'] = {'hands': {'size': a.size, 'repack': st, 'normal': 'subdiv 2 + grain %.2f' % (a.grain if surf == 'skin' else 0)}}
    g.save(a.dst)
    print(json.dumps({'src': os.path.basename(a.src), 'hands': True, 'surface': surf, 'fill': st.get('fill'), 'size': a.size, 'seconds': round(time.time() - t0, 1)}))


if __name__ == '__main__':
    main()
