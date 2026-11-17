"""fid29 heromaps: what an "r" file may differ in from its build 28 file. Checks that nodes, skins (joints, inverse bind
matrices), animations, morph targets and every primitive not named in --edited are identical in value, and that each
edited primitive keeps build 28's vertices (every new vertex's position, normal, joints and weights equal those of a
build 28 vertex; with --allow-delete some build 28 triangles may be gone). Prints JSON; exit 1 on a difference.

usage: verify.py B28.glb NEW.glb [--edited geometry_0,hands] [--allow-delete]
"""
import argparse, json, sys
import numpy as np
from hglb import Glb


def prim_by_name(g):
    out = {}
    for me in g.j['meshes']:
        out[me.get('name')] = me['primitives'][0]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('old'); ap.add_argument('new')
    ap.add_argument('--edited', default='geometry_0')
    ap.add_argument('--allow-delete', action='store_true')
    a = ap.parse_args()
    A, B = Glb(a.old), Glb(a.new)
    edited = set(x for x in a.edited.split(',') if x)
    bad = []
    strip = lambda n: {k: v for k, v in n.items() if k not in ('extras',)}
    if [strip(n) for n in A.j['nodes']] != [strip(n) for n in B.j['nodes']]:
        bad.append('nodes differ')
    if len(A.j.get('skins', [])) != len(B.j.get('skins', [])):
        bad.append('skin count')
    for sa, sb in zip(A.j.get('skins', []), B.j.get('skins', [])):
        if sa['joints'] != sb['joints'] or sa.get('skeleton') != sb.get('skeleton'):
            bad.append('skin joints')
        if not np.array_equal(A.acc(sa['inverseBindMatrices']), B.acc(sb['inverseBindMatrices'])):
            bad.append('inverse bind matrices')
    for ana, anb in zip(A.j.get('animations', []), B.j.get('animations', [])):
        if ana.get('name') != anb.get('name') or len(ana['channels']) != len(anb['channels']):
            bad.append('animation %s' % ana.get('name')); continue
        for ca, cb in zip(ana['channels'], anb['channels']):
            if ca['target'] != cb['target']:
                bad.append('animation target'); break
            sa, sb = ana['samplers'][ca['sampler']], anb['samplers'][cb['sampler']]
            if not (np.array_equal(A.acc(sa['input']), B.acc(sb['input'])) and np.array_equal(A.acc(sa['output']), B.acc(sb['output']))):
                bad.append('animation data %s' % ana.get('name')); break
    if len(A.j.get('animations', [])) != len(B.j.get('animations', [])):
        bad.append('animation count')
    pa, pb = prim_by_name(A), prim_by_name(B)
    if set(pa) != set(pb):
        bad.append('mesh names %s vs %s' % (sorted(pa), sorted(pb)))
    rows = {}
    for name in pa:
        if name not in pb:
            continue
        x, y = pa[name], pb[name]
        if x.get('material') != y.get('material'):
            bad.append('%s material index' % name)
        if len(x.get('targets', [])) != len(y.get('targets', [])):
            bad.append('%s morph target count' % name)
        if name not in edited:
            for k in x['attributes']:
                if not np.array_equal(A.acc(x['attributes'][k]), B.acc(y['attributes'][k])):
                    bad.append('%s %s changed' % (name, k))
            if not np.array_equal(A.acc(x['indices']), B.acc(y['indices'])):
                bad.append('%s indices changed' % name)
            for ta, tb in zip(x.get('targets', []), y.get('targets', [])):
                for k in ta:
                    if not np.array_equal(A.acc(ta[k]), B.acc(tb[k])):
                        bad.append('%s target %s changed' % (name, k))
            continue
        keys = [k for k in x['attributes'] if not k.startswith('TEXCOORD')]
        ka = np.concatenate([A.acc(x['attributes'][k]).astype(np.float64).reshape(len(A.acc(x['attributes']['POSITION'])), -1) for k in keys], 1)
        kb = np.concatenate([B.acc(y['attributes'][k]).astype(np.float64).reshape(len(B.acc(y['attributes']['POSITION'])), -1) for k in keys], 1)
        sa = {r.tobytes() for r in ka}
        miss = sum(1 for r in kb if r.tobytes() not in sa)
        if miss:
            bad.append('%s: %d vertices not in build 28' % (name, miss))
        ia, ib = A.acc(x['indices']).reshape(-1, 3), B.acc(y['indices']).reshape(-1, 3)
        # triangles as position triples (order-free)
        Pa, Pb = A.acc(x['attributes']['POSITION']), B.acc(y['attributes']['POSITION'])
        ta = {tuple(sorted(Pa[t].round(6).tobytes() for t in tri)) for tri in ia}
        tb = {tuple(sorted(Pb[t].round(6).tobytes() for t in tri)) for tri in ib}
        new_tris = len(tb - ta); gone = len(ta - tb)
        if new_tris:
            bad.append('%s: %d triangles not in build 28' % (name, new_tris))
        if gone and not a.allow_delete:
            bad.append('%s: %d build 28 triangles gone' % (name, gone))
        rows[name] = {'tris_b28': int(len(ia)), 'tris_new': int(len(ib)), 'deleted': int(gone), 'verts_b28': int(len(Pa)), 'verts_new': int(len(Pb))}
    out = {'old': a.old.split('/')[-1], 'new': a.new.split('/')[-1], 'ok': not bad, 'problems': bad, 'edited': rows}
    print(json.dumps(out))
    sys.exit(0 if not bad else 1)


if __name__ == '__main__':
    main()
